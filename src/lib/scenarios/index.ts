import "server-only";
import { z } from "zod";
import { heldVendors } from "@/lib/comparison";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { assertOpen } from "@/lib/lock";
import { inrShort } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";
import { ask, execute, qualifiedFilter } from "@/lib/query/ask";
import { generateJSON } from "@/lib/ai/gemini";
import { allocationColumn, type Row } from "@/lib/query/result";
import { allocate, applyDiscounts, baseline, fromQuery, matches, priceOf, ruleText, tidyTitle, totals, type ADiscount, type Inputs, type Rule, type SLine } from "./allocate";

/** P10 D4: a vendor's discount in an award option, in words — met or not, and why. */
export type DiscountView = { vendor: string; pct: number; condition: string | null; met: boolean | null; why: string; saving: number };
/** Quoted total → total after the discounts whose conditions this award meets, with every vendor's discount explained. */
export function withDiscounts(inp: Inputs, share: { vendor_id: string; lines: number; value: number }[], total: number): { total_after: number; discounts: DiscountView[] } {
  const d = applyDiscounts(share, inp);
  const name = (id: string) => inp.vendors.find((v) => v.id === id)?.name ?? "?";
  return { total_after: total - d.saving, discounts: d.lines.map((x) => ({ vendor: name(x.vendor_id), pct: x.pct, condition: x.condition, met: x.met, why: x.why, saving: x.saving })) };
}

/** P10 D3: each vendor's total-level discount as read from its quote (and as the buyer settled it on the card); also Ask's discount note (P11 #4). */
export async function loadDiscounts(rfxId: string): Promise<ADiscount[]> {
  const [dQ, held] = await Promise.all([
    db().from("assumptions").select("vendor_id, value, basis, created_at").eq("rfx_id", rfxId).eq("kind", "discount_treatment").is("superseded_by", null).order("created_at", { ascending: false }),
    heldVendors(rfxId),
  ]);
  if (dQ.error) throw dQ.error;
  const discounts: ADiscount[] = [];
  // Per vendor: the buyer's row if there is one (a re-run of normalise keeps it), else the newest system row; only "per_award" counts.
  const rows = [...(dQ.data ?? [])].sort((a, b) => Number(b.basis === "buyer_entered") - Number(a.basis === "buyer_entered"));
  const seen = new Set<string>();
  for (const a of rows) {
    if (seen.has(a.vendor_id) || held.has(a.vendor_id)) continue; // a reply on hold may be another vendor's discount
    seen.add(a.vendor_id);
    const v = a.value as { pct?: number; condition?: string | null; treatment?: string; kind?: ADiscount["kind"]; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null };
    if (!v.pct || v.treatment !== "per_award") continue;
    discounts.push({ vendor_id: a.vendor_id, pct: Number(v.pct), condition: v.condition ?? null, kind: v.kind ?? "unclear", min_lines: v.min_lines ?? null, min_value_inr: v.min_value_inr ?? null, payment_days: v.payment_days ?? null });
  }
  return discounts;
}

// TRD §6.18, §13.5, §14.1–14.2: scenarios saved by rule (Award tab) or from an Ask answer; per-line overrides.

