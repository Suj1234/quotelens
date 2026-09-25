import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { assertOpen } from "@/lib/lock";
import { generateJSON } from "@/lib/ai/gemini";
import { getComparison } from "@/lib/comparison";
import { getLedger } from "@/lib/rfx-tabs";
import { put } from "@/lib/storage";
import { money } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";
import { unverifiedNumbers } from "@/lib/query/result";
import { listScenarios } from "@/lib/scenarios";
import { discountText } from "@/lib/scenarios/allocate";
import { renderMemoPdf, type MemoData, type Narrative } from "./memo";
import { memoChanges, type MemoChanges } from "./changes";

// TRD §14.3 / §16: generate (buyer) → draft; send back (approver, with a note) → sent_back; approve (approver) → approved + RFx awarded (locked).

// users has no title column; titles follow the role, as the dispatch email signs (DECISIONS P5-T2 c) and DESIGN §3.9's signature lines.
const TITLE: Record<string, string> = { buyer: "Category Buyer", admin: "Category Buyer", approver: "VP Procurement" };
const UNSURE = ["low_confidence", "ambiguous", "references_prior", "conflict"];

// TRD §9.10 P-MEMO, verbatim.
const P_MEMO = `Write the narrative sections of a procurement award memo for RFx {code} at Meridian Foods. Inputs: the allocation table, totals, baseline comparison, exclusions with reasons, the assumptions ledger, open items, the allocation rule in plain words, and manual overrides with reasons.
Sections: 1) Recommendation (3-4 sentences), 2) Basis of award (the rule and eligibility), 3) Key assumptions (bullet list rewritten for a reader, one per ledger kind, referencing vendors), 4) Exclusions and risks (single-source lines, validity, unresolved cells with value at stake), 5) Next steps.
Vendor discounts (totals.discounts) apply only where their condition is met by this award: say which are met, use annual_total_after_discounts as the award's cost when it differs, and name any discount this award does not earn.
Use only supplied numbers. Formal, concise, Indian number formatting. Return ONLY JSON with those five string fields.`;
const NarrativeSchema = z.object({ recommendation: z.string().min(1), basis_of_award: z.string().min(1), key_assumptions: z.string().min(1), exclusions_and_risks: z.string().min(1), next_steps: z.string().min(1) });

