import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { assertOpen } from "@/lib/lock";
import { inrShort } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";
import { qualifiedFilter } from "@/lib/query/ask";
import { allocationColumn, type Row } from "@/lib/query/result";
import { allocate, baseline, fromQuery, matches, priceOf, ruleText, totals, type Inputs, type Rule, type SLine } from "./allocate";

// TRD §6.18, §13.5, §14.1–14.2: scenarios saved by rule (Award tab) or from an Ask answer; per-line overrides.

/** The comparison as the allocation engine sees it (same cells, states and qualification as the grid and Ask). */
export async function loadInputs(rfxId: string): Promise<Inputs> {
  const [lQ, vQ, cQ, aQ] = await Promise.all([
    db().from("rfx_lines").select("id, line_no, description, annual_qty, ply, item_type, delivery_location").eq("rfx_id", rfxId).order("line_no"),
    db().from("v_vendor_status").select("vendor_id, vendor, vendor_code, cleared_questionnaire").eq("rfx_id", rfxId),
    db().from("line_quotes").select("rfx_line_id, vendor_id, state, unit_price_inr_per_1000, landed_price_inr_per_1000, best_guess_value").eq("rfx_id", rfxId),
    db().from("questionnaire_answers").select("vendor_id, passes, rfx_questions(mandatory)").eq("rfx_id", rfxId),
  ]);
  for (const q of [lQ, vQ, cQ, aQ]) if (q.error) throw q.error;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const answers = (aQ.data ?? []) as unknown as { vendor_id: string; passes: boolean | null; rfx_questions: { mandatory: boolean } }[];
  const mandatory = (id: string) => answers.filter((a) => a.vendor_id === id && a.rfx_questions.mandatory);
  // Freight per vendor = landed − unit on its priced cells (the same rule as v_comparison_bestguess), added to best guesses.
  const freight = new Map<string, number>();
  for (const c of cQ.data ?? []) if (c.unit_price_inr_per_1000 !== null && c.landed_price_inr_per_1000 !== null)
    freight.set(c.vendor_id, Math.max(freight.get(c.vendor_id) ?? 0, Number(c.landed_price_inr_per_1000) - Number(c.unit_price_inr_per_1000)));
  return {
    lines: (lQ.data ?? []).map((l) => ({ ...l, annual_qty: Number(l.annual_qty), ply: n(l.ply) })),
    vendors: (vQ.data ?? []).map((v) => {
      const m = mandatory(v.vendor_id);
      return { id: v.vendor_id, name: v.vendor, code: v.vendor_code, cleared: v.cleared_questionnaire, q_score: m.length ? m.filter((a) => a.passes === true).length / m.length : 0 };
    }),
    cells: (cQ.data ?? []).map((c) => {
      const g = n(c.best_guess_value);
      return { line_id: c.rfx_line_id, vendor_id: c.vendor_id, state: c.state, unit: n(c.unit_price_inr_per_1000), landed: n(c.landed_price_inr_per_1000),
        guess_unit: g, guess_landed: g === null ? null : g + (freight.get(c.vendor_id) ?? 0) };
    }),
  };
}

const Weights = z.object({ price: z.number().min(0).max(1), questionnaire: z.number().min(0).max(1) })
  .refine((w) => Math.abs(w.price + w.questionnaire - 1) < 1e-6, "Weights must add up to 1.");
const Sub = z.object({ type: z.enum(["cheapest_per_line", "weighted"]), qualified_only: z.boolean(), weights: Weights.optional() });
const Filter = z.object({ ply: z.number().int().optional(), item_type: z.string().min(1).optional(), delivery_location: z.string().min(1).optional(), line_nos: z.array(z.number().int()).min(1).optional() })
  .refine((f) => Object.keys(f).length === 1, "Each group filters on exactly one of ply, item type, plant or lines.");
export const RuleBody = z.object({
  type: z.enum(["cheapest_per_line", "weighted", "grouped"]), price_basis: z.enum(["unit", "landed"]), include_best_guess: z.boolean().optional(),
  qualified_only: z.boolean().optional(), weights: Weights.optional(), groups: z.array(z.object({ filter: Filter, rule: Sub })).min(1).max(10).optional(),
}).refine((r) => r.type !== "grouped" || !!r.groups?.length, "A grouped rule needs at least one group.")
  .refine((r) => r.type !== "weighted" || !!r.weights, "A weighted rule needs weights.");