/** The comparison as the allocation engine sees it (same cells, states and qualification as the grid and Ask). */
export async function loadInputs(rfxId: string): Promise<Inputs> {
  const [lQ, vQ, cQ, aQ, discounts, rQ] = await Promise.all([
    db().from("rfx_lines").select("id, line_no, description, annual_qty, ply, item_type, delivery_location").eq("rfx_id", rfxId).order("line_no"),
    db().from("v_vendor_status").select("vendor_id, vendor, vendor_code, cleared_questionnaire, validity_days").eq("rfx_id", rfxId),
    db().from("line_quotes").select("rfx_line_id, vendor_id, state, unit_price_inr_per_1000, landed_price_inr_per_1000, best_guess_value").eq("rfx_id", rfxId),
    db().from("questionnaire_answers").select("vendor_id, passes, rfx_questions(mandatory)").eq("rfx_id", rfxId),
    loadDiscounts(rfxId),
    db().from("rfx").select("payment_terms_days").eq("id", rfxId).single(),
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
    discounts, payment_days: rQ.data?.payment_terms_days ?? null,
    lines: (lQ.data ?? []).map((l) => ({ ...l, annual_qty: Number(l.annual_qty), ply: n(l.ply) })),
    vendors: (vQ.data ?? []).map((v) => {
      const m = mandatory(v.vendor_id);
      return { id: v.vendor_id, name: v.vendor, code: v.vendor_code, cleared: v.cleared_questionnaire, q_score: m.length ? m.filter((a) => a.passes === true).length / m.length : 0,
        validity_days: n(v.validity_days) }; // A3: a tie on price goes to the better questionnaire score, then the longer validity
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
  const winners = winnersFromRows(rows, cols, inp);
  const rule: Rule = { type: "from_query", query_id: queryId, question: q.question, sql: q.sql,
    qualified_only: qualifiedFilter(q.sql), price_basis: /landed_price|annual_value_landed/i.test(q.sql) ? "landed" : "unit", include_best_guess: /v_comparison_bestguess/i.test(q.sql) };
  return { winners, rule };
}

/** One row per line with a vendor → line_no → vendor id (TRD §13.5). */
function winnersFromRows(rows: Row[], cols: string[], inp: Inputs): Map<number, string> {
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
  return winners;
}

type LineCalc = { vendor_id: string; price: number; annual_value: number; runner_up_vendor_id: string | null; runner_up_price: number | null; gap_pct: number | null };
/** A line given to `vendorId` by hand under this rule: its price, and the cheapest other eligible quote as runner-up — or why it can't go there. */
function overrideCalc(inp: Inputs, rule: Rule, lineId: string, vendorId: string, pickId: string | null): LineCalc | { error: string } {
  const vendor = inp.vendors.find((v) => v.id === vendorId);
  const l = inp.lines.find((x) => x.id === lineId)!;
  if (!vendor) return { error: "That vendor isn't on this RFx." };
  const cell = inp.cells.find((c) => c.line_id === l.id && c.vendor_id === vendor.id);
  const p = cell ? priceOf(cell, rule.price_basis, !!rule.include_best_guess) : null;
  if (!p) return { error: `${vendor.name} has no counted price on line ${l.line_no} (${cell ? cell.state.replaceAll("_", " ") : "no quote"}), so the line can't go to them.` };
  const qualified = lineQualified(rule, inp, l.id, pickId);
  if (qualified && vendor.cleared !== true) return { error: `${vendor.name} hasn't cleared the questionnaire, and under this scenario's rule line ${l.line_no} only goes to vendors who have.` };
  // Runner-up after the override: the cheapest other eligible quote (usually the rule's winner — a negative gap is the premium paid).
  const ru = inp.cells.filter((c) => c.line_id === l.id && c.vendor_id !== vendor.id).flatMap((c) => {
    const v = inp.vendors.find((x) => x.id === c.vendor_id); const q = priceOf(c, rule.price_basis, !!rule.include_best_guess);
    return v && q && (!qualified || v.cleared === true) ? [{ id: v.id, name: v.name, price: q.price }] : [];
  }).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))[0] ?? null;
  return { vendor_id: vendor.id, price: p.price, annual_value: p.price * l.annual_qty / 1000, runner_up_vendor_id: ru?.id ?? null, runner_up_price: ru?.price ?? null,
    gap_pct: ru ? Math.round((ru.price - p.price) / p.price * 10000) / 100 : null };
}

/** What a saved option stores per line (scenario_lines), and the rule's own pick when the buyer changed it. */
type Stored = { rfx_line_id: string; line_no: number; vendor_id: string | null; reason: string; is_override: boolean; rule_pick_id: string | null };
type LineRow = { rfx_line_id: string; line_no: number; vendor_id: string | null; price_inr_per_1000: number | null; annual_value_inr: number | null; runner_up_vendor_id: string | null;
  runner_up_price: number | null; gap_pct: number | null; reason: string; is_override: boolean; auto: Record<string, unknown> | null };

/** The rule's picks on today's grid: rule-based options re-allocate; options from an answer re-run the answer's saved query (A1). */
async function rulePicks(inp: Inputs, rule: Rule, stored: Stored[]): Promise<SLine[]> {
  if (rule.type !== "from_query") return allocate(inp, rule);
  let winners: Map<number, string>;
  try {
    const { rows } = await execute(rule.sql!);
    winners = winnersFromRows(rows, rows.length ? Object.keys(rows[0]) : [], inp);
  } catch (e) { // the query no longer runs or no longer allocates: keep its old picks, re-priced
    console.warn(`[scenarios] re-running the saved query failed: ${(e as Error).message}`);
    winners = new Map(stored.filter((l) => l.rule_pick_id).map((l) => [l.line_no, l.rule_pick_id!]));
  }
  return fromQuery(inp, winners, rule);
}

/** Today's lines for an option: the rule's picks, with the buyer's changes kept where that vendor still has a usable price. */
function withOverrides(inp: Inputs, rule: Rule, fresh: SLine[], stored: Stored[]): LineRow[] {
  return fresh.map((f) => {
    const auto = { vendor_id: f.vendor_id, price: f.price, annual_value: f.annual_value, runner_up_vendor_id: f.runner_up_vendor_id, runner_up_price: f.runner_up_price, gap_pct: f.gap_pct, reason: f.reason };
    const mine = stored.find((x) => x.rfx_line_id === f.rfx_line_id && x.is_override);
    const c = mine?.vendor_id && mine.vendor_id !== f.vendor_id ? overrideCalc(inp, rule, f.rfx_line_id, mine.vendor_id, f.vendor_id) : null;
    if (c && !("error" in c)) return { rfx_line_id: f.rfx_line_id, line_no: f.line_no, vendor_id: c.vendor_id, price_inr_per_1000: c.price, annual_value_inr: c.annual_value,
      runner_up_vendor_id: c.runner_up_vendor_id, runner_up_price: c.runner_up_price, gap_pct: c.gap_pct, reason: mine!.reason, is_override: true, auto };
    return { rfx_line_id: f.rfx_line_id, line_no: f.line_no, vendor_id: f.vendor_id, price_inr_per_1000: f.price, annual_value_inr: f.annual_value, runner_up_vendor_id: f.runner_up_vendor_id,
      runner_up_price: f.runner_up_price, gap_pct: f.gap_pct, reason: f.reason, is_override: false, auto: null };
  });
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
  let title = name;
  if (o.queryId) {
    const q = await winnersFromQuery(o.rfxId, o.queryId, inp);
    rule = q.rule; lines = fromQuery(inp, q.winners, rule);
    // The name is just the typed request (the Award box, or Save as scenario left as the question) → a short title; the words stay in rule.question.
    if (q.rule.question && name === q.rule.question.trim().slice(0, 120)) title = await titleFor(o.rfxId, q.rule.question);
  } else {
    const parsed = RuleBody.safeParse(o.rule);
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid rule.");
    rule = parsed.data; lines = allocate(inp, rule);
  }
  const t = totals(lines);
  const b = baseline(inp, rule.price_basis, isQualified(rule), !!rule.include_best_guess);
  const ins = await db().from("scenarios").insert({
    rfx_id: o.rfxId, name: title, rule_text: ruleText(rule), rule, total_inr: t.total, vendor_count: t.vendor_count, single_source_lines: t.single_source_lines,
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
    payload: { name: title, total: t.total, total_short: inrShort(t.total), from_query: rule.type === "from_query", allocated: t.allocated, lines: t.lines } });
  return (await listScenarios(o.rfxId)).find((s) => s.id === ins.data.id)!;
}

export type ScenarioLineView = {
  rfx_line_id: string; line_no: number; description: string; annual_qty: number; vendor_id: string | null; vendor: string | null; price: number | null; annual_value: number | null;
  runner_up: string | null; runner_up_price: number | null; gap_pct: number | null; reason: string; is_override: boolean;
  auto_vendor: string | null; // who the rule gave the line to, when overridden
  rule_pick_id: string | null; // the rule's (or query's) own pick for the line, override or not
  tie: boolean; // the next cheapest quote is the same price (A3: the tie rule chose)
};
/** Every vendor on the RFx in one option: what it wins, or why it wins nothing. */
export type ScenarioVendorView = { name: string; code: string | null; lines: number; value: number; pct: number; note: string | null };
export type ScenarioView = {
  id: string; name: string; rule_text: string; rule: Rule; total: number; vendor_count: number; single_source_lines: number; created_at: string; created_by: string | null;
  created_by_id: string | null;
  baseline: { vendor: string | null; total: number; total_quoted: number; discount: DiscountView | null; note: string | null } | null; savings_vs_baseline: number | null;
  /** P10 D4: total after the discounts this award earns (total stays as quoted), and each vendor's discount explained. */
  total_after: number; discounts: DiscountView[];
  /** P10 D6: winners whose quote has expired or expires within 14 days (days_left < 0 = expired). */
  expiring: { vendor: string; vendor_code: string; until: string; days_left: number }[];
  allocated: number; unallocated: number[]; share: { vendor: string; lines: number; value: number; pct: number }[]; lines: ScenarioLineView[]; fingerprint: string;
  /** A1: the grid changed since this option was saved and today's rule gives a different result on these lines (Refresh brings it up to date). */
  outdated: boolean; changed_lines: number[];
  vendors: ScenarioVendorView[]; ties: number;
  /** The cheapest split with any vendor (including those who didn't clear the questionnaire), same basis — what the qualification rule costs. */
  cheapest_any: number | null;
};

const lineFp = (ls: { line_no: number; vendor_id: string | null; price: number | null }[]) => new Map(ls.map((l) => [l.line_no, `${l.vendor_id ?? "-"}:${l.price === null ? "-" : Number(l.price).toFixed(2)}`]));

/** GET /api/scenarios?rfx= — oldest first (the "vs first" column compares with the first one saved). */
export async function listScenarios(rfxId: string): Promise<ScenarioView[]> {
  const [sQ, vQ, uQ, inp, valQ, rQ] = await Promise.all([
    db().from("scenarios").select("*, scenario_lines(*, rfx_lines(line_no, description, annual_qty))").eq("rfx_id", rfxId).order("created_at"),
    db().from("vendors").select("id, name"), db().from("users").select("id, name"), loadInputs(rfxId),
    db().from("v_vendor_status").select("vendor_id, vendor, vendor_code, validity_until").eq("rfx_id", rfxId),
    db().from("rfx").select("status").eq("id", rfxId).single(),
  ]);
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  if (sQ.error) throw sQ.error;
  const locked = rQ.data?.status === "awarded"; // an awarded RFx can't change, so nothing goes out of date
  const vn = (id: string | null) => (id ? (vQ.data ?? []).find((v) => v.id === id)?.name ?? "?" : null);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const cheapestAny = new Map<string, number | null>();
  return Promise.all((sQ.data ?? []).map(async (s) => {
    const lines: ScenarioLineView[] = (s.scenario_lines as unknown as (Record<string, unknown> & { rfx_lines: { line_no: number; description: string; annual_qty: number } })[]).map((l) => ({
      rfx_line_id: l.rfx_line_id as string, line_no: l.rfx_lines.line_no, description: l.rfx_lines.description, annual_qty: Number(l.rfx_lines.annual_qty),
      vendor_id: l.vendor_id as string | null, vendor: vn(l.vendor_id as string | null), price: n(l.price_inr_per_1000), annual_value: n(l.annual_value_inr),
      runner_up: vn(l.runner_up_vendor_id as string | null), runner_up_price: n(l.runner_up_price), gap_pct: n(l.gap_pct), reason: l.reason as string, is_override: !!l.is_override,
      auto_vendor: l.is_override ? vn(((l.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null) : null,
      rule_pick_id: l.is_override ? ((l.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null : (l.vendor_id as string | null),
      tie: !!l.vendor_id && l.runner_up_vendor_id !== null && n(l.runner_up_price) === n(l.price_inr_per_1000),
    })).sort((a, b) => a.line_no - b.line_no);
    const t = totals(lines.map((l) => ({ vendor_id: l.vendor_id, annual_value: l.annual_value, single_source: false, line_no: l.line_no })));
    const total = Number(s.total_inr ?? 0);
    const dv = withDiscounts(inp, t.share, total);
    // P10 D3: the best single vendor is recomputed from today's data, with that vendor's own discount when it alone meets it.
    const rule = s.rule as Rule;
    const basis = rule?.price_basis ?? "unit", bg = !!rule?.include_best_guess;
    const b = rule ? baseline(inp, basis, isQualified(rule), bg) : null;
    const bd = b?.discount ? withDiscounts(inp, [{ vendor_id: b.vendor_id, lines: b.lines_priced, value: b.total_quoted }], b.total_quoted).discounts.find((x) => x.vendor === vn(b.vendor_id)) ?? null : null;

    // A1: today's result for this option; any line whose vendor or price moved means the saved one is out of date.
    let changed: number[] = [];
    if (rule && !locked && inp.lines.length) {
      const fresh = withOverrides(inp, rule, await rulePicks(inp, rule, lines), lines);
      const was = lineFp(lines), now = lineFp(fresh.map((f) => ({ line_no: f.line_no, vendor_id: f.vendor_id, price: f.price_inr_per_1000 })));
      changed = [...now].filter(([k, v]) => was.get(k) !== v).map(([k]) => k).sort((x, y) => x - y);
    }

    // Who gets what — every vendor, with why a vendor wins nothing (the question the share bar couldn't answer).
    const expiring = (valQ.data ?? []).filter((v) => v.validity_until && t.share.some((x) => x.vendor_id === v.vendor_id))
      .map((v) => ({ vendor: v.vendor as string, vendor_code: v.vendor_code as string, until: v.validity_until as string, days_left: Math.round((Date.parse(v.validity_until as string) - today) / 86_400_000) }))
      .filter((v) => v.days_left <= 14);
    const qualifiedOnly = rule ? isQualified(rule) : false;
    const vendors: ScenarioVendorView[] = inp.vendors.map((v) => {
      const won = t.share.find((x) => x.vendor_id === v.id);
      const exp = expiring.find((e) => e.vendor === v.name);
      if (won) return { name: v.name, code: v.code ?? null, lines: won.lines, value: won.value, pct: won.pct,
        note: exp ? (exp.days_left < 0 ? `Quote expired on ${exp.until}` : `Quote valid only until ${exp.until}`) : null };
      const mine = (l: ScenarioLineView) => { const c = inp.cells.find((x) => x.line_id === l.rfx_line_id && x.vendor_id === v.id); return c ? priceOf(c, basis, bg) : null; };
      let note: string;
      if (qualifiedOnly && v.cleared !== true) note = v.cleared === false ? "Didn't clear the questionnaire" : "Hasn't cleared the questionnaire yet";
      else if (!lines.some((l) => mine(l))) note = "No usable prices yet (see Review)";
      else {
        const same = lines.filter((l) => l.price !== null && mine(l)?.price === l.price).map((l) => l.line_no);
        note = `Never the cheapest${same.length ? `; same price as the winner on line${same.length === 1 ? "" : "s"} ${same.join(", ")}` : ""}${v.cleared !== true ? "; didn't clear the questionnaire" : ""}`;
      }
      return { name: v.name, code: v.code ?? null, lines: 0, value: 0, pct: 0, note };
    }).sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));

    const key = `${basis}:${bg}`;
    if (!cheapestAny.has(key)) {
      const any = totals(allocate(inp, { type: "cheapest_per_line", qualified_only: false, price_basis: basis, include_best_guess: bg }));
      cheapestAny.set(key, any.allocated ? withDiscounts(inp, any.share, any.total).total_after : null);
    }

    return {
      id: s.id, name: s.name, rule_text: s.rule_text, rule, total, vendor_count: s.vendor_count ?? 0, single_source_lines: s.single_source_lines ?? 0,
      created_at: s.created_at, created_by: (uQ.data ?? []).find((u) => u.id === s.created_by)?.name ?? null, created_by_id: s.created_by ?? null,
      baseline: b ? { vendor: vn(b.vendor_id), total: b.total, total_quoted: b.total_quoted, discount: bd, note: b.note } : null,
      savings_vs_baseline: b ? b.total - dv.total_after : null, total_after: dv.total_after, discounts: dv.discounts,
      expiring, allocated: t.allocated, unallocated: t.unallocated_lines,
      share: t.share.map((x) => ({ vendor: vn(x.vendor_id)!, lines: x.lines, value: x.value, pct: x.pct })), lines,
      fingerprint: fingerprint(lines), outdated: changed.length > 0, changed_lines: changed,
      vendors, ties: lines.filter((l) => l.tie).length, cheapest_any: cheapestAny.get(key) ?? null,
    };
  }));
}

/** POST /api/scenarios/{id}/refresh (A1) — both roles: the option re-worked on today's grid; the buyer's line changes are kept where still possible. */
export async function refreshScenario(id: string, user: SessionUser) {
  await assertOpen({ scenario: id });
  const { data: s, error } = await db().from("scenarios").select("id, rfx_id, name, rule").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found.", undefined, 404);
  const before = (await listScenarios(s.rfx_id)).find((x) => x.id === id)!;
  const inp = await loadInputs(s.rfx_id);
  const rule = s.rule as Rule;
  const fresh = withOverrides(inp, rule, await rulePicks(inp, rule, before.lines), before.lines);
  const dropped = before.lines.filter((l) => l.is_override && !fresh.some((f) => f.rfx_line_id === l.rfx_line_id && f.is_override)).map((l) => l.line_no);
  const del = await db().from("scenario_lines").delete().eq("scenario_id", id);
  if (del.error) throw del.error;
  const ins = await db().from("scenario_lines").insert(fresh.map((f) => ({ scenario_id: id, rfx_line_id: f.rfx_line_id, vendor_id: f.vendor_id, price_inr_per_1000: f.price_inr_per_1000,
    annual_value_inr: f.annual_value_inr, runner_up_vendor_id: f.runner_up_vendor_id, runner_up_price: f.runner_up_price, gap_pct: f.gap_pct, reason: f.reason, is_override: f.is_override, auto: f.auto })));
  if (ins.error) throw ins.error;
  const b = baseline(inp, rule.price_basis, isQualified(rule), !!rule.include_best_guess);
  const up = await db().from("scenarios").update({ baseline_single_vendor_total: b?.total ?? null, baseline_vendor_id: b?.vendor_id ?? null, baseline_note: b?.note ?? null }).eq("id", id);
  if (up.error) throw up.error;
  const t = await writeTotals(id);
  await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.refreshed", entity_type: "scenario", entity_id: id,
    payload: { name: s.name, changed_lines: before.changed_lines, overrides_dropped: dropped, total_before: before.total, total: t.total } });
  return { ok: true, changed_lines: before.changed_lines, overrides_dropped: dropped };
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
  if (body.vendor_id === line.vendor_id) throw new AppError("BAD_REQUEST", `Line ${lineNo} already goes to ${inp.vendors.find((v) => v.id === body.vendor_id)?.name ?? "that vendor"}.`);
  const pick = line.is_override ? ((line.auto ?? {}) as { vendor_id?: string | null }).vendor_id ?? null : line.vendor_id;
  const c = overrideCalc(inp, rule, body.rfx_line_id!, body.vendor_id, pick);
  if ("error" in c) throw new AppError(c.error.startsWith("That vendor") ? "BAD_REQUEST" : "NOT_ELIGIBLE", c.error, undefined, 400);
  const vendor = inp.vendors.find((v) => v.id === c.vendor_id)!;
  const auto = line.is_override ? line.auto : { vendor_id: line.vendor_id, price: line.price_inr_per_1000, annual_value: line.annual_value_inr, runner_up_vendor_id: line.runner_up_vendor_id,
    runner_up_price: line.runner_up_price, gap_pct: line.gap_pct, reason: line.reason };
  const up = await db().from("scenario_lines").update({
    vendor_id: vendor.id, price_inr_per_1000: c.price, annual_value_inr: c.annual_value, runner_up_vendor_id: c.runner_up_vendor_id, runner_up_price: c.runner_up_price,
    gap_pct: c.gap_pct, reason: `manual override: ${reason}`, is_override: true, auto,
  }).eq("id", line.id);
  if (up.error) throw up.error;
  await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.override", entity_type: "scenario", entity_id: s.id,
    payload: { name: s.name, line_no: lineNo, vendor: vendor.name, from_vendor: await vname((auto as { vendor_id: string | null }).vendor_id), reason } });
  return { ok: true, totals: await writeTotals(s.id) };
}