/** Everything the memo shows, from the database. The narrative is filled in afterwards. */
async function buildMemo(rfxId: string, scenarioId: string, preparedBy: SessionUser): Promise<Omit<MemoData, "narrative" | "narrative_unverified">> {
  const [{ data: rfx, error }, scenarios, grid, ledger, vs] = await Promise.all([
    db().from("rfx").select("code, title, category, frozen_at, response_deadline, contract_months").eq("id", rfxId).single(),
    listScenarios(rfxId), getComparison(rfxId), getLedger(rfxId),
    db().from("v_vendor_status").select("vendor, validity_until").eq("rfx_id", rfxId),
  ]);
  if (error) throw error;
  const sc = scenarios.find((x) => x.id === scenarioId);
  if (!sc) throw new AppError("NOT_FOUND", "That scenario isn't on this RFx.", undefined, 404);
  if (sc.outdated) throw new AppError("OUTDATED", `Prices changed since “${sc.name}” was saved (line${sc.changed_lines.length === 1 ? "" : "s"} ${sc.changed_lines.join(", ")}). Refresh it first, so the memo uses today's numbers.`, undefined, 409);
  const annual = new Map(grid.lines.map((l) => [l.line_no, l.annual_qty]));
  const winners = new Set(sc.lines.map((l) => l.vendor).filter(Boolean) as string[]);

  // Exclusions: who could not win and why (questionnaire), plus lines vendors did not price (not quoted / prior pricing).
  const exclusions: MemoData["exclusions"] = [];
  const spans = (ns: number[]) => ns.join(", ");
  for (const v of grid.vendors) {
    if (v.cleared !== true) exclusions.push({ vendor: v.name, reason: v.cleared === false ? `did not clear the questionnaire (${v.cleared_note})` : `questionnaire not cleared yet (${v.cleared_note})` });
    const nq = grid.cells.filter((c) => c.vendor === v.code && c.state === "not_quoted").map((c) => c.line_no).sort((a, b) => a - b);
    const prior = grid.cells.filter((c) => c.vendor === v.code && c.state === "references_prior").map((c) => c.line_no).sort((a, b) => a - b);
    if (nq.length) exclusions.push({ vendor: v.name, reason: `did not quote line${nq.length === 1 ? "" : "s"} ${spans(nq)}` });
    if (prior.length) exclusions.push({ vendor: v.name, reason: `line${prior.length === 1 ? "" : "s"} ${spans(prior)} refer to earlier pricing not on file` });
  }
  const unresolved = grid.cells.filter((c) => UNSURE.includes(c.state)).sort((a, b) => a.line_no - b.line_no).map((c) => ({
    line_no: c.line_no, vendor: grid.vendors.find((v) => v.code === c.vendor)?.name ?? c.vendor, state: c.state, best_guess: c.best_guess,
    at_stake: c.best_guess === null ? null : c.best_guess * (annual.get(c.line_no) ?? 0) / 1000,
  }));
  const base = sc.baseline;
  return {
    rfx: { code: rfx.code, title: rfx.title, category: rfx.category, frozen_at: rfx.frozen_at, deadline: rfx.response_deadline, contract_months: rfx.contract_months },
    prepared: { name: preparedBy.name, title: TITLE[preparedBy.role] ?? preparedBy.role, at: new Date().toISOString() },
    approved: null,
    scenario: { id: sc.id, name: sc.name, rule_text: sc.rule_text, price_basis: sc.rule.price_basis, question: sc.rule.type === "from_query" ? sc.rule.question ?? null : null,
      sql: sc.rule.type === "from_query" ? sc.rule.sql ?? null : null, fingerprint: sc.fingerprint },
    allocation: sc.lines.map((l) => ({ line_no: l.line_no, description: l.description, annual_qty: l.annual_qty, vendor: l.vendor, price: l.price, annual_value: l.annual_value,
      runner_up: l.runner_up, runner_up_price: l.runner_up_price, gap_pct: l.gap_pct, reason: l.reason, is_override: l.is_override })),
    totals: { total: sc.total, allocated: sc.allocated, lines: sc.lines.length, unallocated: sc.unallocated,
      single_source: sc.lines.filter((l) => l.vendor && !l.runner_up).map((l) => l.line_no), vendors: sc.share.map(({ vendor, ...x }) => ({ name: vendor, ...x })),
      total_after: sc.total_after, discounts: sc.discounts },
    baseline: base, savings: base ? base.total - sc.total_after : null, savings_pct: base && base.total ? (base.total - sc.total_after) / base.total * 100 : null,
    exclusions,
    validity: grid.vendors.filter((v) => winners.has(v.name)).map((v) => ({ vendor: v.name, days: v.validity_days,
      until: (vs.data ?? []).find((x) => x.vendor === v.name)?.validity_until ?? null, short: v.validity_short })),
    ledger,
    open_items: { unresolved, at_stake_total: unresolved.reduce((a, u) => a + (u.at_stake ?? 0), 0),
      overrides: sc.lines.filter((l) => l.is_override).map((l) => ({ line_no: l.line_no, vendor: l.vendor ?? "nobody", instead_of: l.auto_vendor, reason: l.reason.replace(/^manual override: /, "") })) },
    generated_at: new Date().toISOString(),
  };
}