/** Qualification the rule applies (for the baseline and for overrides). */
const isQualified = (r: Rule) => (r.type === "grouped" ? (r.groups ?? []).every((g) => g.rule.qualified_only) : !!r.qualified_only);
/** Whether one line admits only qualified vendors: its group's rule (grouped), else the rule — except a query line whose own pick wasn't qualified (Q5's 3-ply "overall" lines). */
function lineQualified(rule: Rule, inp: Inputs, lineId: string, pickId: string | null): boolean {
  if (rule.type === "grouped") { const l = inp.lines.find((x) => x.id === lineId); return !!(l && rule.groups?.find((g) => matches(g.filter, l))?.rule.qualified_only); }
  if (rule.type === "from_query" && pickId) return !!rule.qualified_only && inp.vendors.find((v) => v.id === pickId)?.cleared === true;
  return !!rule.qualified_only;
}
export const fingerprint = (lines: { line_no: number; vendor_id: string | null; price: number | null }[]) =>
  [...lines].sort((a, b) => a.line_no - b.line_no).map((l) => `${l.line_no}:${l.vendor_id ?? "-"}:${l.price === null ? "-" : Number(l.price).toFixed(2)}`).join("|");

/** An Ask answer → winners per line (TRD §13.5: rows with line_no + vendor, one row per line), plus the rule it implies. */
async function winnersFromQuery(rfxId: string, queryId: string, inp: Inputs) {
  const { data: q, error } = await db().from("queries").select("question, sql, sql_ok, result_rows, plan").eq("id", queryId).eq("rfx_id", rfxId).maybeSingle();
  if (error) throw error;
  if (!q || !q.sql_ok || !q.sql) throw new AppError("NOT_FOUND", "That answer isn't on this RFx or has no query.", undefined, 404);
  const rows = (q.result_rows ?? []) as Row[];
  const cols = ((q.plan as { columns?: string[] } | null)?.columns?.length ? (q.plan as { columns: string[] }).columns : rows.length ? Object.keys(rows[0]) : []);
  const col = allocationColumn(cols, rows);
  if (!col) throw new AppError("NOT_AN_ALLOCATION", "This answer doesn't allocate lines to vendors (it needs one row per line with a line number and a vendor), so it can't be saved as a scenario.", undefined, 400);
  const winners = new Map<number, string>();
  for (const r of rows) {
    const name = String(r[col]).trim().toLowerCase();
    const id = inp.vendors.find((x) => x.name.toLowerCase() === name || x.code === name)?.id;
    if (!id) throw new AppError("NOT_AN_ALLOCATION", `The answer names "${r[col]}" on line ${r.line_no}, which isn't a vendor on this RFx.`, undefined, 400);
    if (!inp.lines.some((l) => l.line_no === Number(r.line_no))) throw new AppError("NOT_AN_ALLOCATION", `Line ${r.line_no} isn't on this RFx.`, undefined, 400);
    winners.set(Number(r.line_no), id);
  }
  const rule: Rule = { type: "from_query", query_id: queryId, question: q.question, sql: q.sql,
    qualified_only: qualifiedFilter(q.sql), price_basis: /landed_price|annual_value_landed/i.test(q.sql) ? "landed" : "unit", include_best_guess: /v_comparison_bestguess/i.test(q.sql) };
  return { winners, rule };
}

async function writeTotals(scenarioId: string) {
  const { data: ls, error } = await db().from("scenario_lines").select("vendor_id, annual_value_inr, runner_up_vendor_id, rfx_lines(line_no)").eq("scenario_id", scenarioId);
  if (error) throw error;
  const t = totals((ls ?? []).map((l) => ({ vendor_id: l.vendor_id, annual_value: l.annual_value_inr === null ? null : Number(l.annual_value_inr),
    single_source: !!l.vendor_id && !l.runner_up_vendor_id, line_no: (l.rfx_lines as unknown as { line_no: number }).line_no })));
  const { data: s } = await db().from("scenarios").select("baseline_single_vendor_total").eq("id", scenarioId).single();
  const base = s?.baseline_single_vendor_total === null || s?.baseline_single_vendor_total === undefined ? null : Number(s.baseline_single_vendor_total);
  const up = await db().from("scenarios").update({ total_inr: t.total, vendor_count: t.vendor_count, single_source_lines: t.single_source_lines,
    savings_vs_baseline: base === null ? null : base - t.total }).eq("id", scenarioId);
  if (up.error) throw up.error;
  return t;
}

