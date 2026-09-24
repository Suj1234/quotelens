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
import { renderMemoPdf, type MemoData, type Narrative } from "./memo";

// TRD §14.3 / §16: generate (buyer) → draft; send back (approver, with a note) → sent_back; approve (approver) → approved + RFx awarded (locked).

// users has no title column; titles follow the role, as the dispatch email signs (DECISIONS P5-T2 c) and DESIGN §3.9's signature lines.
const TITLE: Record<string, string> = { buyer: "Category Buyer", admin: "Category Buyer", approver: "VP Procurement" };
const UNSURE = ["low_confidence", "ambiguous", "references_prior", "conflict"];

// TRD §9.10 P-MEMO, verbatim.
const P_MEMO = `Write the narrative sections of a procurement award memo for RFx {code} at Meridian Foods. Inputs: the allocation table, totals, baseline comparison, exclusions with reasons, the assumptions ledger, open items, the allocation rule in plain words, and manual overrides with reasons.
Sections: 1) Recommendation (3-4 sentences), 2) Basis of award (the rule and eligibility), 3) Key assumptions (bullet list rewritten for a reader, one per ledger kind, referencing vendors), 4) Exclusions and risks (single-source lines, validity, unresolved cells with value at stake), 5) Next steps.
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
      single_source: sc.lines.filter((l) => l.vendor && !l.runner_up).map((l) => l.line_no), vendors: sc.share.map(({ vendor, ...x }) => ({ name: vendor, ...x })) },
    baseline: base, savings: base ? base.total - sc.total : null, savings_pct: base && base.total ? (base.total - sc.total) / base.total * 100 : null,
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
    totals: { annual_total: r(m.totals.total), lines_allocated: m.totals.allocated, lines_total: m.totals.lines, unallocated_lines: m.totals.unallocated, single_source_lines: m.totals.single_source,
      by_vendor: m.totals.vendors.map((v) => ({ vendor: v.name, lines: v.lines, annual_value: r(v.value), share: `${v.pct.toFixed(1)}%` })) },
    baseline: m.baseline ? { best_single_vendor: m.baseline.vendor, its_total: r(m.baseline.total), note: m.baseline.note, saving: r(m.savings), saving_pct: m.savings_pct === null ? null : `${m.savings_pct.toFixed(2)}%` } : null,
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

const pdfPath = (rfxId: string, awardId: string) => `rfx/${rfxId}/outbound/award/${awardId}.pdf`;

export type AwardView = {
  id: string; status: "draft" | "sent_back" | "approved"; scenario_id: string; memo: MemoData; pdf_url: string;
  sent_back_note: string | null; sent_back_at: string | null; sent_back_by: string | null; stale: boolean;
};
export async function getAward(rfxId: string): Promise<AwardView | null> {
  const { data, error } = await db().from("awards").select("*, sb:users!awards_sent_back_by_fkey(name)").eq("rfx_id", rfxId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const memo = data.memo_json as MemoData;
  const sc = data.status === "approved" ? null : (await listScenarios(rfxId)).find((s) => s.id === data.scenario_id);
  return { id: data.id, status: data.status, scenario_id: data.scenario_id, memo, pdf_url: `/api/export/memo/${data.id}`, sent_back_note: data.sent_back_note, sent_back_at: data.sent_back_at, sent_back_by: (data.sb as unknown as { name: string } | null)?.name ?? null,
    stale: !!sc && sc.fingerprint !== memo.scenario.fingerprint };
}

/** POST /api/award/{rfx}/generate — buyer/admin. A new memo replaces the draft (or a sent-back one); never an approved one. */
export async function generateMemo(rfxId: string, scenarioId: string, user: SessionUser) {
  await assertOpen({ rfx: rfxId });
  const { data: prev } = await db().from("awards").select("id, status").eq("rfx_id", rfxId).maybeSingle();
  if (prev?.status === "approved") throw new AppError("LOCKED", "The award is approved; the memo can't be replaced.", undefined, 409);
  const base = await buildMemo(rfxId, scenarioId, user);
  const { narrative, unverified } = await narrate(rfxId, base);
  const memo: MemoData = { ...base, narrative, narrative_unverified: unverified };
  const id = prev?.id ?? crypto.randomUUID();
  await put("outbound", pdfPath(rfxId, id), await renderMemoPdf(memo), "application/pdf");
  const row = { rfx_id: rfxId, scenario_id: scenarioId, memo_path: pdfPath(rfxId, id), memo_json: memo, prepared_by: user.id, prepared_at: memo.prepared.at,
    approved_by: null, approved_at: null, status: "draft", sent_back_note: null, sent_back_by: null, sent_back_at: null };
  const w = prev ? await db().from("awards").update(row).eq("id", id).neq("status", "approved") : await db().from("awards").insert({ id, ...row });
  if (w.error) throw w.error;
  await audit({ rfx_id: rfxId, actor: user.id, event: "award.memo", entity_type: "award", entity_id: id,
    payload: { scenario: memo.scenario.name, total: memo.totals.total, regenerated: !!prev, unverified: unverified.length } });
  return getAward(rfxId);
}

/** POST /api/award/{rfx}/approve — approver. Re-renders the PDF with the approver's signature, locks the RFx. */
export async function approveAward(rfxId: string, user: SessionUser) {
  await assertOpen({ rfx: rfxId });
  const a = await getAward(rfxId);
  if (!a || a.status !== "draft") throw new AppError("NO_DRAFT", a?.status === "sent_back" ? "The memo was sent back; wait for Sujit to generate it again." : "There is no drafted memo to approve.", undefined, 409);
  if (a.stale) throw new AppError("STALE", "The scenario changed after this memo was drafted; the buyer needs to generate the memo again.", undefined, 409);
  const at = new Date().toISOString();
  const memo: MemoData = { ...a.memo, approved: { name: user.name, title: TITLE[user.role] ?? user.role, at } };
  await put("outbound", pdfPath(rfxId, a.id), await renderMemoPdf(memo), "application/pdf");
  const w = await db().from("awards").update({ status: "approved", approved_by: user.id, approved_at: at, memo_json: memo }).eq("id", a.id).eq("status", "draft").select("id");
  if (w.error) throw w.error;
  if (!w.data?.length) throw new AppError("NO_DRAFT", "The memo changed while you were approving it; reload and try again.", undefined, 409);
  const r = await db().from("rfx").update({ status: "awarded", updated_at: at }).eq("id", rfxId);
  if (r.error) throw r.error;
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
  await audit({ rfx_id: rfxId, actor: user.id, event: "award.sent_back", entity_type: "award", entity_id: w.data[0].id, payload: { note: text.slice(0, 500) } });
  return getAward(rfxId);
}