/** Buyer / admin: any option. Approver: only the options she created (DECISIONS 2026-09-25 "option menu"). */
function mayManage(s: { created_by: string | null }, user: SessionUser) {
  if (user.role === "approver" && s.created_by !== user.id) throw new AppError("FORBIDDEN", "Sujit created this option; only Sujit can change or delete it.", undefined, 403);
}

/** A short title (≤ 8 words) for an option from what was typed; the typed words stay in rule.question. Falls back to tidyTitle. */
export async function titleFor(rfxId: string, text: string): Promise<string> {
  try {
    const r = await generateJSON({ tier: "fast", purpose: "option_title", rfx_id: rfxId, temperature: 0.2, schema: z.object({ title: z.string().min(3).max(80) }),
      parts: [{ text: `Write a short title, at most 10 words, for an award option described by a buyer as: "${text.slice(0, 600)}"
The title must keep how each group of lines is decided (e.g. "5-ply to cheapest qualified, 3-ply to cheapest", "3-ply first, rest to cheapest") — never just "Split award".
Plain words, sentence case, correct spelling, keep ply numbers, vendor names and "qualified" / "landed cost" when they are asked for; no quotes; don't start with "Scenario", "Option" or "Create". Return JSON {"title": string}.` }] });
    return r.title.trim().replace(/^["“]|["”.]$/g, "");
  } catch (e) {
    console.warn(`[scenarios] title fell back: ${(e as Error).message}`);
    return tidyTitle(text);
  }
}