/** POST /api/scenarios: {rfx_id, name, rule} or {rfx_id, name, query_id}. Both roles (DESIGN §4). */
export async function createScenario(o: { rfxId: string; name: string; rule?: unknown; queryId?: string; user: SessionUser }) {
  await assertOpen({ rfx: o.rfxId });
  const name = o.name.trim().slice(0, 120);
  if (!name) throw new AppError("BAD_REQUEST", "Give the scenario a name.");
  const inp = await loadInputs(o.rfxId);
  if (!inp.lines.length) throw new AppError("BAD_REQUEST", "This RFx has no lines.");
  let rule: Rule, lines: SLine[];
  if (o.queryId) {
    const q = await winnersFromQuery(o.rfxId, o.queryId, inp);
    rule = q.rule; lines = fromQuery(inp, q.winners, rule);
  } else {
    const parsed = RuleBody.safeParse(o.rule);
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid rule.");
    rule = parsed.data; lines = allocate(inp, rule);
  }
  const t = totals(lines);
  const b = baseline(inp, rule.price_basis, isQualified(rule), !!rule.include_best_guess);
  const ins = await db().from("scenarios").insert({
    rfx_id: o.rfxId, name, rule_text: ruleText(rule), rule, total_inr: t.total, vendor_count: t.vendor_count, single_source_lines: t.single_source_lines,
    baseline_single_vendor_total: b?.total ?? null, baseline_vendor_id: b?.vendor_id ?? null, savings_vs_baseline: b ? b.total - t.total : null, baseline_note: b?.note ?? null,
    created_by: o.user.id,
  }).select("id").single();
  if (ins.error) throw ins.error;
  const sl = await db().from("scenario_lines").insert(lines.map((l) => ({
    scenario_id: ins.data.id, rfx_line_id: l.rfx_line_id, vendor_id: l.vendor_id, price_inr_per_1000: l.price, annual_value_inr: l.annual_value,
    runner_up_vendor_id: l.runner_up_vendor_id, runner_up_price: l.runner_up_price, gap_pct: l.gap_pct, reason: l.reason,
  })));
  if (sl.error) { await db().from("scenarios").delete().eq("id", ins.data.id); throw sl.error; }
  await audit({ rfx_id: o.rfxId, actor: o.user.id, event: "scenario.saved", entity_type: "scenario", entity_id: ins.data.id,
    payload: { name, total: t.total, total_short: inrShort(t.total), from_query: rule.type === "from_query", allocated: t.allocated, lines: t.lines } });
  return (await listScenarios(o.rfxId)).find((s) => s.id === ins.data.id)!;
}

export type ScenarioLineView = {
  rfx_line_id: string; line_no: number; description: string; annual_qty: number; vendor_id: string | null; vendor: string | null; price: number | null; annual_value: number | null;
  runner_up: string | null; runner_up_price: number | null; gap_pct: number | null; reason: string; is_override: boolean;
  auto_vendor: string | null; // who the rule gave the line to, when overridden
  rule_pick_id: string | null; // the rule's (or query's) own pick for the line, override or not
};
export type ScenarioView = {
  id: string; name: string; rule_text: string; rule: Rule; total: number; vendor_count: number; single_source_lines: number; created_at: string; created_by: string | null;
  baseline: { vendor: string | null; total: number; note: string | null } | null; savings_vs_baseline: number | null;
  allocated: number; unallocated: number[]; share: { vendor: string; lines: number; value: number; pct: number }[]; lines: ScenarioLineView[]; fingerprint: string;
};