/** P-MEMO with the P4 narrator's number check: every number must be a supplied one; one retry naming the offenders; leftovers recorded. */
async function narrate(rfxId: string, m: Omit<MemoData, "narrative" | "narrative_unverified">): Promise<{ narrative: Narrative; unverified: string[] }> {
  const r = (v: number | null) => (v === null ? null : money(Math.round(v)));
  // Numbers only, pre-formatted the Indian way, so the model copies instead of computing.
  const input = {
    rfx: { code: m.rfx.code, title: m.rfx.title, contract_months: m.rfx.contract_months },
    allocation_rule: m.scenario.rule_text, scenario: m.scenario.name, price_basis: m.scenario.price_basis === "landed" ? "landed cost" : "unit price",
    allocation_table: m.allocation.map((a) => ({ line: a.line_no, description: a.description, vendor: a.vendor ?? "unallocated", price_per_1000: r(a.price), annual_value: r(a.annual_value), runner_up: a.runner_up, runner_up_price: r(a.runner_up_price), gap_pct: a.gap_pct === null ? null : `${a.gap_pct.toFixed(2)}%`, reason: a.reason })),
    totals: { annual_total: r(m.totals.total), annual_total_after_discounts: r(m.totals.total_after ?? m.totals.total),
      discounts: (m.totals.discounts ?? []).map((d) => `${discountText(d)}${d.saving ? `; saves ${r(d.saving)}` : ""}`), lines_allocated: m.totals.allocated, lines_total: m.totals.lines, unallocated_lines: m.totals.unallocated, single_source_lines: m.totals.single_source,
      by_vendor: m.totals.vendors.map((v) => ({ vendor: v.name, lines: v.lines, annual_value: r(v.value), share: `${v.pct.toFixed(1)}%` })) },
    baseline: m.baseline ? { best_single_vendor: m.baseline.vendor, its_total: r(m.baseline.total), its_total_as_quoted: r(m.baseline.total_quoted ?? m.baseline.total),
      its_discount: m.baseline.discount ? discountText(m.baseline.discount) : null, note: m.baseline.note, saving: r(m.savings), saving_pct: m.savings_pct === null ? null : `${m.savings_pct.toFixed(2)}%` } : null,
    exclusions: m.exclusions.map((e) => `${e.vendor}: ${e.reason}`),
    validity: m.validity.map((v) => `${v.vendor}: ${v.days ?? "?"} days${v.short ? " (shorter than the RFx asked)" : ""}`),
    assumptions_ledger: m.ledger.map((l) => ({ kind: l.kind, vendor: l.vendor, lines: l.lines, assumption: l.description, basis: l.basis, by: l.by })),
    open_items: { unresolved_cells: m.open_items.unresolved.length, value_at_stake: r(m.open_items.at_stake_total),
      cells: m.open_items.unresolved.map((u) => `line ${u.line_no} ${u.vendor}: ${u.state.replaceAll("_", " ")}${u.at_stake !== null ? `, ${r(u.at_stake)} at stake` : ""}`) },
    manual_overrides: m.open_items.overrides.map((o) => `line ${o.line_no} to ${o.vendor}${o.instead_of ? ` instead of ${o.instead_of}` : ""}: ${o.reason}`),
  };
  const parts = [{ text: P_MEMO.replace("{code}", m.rfx.code) }, { text: JSON.stringify(input) }];
  const n = m.open_items.unresolved.length;
  const problems = (x: Narrative) => {
    const all = Object.values(x).join("\n");
    const bad = unverifiedNumbers(all, [input, m.rfx.code, n]);
    const missing = n > 0 && !(new RegExp(`\\b${n}\\b`).test(x.exclusions_and_risks) && /unresolved/i.test(x.exclusions_and_risks)) ? [`the ${n} unresolved cells are not mentioned in exclusions_and_risks`] : [];
    return { bad, missing };
  };
  let out = await generateJSON({ tier: "strong", purpose: "memo", rfx_id: rfxId, schema: NarrativeSchema, temperature: 0.2, thinking: "LOW", parts });
  let p = problems(out);
  if (p.bad.length || p.missing.length) {
    out = await generateJSON({ tier: "strong", purpose: "memo", rfx_id: rfxId, schema: NarrativeSchema, temperature: 0.1, thinking: "LOW", parts: [...parts, { text:
      `Your previous JSON had problems. ${p.bad.length ? `Numbers not in the inputs: ${p.bad.join(", ")}. Use only the supplied numbers, copied as written. ` : ""}${p.missing.length ? `Exclusions and risks must state that ${n} cells are unresolved and the value at stake. ` : ""}Previous JSON: ${JSON.stringify(out)}\nReturn corrected JSON.` }] });
    p = problems(out);
  }
  return { narrative: out, unverified: [...p.bad, ...p.missing] };
}

// One PDF per version (memo history): drafting again never overwrites the memo that was sent back.
const pdfPath = (rfxId: string, awardId: string, version: number) => `rfx/${rfxId}/outbound/award/${awardId}-v${version}.pdf`;