/**
 * PATCH /api/scenarios/{id} {name?, question?} — rename, and (options from a question) re-work it from new words:
 * same option, new lines; the buyer's line changes kept where that vendor still has a price. Nothing changes if the words don't give a split.
 */
export async function editScenario(id: string, body: { name?: string; question?: string }, user: SessionUser) {
  await assertOpen({ scenario: id });
  const { data: s } = await db().from("scenarios").select("id, rfx_id, name, rule, created_by").eq("id", id).maybeSingle();
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found.", undefined, 404);
  mayManage(s, user);
  const rule = s.rule as Rule;
  const name = body.name?.trim().slice(0, 120);
  const question = body.question?.trim();
  if (body.name !== undefined && !name) throw new AppError("BAD_REQUEST", "Give the option a name.");
  if (question !== undefined && rule.type !== "from_query") throw new AppError("BAD_REQUEST", "This option was built by rule; it can be renamed, but to change the rule build a new one.");
  const changed = question !== undefined && question !== (rule.question ?? "").trim();
  if (changed && !question) throw new AppError("BAD_REQUEST", "Say how the lines should be split.");
  if (changed && user.role === "approver") {
    const { count } = await db().from("awards").select("id", { count: "exact", head: true }).eq("scenario_id", id);
    if (count) throw new AppError("IN_USE", "The memo was drafted from this option; only Sujit can change it now.", undefined, 409);
  }

  if (changed) {
    const before = (await listScenarios(s.rfx_id)).find((x) => x.id === id)!;
    const a = await ask({ rfxId: s.rfx_id, question: question!, userId: user.id, allocate: true });
    if (!a.ok) throw new AppError("NOT_AN_ALLOCATION", "Those words couldn't be worked out from the grid — the option is unchanged. Try rephrasing.", undefined, 400);
    const inp = await loadInputs(s.rfx_id);
    const q = await winnersFromQuery(s.rfx_id, a.query_id, inp); // throws NOT_AN_ALLOCATION with the reason; the option stays as it was
    const fresh = withOverrides(inp, q.rule, fromQuery(inp, q.winners, q.rule), before.lines);
    const del = await db().from("scenario_lines").delete().eq("scenario_id", id);
    if (del.error) throw del.error;
    const ins = await db().from("scenario_lines").insert(fresh.map((f) => ({ scenario_id: id, rfx_line_id: f.rfx_line_id, vendor_id: f.vendor_id, price_inr_per_1000: f.price_inr_per_1000,
      annual_value_inr: f.annual_value_inr, runner_up_vendor_id: f.runner_up_vendor_id, runner_up_price: f.runner_up_price, gap_pct: f.gap_pct, reason: f.reason, is_override: f.is_override, auto: f.auto })));
    if (ins.error) throw ins.error;
    const b = baseline(inp, q.rule.price_basis, isQualified(q.rule), !!q.rule.include_best_guess);
    const up = await db().from("scenarios").update({ rule: q.rule, rule_text: ruleText(q.rule), name: name ?? await titleFor(s.rfx_id, question!),
      baseline_single_vendor_total: b?.total ?? null, baseline_vendor_id: b?.vendor_id ?? null, baseline_note: b?.note ?? null }).eq("id", id);
    if (up.error) throw up.error;
    const t = await writeTotals(id);
    await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.edited", entity_type: "scenario", entity_id: id,
      payload: { name: name ?? s.name, from: rule.question ?? null, to: question, total_before: before.total, total: t.total } });
  } else if (name && name !== s.name) {
    const up = await db().from("scenarios").update({ name }).eq("id", id);
    if (up.error) throw up.error;
    await audit({ rfx_id: s.rfx_id, actor: user.id, event: "scenario.renamed", entity_type: "scenario", entity_id: id, payload: { from: s.name, to: name } });
  }
  return (await listScenarios(s.rfx_id)).find((x) => x.id === id)!;
}

/** DELETE /api/scenarios/{id} — buyer: any option; approver: her own; the option a memo was drafted from stays until the memo moves to another one. */
export async function deleteScenario(id: string, user: SessionUser) {
  await assertOpen({ scenario: id });
  const { data: s } = await db().from("scenarios").select("id, rfx_id, name, created_by").eq("id", id).maybeSingle();
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found.", undefined, 404);
  mayManage(s, user);
  const { count } = await db().from("awards").select("id", { count: "exact", head: true }).eq("scenario_id", id);
  if (count) throw new AppError("IN_USE", "The memo was drafted from this option. Draft the memo from another option first.", undefined, 409);
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