/** GET /api/scenarios?rfx= — oldest first (the "vs first" column compares with the first one saved). */
export async function listScenarios(rfxId: string): Promise<ScenarioView[]> {
  const [sQ, vQ, uQ] = await Promise.all([
    db().from("scenarios").select("*, scenario_lines(*, rfx_lines(line_no, description, annual_qty))").eq("rfx_id", rfxId).order("created_at"),
    db().from("vendors").select("id, name"), db().from("users").select("id, name"),
  ]);
  if (sQ.error) throw sQ.error;
  const vn = (id: string | null) => (id ? (vQ.data ?? []).find((v) => v.id === id)?.name ?? "?" : null);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return (sQ.data ?? []).map((s) => {
    const lines: ScenarioLineView[] = (s.scenario_lines as unknown as (Record<string, unknown> & { rfx_lines: { line_no: number; description: string; annual_qty: number } })[]).map((l) => ({
      rfx_line_id: l.rfx_line_id as string, line_no: l.rfx_lines.line_no, description: l.rfx_lines.description, annual_qty: Number(l.rfx_lines.annual_qty),
      vendor_id: l.vendor_id as string | null, vendor: vn(l.vendor_id as string | null), price: n(l.price_inr_per_1000), annual_value: n(l.annual_value_inr),
      runner_up: vn(l.runner_up_vendor_id as string | null), runner_up_price: n(l.runner_up_price), gap_pct: n(l.gap_pct), reason: l.reason as string, is_override: !!l.is_override,
      auto_vendor: l.is_override ? vn(((l.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null) : null,
      rule_pick_id: l.is_override ? ((l.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null : (l.vendor_id as string | null),
    })).sort((a, b) => a.line_no - b.line_no);
    const t = totals(lines.map((l) => ({ vendor_id: l.vendor_id, annual_value: l.annual_value, single_source: false, line_no: l.line_no })));
    return {
      id: s.id, name: s.name, rule_text: s.rule_text, rule: s.rule as Rule, total: Number(s.total_inr ?? 0), vendor_count: s.vendor_count ?? 0, single_source_lines: s.single_source_lines ?? 0,
      created_at: s.created_at, created_by: (uQ.data ?? []).find((u) => u.id === s.created_by)?.name ?? null,
      baseline: s.baseline_single_vendor_total === null ? null : { vendor: vn(s.baseline_vendor_id), total: Number(s.baseline_single_vendor_total), note: s.baseline_note },
      savings_vs_baseline: n(s.savings_vs_baseline), allocated: t.allocated, unallocated: t.unallocated_lines,
      share: t.share.map((x) => ({ vendor: vn(x.vendor_id)!, lines: x.lines, value: x.value, pct: x.pct })), lines,
      fingerprint: fingerprint(lines),
    };
  });
}

/** POST /api/scenarios/{id}/override — buyer only; {rfx_line_id, vendor_id, reason} or {rfx_line_id, revert: true}. */
export async function overrideLine(scenarioId: string, body: { rfx_line_id?: string; vendor_id?: string; reason?: string; revert?: boolean }, user: SessionUser) {
  await assertOpen({ scenario: scenarioId });
  const { data: s } = await db().from("scenarios").select("id, rfx_id, name, rule").eq("id", scenarioId).maybeSingle();
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found.", undefined, 404);
  const { data: line } = await db().from("scenario_lines").select("*, rfx_lines(line_no)").eq("scenario_id", scenarioId).eq("rfx_line_id", body.rfx_line_id ?? "").maybeSingle();
  if (!line) throw new AppError("NOT_FOUND", "That line isn't in this scenario.", undefined, 404);
  const lineNo = (line.rfx_lines as unknown as { line_no: number }).line_no;
  const vname = async (id: string | null) => (id ? (await db().from("vendors").select("name").eq("id", id).single()).data?.name ?? "?" : "nobody");

  if (body.revert) {
    if (!line.is_override || !line.auto) throw new AppError("BAD_REQUEST", "This line isn't overridden.", undefined, 400);
    const a = line.auto as Record<string, unknown>;
    const up = await db().from("scenario_lines").update({ vendor_id: a.vendor_id, price_inr_per_1000: a.price, annual_value_inr: a.annual_value, runner_up_vendor_id: a.runner_up_vendor_id,
      runner_up_price: a.runner_up_price, gap_pct: a.gap_pct, reason: a.reason, is_override: false, auto: null }).eq("id", line.id);
    if (up.error) throw up.error;
    await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.override_reverted", entity_type: "scenario", entity_id: s.id, payload: { name: s.name, line_no: lineNo, vendor: await vname(a.vendor_id as string | null) } });
    return { ok: true, totals: await writeTotals(s.id) };
  }

  const reason = (body.reason ?? "").trim();
  if (!reason) throw new AppError("BAD_REQUEST", "Say why you're overriding this line — the reason goes into the memo.");
  if (!body.vendor_id) throw new AppError("BAD_REQUEST", "Pick the vendor for this line.");
  const rule = s.rule as Rule;
  const inp = await loadInputs(s.rfx_id);
  const vendor = inp.vendors.find((v) => v.id === body.vendor_id);
  const l = inp.lines.find((x) => x.id === body.rfx_line_id)!;
  if (!vendor) throw new AppError("BAD_REQUEST", "That vendor isn't on this RFx.");
  const cell = inp.cells.find((c) => c.line_id === l.id && c.vendor_id === vendor.id);
  const p = cell ? priceOf(cell, rule.price_basis, !!rule.include_best_guess) : null;
  if (!p) throw new AppError("NOT_ELIGIBLE", `${vendor.name} has no counted price on line ${lineNo} (${cell ? cell.state.replaceAll("_", " ") : "no quote"}), so the line can't go to them.`, undefined, 400);
  const pick = line.is_override ? ((line.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null : line.vendor_id;
  const qualified = lineQualified(rule, inp, l.id, pick);
  if (qualified && vendor.cleared !== true) throw new AppError("NOT_ELIGIBLE", `${vendor.name} hasn't cleared the questionnaire, and under this scenario's rule line ${lineNo} only goes to vendors who have.`, undefined, 400);
  if (vendor.id === line.vendor_id) throw new AppError("BAD_REQUEST", `Line ${lineNo} already goes to ${vendor.name}.`);
  // Runner-up after the override: the cheapest other eligible quote (usually the rule's winner — a negative gap is the premium paid).
  const others = inp.cells.filter((c) => c.line_id === l.id && c.vendor_id !== vendor.id).flatMap((c) => {
    const v = inp.vendors.find((x) => x.id === c.vendor_id); const q = priceOf(c, rule.price_basis, !!rule.include_best_guess);
    return v && q && (!qualified || v.cleared === true) ? [{ id: v.id, name: v.name, price: q.price }] : [];
  }).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  const ru = others[0] ?? null;
  const auto = line.is_override ? line.auto : { vendor_id: line.vendor_id, price: line.price_inr_per_1000, annual_value: line.annual_value_inr, runner_up_vendor_id: line.runner_up_vendor_id,
    runner_up_price: line.runner_up_price, gap_pct: line.gap_pct, reason: line.reason };
  const up = await db().from("scenario_lines").update({
    vendor_id: vendor.id, price_inr_per_1000: p.price, annual_value_inr: p.price * l.annual_qty / 1000, runner_up_vendor_id: ru?.id ?? null, runner_up_price: ru?.price ?? null,
    gap_pct: ru ? Math.round((ru.price - p.price) / p.price * 10000) / 100 : null, reason: `manual override: ${reason}`, is_override: true, auto,
  }).eq("id", line.id);
  if (up.error) throw up.error;
  await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.override", entity_type: "scenario", entity_id: s.id,
    payload: { name: s.name, line_no: lineNo, vendor: vendor.name, from_vendor: await vname((auto as { vendor_id: string | null }).vendor_id), reason } });
  return { ok: true, totals: await writeTotals(s.id) };
}

/** DELETE /api/scenarios/{id} — buyer only; a scenario a memo was drafted from stays until the memo moves to another one. */
export async function deleteScenario(id: string, user: SessionUser) {
  await assertOpen({ scenario: id });
  const { data: s } = await db().from("scenarios").select("id, rfx_id, name").eq("id", id).maybeSingle();
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found.", undefined, 404);
  const { count } = await db().from("awards").select("id", { count: "exact", head: true }).eq("scenario_id", id);
  if (count) throw new AppError("IN_USE", "The award memo was drafted from this scenario. Generate the memo from another scenario first.", undefined, 409);
  const del = await db().from("scenarios").delete().eq("id", id);
  if (del.error) throw del.error;
  await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.deleted", entity_type: "scenario", entity_id: id, payload: { name: s.name } });
  return { ok: true };
}

/** Per line (rfx_line_id): vendors the buyer may switch it to under this scenario's rule — an eligible price, and cleared when the rule is qualified-only. */
export function overrideOptions(inp: Inputs, s: Pick<ScenarioView, "rule" | "lines">): Record<string, { id: string; name: string; price: number }[]> {
  const rule = s.rule;
  return Object.fromEntries(inp.lines.map((l) => [l.id, inp.cells.filter((c) => c.line_id === l.id).flatMap((c) => {
    const v = inp.vendors.find((x) => x.id === c.vendor_id); const p = priceOf(c, rule.price_basis, !!rule.include_best_guess);
    const qualified = lineQualified(rule, inp, l.id, s.lines.find((x) => x.rfx_line_id === l.id)?.rule_pick_id ?? null);
    return v && p && (!qualified || v.cleared === true) ? [{ id: v.id, name: v.name, price: p.price }] : [];
  }).sort((a, b) => a.price - b.price)]));
}