export type AwardView = {
  id: string; status: "draft" | "sent_back" | "approved"; scenario_id: string; memo: MemoData; pdf_url: string;
  sent_back_note: string | null; sent_back_at: string | null; sent_back_by: string | null; stale: boolean;
  /** Why the memo can't be approved as it stands: the option was changed after drafting, or today's prices give a different result (A1). */
  stale_reason: "changed" | "prices" | null;
  /** Every drafted memo, oldest first, with what the approver did and what changed since the version before. */
  history: MemoVersion[];
};
export type MemoVersion = {
  version: number; scenario_name: string | null; total: number | null; prepared_by: string | null; prepared_at: string | null; pdf_url: string | null;
  sent_back_note: string | null; sent_back_by: string | null; sent_back_at: string | null; approved_by: string | null; approved_at: string | null;
  changes: MemoChanges | null; current: boolean;
};
export async function getAward(rfxId: string): Promise<AwardView | null> {
  const { data, error } = await db().from("awards").select("*, sb:users!awards_sent_back_by_fkey(name)").eq("rfx_id", rfxId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const memo = data.memo_json as MemoData;
  const [sc, { data: vs, error: ve }] = await Promise.all([
    data.status === "approved" ? null : listScenarios(rfxId).then((l) => l.find((s) => s.id === data.scenario_id)),
    db().from("award_versions").select("*, pb:users!award_versions_prepared_by_fkey(name), sbb:users!award_versions_sent_back_by_fkey(name), ab:users!award_versions_approved_by_fkey(name)")
      .eq("award_id", data.id).order("version"),
  ]);
  if (ve) throw ve;
  const nm = (u: unknown) => (u as { name: string } | null)?.name ?? null;
  const rows = vs ?? [];
  const history: MemoVersion[] = rows.map((v, i) => {
    const prev = rows[i - 1]?.memo_json as MemoData | null | undefined;
    const cur = v.memo_json as MemoData | null;
    return { version: v.version, scenario_name: v.scenario_name, total: v.total_inr === null ? null : Number(v.total_inr), prepared_by: nm(v.pb), prepared_at: v.prepared_at,
      pdf_url: v.memo_path ? `/api/export/memo/${data.id}?v=${v.version}` : null, sent_back_note: v.sent_back_note, sent_back_by: nm(v.sbb), sent_back_at: v.sent_back_at,
      approved_by: nm(v.ab), approved_at: v.approved_at, changes: prev && cur ? memoChanges(prev, cur) : null, current: i === rows.length - 1 };
  });
  return { id: data.id, status: data.status, scenario_id: data.scenario_id, memo, pdf_url: `/api/export/memo/${data.id}`, sent_back_note: data.sent_back_note, sent_back_at: data.sent_back_at, sent_back_by: (data.sb as unknown as { name: string } | null)?.name ?? null, history,
    stale: !!sc && (sc.fingerprint !== memo.scenario.fingerprint || sc.outdated),
    stale_reason: !sc ? null : sc.outdated ? "prices" : sc.fingerprint !== memo.scenario.fingerprint ? "changed" : null };
}

/** POST /api/award/{rfx}/generate — buyer/admin. A new memo replaces the draft (or a sent-back one); never an approved one. */
export async function generateMemo(rfxId: string, scenarioId: string, user: SessionUser) {
  await assertOpen({ rfx: rfxId });
  const { data: prev } = await db().from("awards").select("id, status").eq("rfx_id", rfxId).maybeSingle();
  if (prev?.status === "approved") throw new AppError("LOCKED", "The award is approved; the memo can't be replaced.", undefined, 409);
  const base = await buildMemo(rfxId, scenarioId, user);
  const { narrative, unverified } = await narrate(rfxId, base);
  const id = prev?.id ?? crypto.randomUUID();
  const { data: last } = await db().from("award_versions").select("version").eq("award_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const memo: MemoData = { ...base, narrative, narrative_unverified: unverified, version };
  const path = pdfPath(rfxId, id, version);
  await put("outbound", path, await renderMemoPdf(memo), "application/pdf");
  const row = { rfx_id: rfxId, scenario_id: scenarioId, memo_path: path, memo_json: memo, prepared_by: user.id, prepared_at: memo.prepared.at,
    approved_by: null, approved_at: null, status: "draft", sent_back_note: null, sent_back_by: null, sent_back_at: null };
  const w = prev ? await db().from("awards").update(row).eq("id", id).neq("status", "approved") : await db().from("awards").insert({ id, ...row });
  if (w.error) throw w.error;
  const vi = await db().from("award_versions").insert({ award_id: id, rfx_id: rfxId, version, scenario_id: scenarioId, scenario_name: memo.scenario.name,
    total_inr: memo.totals.total_after ?? memo.totals.total, memo_json: memo, memo_path: path, prepared_by: user.id, prepared_at: memo.prepared.at });
  if (vi.error) throw vi.error;
  await audit({ rfx_id: rfxId, actor: user.id, event: "award.memo", entity_type: "award", entity_id: id,
    payload: { scenario: memo.scenario.name, total: memo.totals.total, regenerated: !!prev, unverified: unverified.length, version } });
  return getAward(rfxId);
}

/** The approver's decision on the newest version (memo history). */
async function stampLatest(awardId: string, fields: Record<string, unknown>) {
  const { data: v } = await db().from("award_versions").select("id").eq("award_id", awardId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!v) return; // a memo drafted before 0018 and not backfilled: nothing to stamp
  const { error } = await db().from("award_versions").update(fields).eq("id", v.id);
  if (error) throw error;
}

/** POST /api/award/{rfx}/approve — approver. Re-renders the PDF with the approver's signature, locks the RFx. */
export async function approveAward(rfxId: string, user: SessionUser) {
  await assertOpen({ rfx: rfxId });
  const a = await getAward(rfxId);
  if (!a || a.status !== "draft") throw new AppError("NO_DRAFT", a?.status === "sent_back" ? "The memo was sent back; wait for Sujit to generate it again." : "There is no drafted memo to approve.", undefined, 409);
  if (a.stale) throw new AppError("STALE", a.stale_reason === "prices"
    ? "Prices changed since this memo was drafted; the buyer needs to refresh the option and draft the memo again."
    : "The option changed after this memo was drafted; the buyer needs to draft the memo again.", undefined, 409);
  const at = new Date().toISOString();
  const memo: MemoData = { ...a.memo, approved: { name: user.name, title: TITLE[user.role] ?? user.role, at } };
  const { data: cur } = await db().from("awards").select("memo_path").eq("id", a.id).single();
  await put("outbound", cur?.memo_path ?? pdfPath(rfxId, a.id, memo.version ?? 1), await renderMemoPdf(memo), "application/pdf");
  const w = await db().from("awards").update({ status: "approved", approved_by: user.id, approved_at: at, memo_json: memo }).eq("id", a.id).eq("status", "draft").select("id");
  if (w.error) throw w.error;
  if (!w.data?.length) throw new AppError("NO_DRAFT", "The memo changed while you were approving it; reload and try again.", undefined, 409);
  const r = await db().from("rfx").update({ status: "awarded", updated_at: at }).eq("id", rfxId);
  if (r.error) throw r.error;
  await stampLatest(a.id, { approved_by: user.id, approved_at: at, memo_json: memo });
  await audit({ rfx_id: rfxId, actor: user.id, event: "award.approved", entity_type: "award", entity_id: a.id, payload: { scenario: memo.scenario.name, total: memo.totals.total } });
  return getAward(rfxId);
}

/** Send back (DESIGN §3.9) — approver, note required. The buyer sees the note and can regenerate. */
export async function sendBack(rfxId: string, note: string, user: SessionUser) {
  await assertOpen({ rfx: rfxId });
  const text = note.trim();
  if (!text) throw new AppError("BAD_REQUEST", "Add a note for Sujit — say what should change.");
  const w = await db().from("awards").update({ status: "sent_back", sent_back_note: text.slice(0, 2000), sent_back_by: user.id, sent_back_at: new Date().toISOString() })
    .eq("rfx_id", rfxId).eq("status", "draft").select("id");
  if (w.error) throw w.error;
  if (!w.data?.length) throw new AppError("NO_DRAFT", "There is no drafted memo to send back.", undefined, 409);
  await stampLatest(w.data[0].id, { sent_back_note: text.slice(0, 2000), sent_back_by: user.id, sent_back_at: new Date().toISOString() });
  await audit({ rfx_id: rfxId, actor: user.id, event: "award.sent_back", entity_type: "award", entity_id: w.data[0].id, payload: { note: text.slice(0, 500) } });
  return getAward(rfxId);
}

