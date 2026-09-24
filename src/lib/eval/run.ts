import "server-only";
import { db } from "@/lib/db";
import { get } from "@/lib/storage";

// TRD §18 + Dataset README §5. Gold key read from the seed bucket so the Eval page (P8) works on Vercel too.
type GoldCell = {
  line_no: number; vendor_code: string; expected_state: string; expected_unit_price_inr_per_1000: number | null;
  best_guess?: number; alt_expected_unit_price_inr_per_1000?: number; alt_expected_state?: string;
  after_clarification?: { expected_state: string; expected_unit_price_inr_per_1000: number };
};
type GoldQ = { q_no: number; vendor_code: string; expected_state: string; expected_bool?: boolean | null; expected_number?: number; expected_text_contains?: string };
type Gold = { tolerance_pct: number; cells: GoldCell[]; questionnaire: GoldQ[] };

export type Verdict = "correct" | "flagged_ok" | "wrong" | "missing";
export type CellResult = { line_no: number; vendor: string; expected_state: string; expected: number | null; state: string | null; got: number | null; best_guess: number | null; verdict: Verdict; why?: string };
export type EvalTotals = { cells: number; correct: number; flagged_ok: number; wrong: number; missing: number; questionnaire_correct: number; questionnaire_total: number };
export type EvalResult = { rfx_id: string; totals: EvalTotals; per_cell: CellResult[]; per_question: { q_no: number; vendor: string; ok: boolean; expected: GoldQ; got: unknown }[]; states: Record<string, Record<string, number>> };

const within = (got: number | null | undefined, exp: number | null | undefined, tolPct: number) =>
  got != null && exp != null && Math.abs(got - exp) <= (Math.abs(exp) * tolPct) / 100;

/** Pure verdict for one cell (exported for tests). */
export function verdict(g: GoldCell, c: { state: string; value: number | null; best_guess: number | null } | null, tol: number, hasDiscountReview: boolean): { verdict: Verdict; why?: string } {
  if (!c) return { verdict: "missing" };
  const exp = g.expected_unit_price_inr_per_1000;
  if (c.state === "reviewed") { // post-review runs: judge the buyer-approved value
    const target = g.after_clarification?.expected_unit_price_inr_per_1000 ?? exp ?? g.best_guess ?? null;
    return within(c.value, target, tol) ? { verdict: "correct" } : { verdict: "wrong", why: `reviewed value ${c.value} vs ${target}` };
  }
  if (exp !== null) {
    if (c.state === g.expected_state && within(c.value, exp, tol)) return { verdict: "correct" };
    if ((c.state === "ambiguous" || c.state === "low_confidence") && within(c.best_guess, exp, tol)) return { verdict: "flagged_ok", why: "honest uncertain state, best guess right" };
    if (g.alt_expected_state && c.state === g.alt_expected_state && within(c.value, g.alt_expected_unit_price_inr_per_1000, tol) && hasDiscountReview) return { verdict: "flagged_ok", why: "printed value + discount_treatment flag (alt)" };
    return { verdict: "wrong", why: c.state !== g.expected_state ? `state ${c.state}` : `value ${c.value} vs ${exp}` };
  }
  if (c.state === g.expected_state) {
    if (g.expected_state === "ambiguous" && g.best_guess != null && c.best_guess != null && !within(c.best_guess, g.best_guess, tol)) return { verdict: "wrong", why: `best guess ${c.best_guess} vs ${g.best_guess}` };
    return { verdict: "correct" };
  }
  // OrientPack line 14: a legible photo read correctly as 'inferred' is also accepted (README §3 V4).
  if (g.expected_state === "low_confidence" && c.state === "inferred" && within(c.value, g.best_guess, tol)) return { verdict: "correct", why: "legible read accepted" };
  return { verdict: "wrong", why: `state ${c.state}${c.value != null ? ` with value ${c.value}` : ""}` };
}

export async function runEval(rfxId: string, opts: { save?: boolean } = {}): Promise<EvalResult> {
  const gold = JSON.parse((await get("seed", "seed/gold/gold.json")).toString("utf8")) as Gold;
  const [cellsQ, qaQ, reviewsQ] = await Promise.all([
    db().from("line_quotes").select("state, unit_price_inr_per_1000, best_guess_value, rfx_lines(line_no), vendors(short_code)").eq("rfx_id", rfxId),
    db().from("v_questionnaire").select("q_no, vendor_code, state, answer_bool, answer_number, answer_text").eq("rfx_id", rfxId),
    db().from("review_items").select("vendors(short_code)").eq("rfx_id", rfxId).eq("type", "discount_treatment"),
  ]);
  for (const q of [cellsQ, qaQ, reviewsQ]) if (q.error) throw q.error;
  type Row = { state: string; unit_price_inr_per_1000: number | null; best_guess_value: number | null; rfx_lines: { line_no: number }; vendors: { short_code: string } };
  const cells = new Map((cellsQ.data as unknown as Row[]).map((r) => [`${r.vendors.short_code}:${r.rfx_lines.line_no}`, r]));
  const discountVendors = new Set((reviewsQ.data as unknown as { vendors: { short_code: string } | null }[]).map((r) => r.vendors?.short_code));

  const per_cell: CellResult[] = gold.cells.map((g) => {
    const r = cells.get(`${g.vendor_code}:${g.line_no}`);
    const c = r ? { state: r.state, value: num(r.unit_price_inr_per_1000), best_guess: num(r.best_guess_value) } : null;
    const v = verdict(g, c, gold.tolerance_pct, discountVendors.has(g.vendor_code));
    return { line_no: g.line_no, vendor: g.vendor_code, expected_state: g.expected_state, expected: g.expected_unit_price_inr_per_1000 ?? g.best_guess ?? null, state: c?.state ?? null, got: c?.value ?? null, best_guess: c?.best_guess ?? null, ...v };
  });

  const qa = qaQ.data ?? [];
  const per_question = gold.questionnaire.map((g) => {
    const a = qa.find((x) => x.q_no === g.q_no && x.vendor_code === g.vendor_code);
    const ok = !!a && a.state === g.expected_state
      && (g.expected_bool == null || a.answer_bool === g.expected_bool)
      && (g.expected_number === undefined || Number(a.answer_number) === g.expected_number)
      && (g.expected_text_contains === undefined || (a.answer_text ?? "").toLowerCase().includes(g.expected_text_contains.toLowerCase()));
    return { q_no: g.q_no, vendor: g.vendor_code, ok, expected: g, got: a ? { state: a.state, bool: a.answer_bool, number: a.answer_number } : null };
  });

  const count = (v: Verdict) => per_cell.filter((c) => c.verdict === v).length;
  const totals: EvalTotals = {
    cells: per_cell.length, correct: count("correct"), flagged_ok: count("flagged_ok"), wrong: count("wrong"), missing: count("missing"),
    questionnaire_correct: per_question.filter((q) => q.ok).length, questionnaire_total: per_question.length,
  };
  const states: Record<string, Record<string, number>> = {};
  for (const c of per_cell) (states[c.vendor] ??= {})[c.state ?? "missing"] = (states[c.vendor][c.state ?? "missing"] ?? 0) + 1;

  if (opts.save !== false) {
    const { error } = await db().from("eval_runs").insert({ rfx_id: rfxId, totals, per_cell, per_question });
    if (error) throw error;
  }
  return { rfx_id: rfxId, totals, per_cell, per_question, states };
}

/** RFx the gold key can judge: those whose replies were loaded from a seed set (the gold key describes the seed pack). */
export async function evalEligible(): Promise<{ id: string; code: string; title: string; set: string }[]> {
  const [seeded, loads] = await Promise.all([
    db().from("responses").select("rfx_id, rfx(code, title)").eq("source", "seed"),
    db().from("audit_events").select("rfx_id, payload, created_at").eq("event", "seed.responses_loaded").order("created_at", { ascending: false }),
  ]);
  for (const q of [seeded, loads]) if (q.error) throw q.error;
  const by = new Map<string, { id: string; code: string; title: string; set: string }>();
  for (const r of seeded.data as unknown as { rfx_id: string; rfx: { code: string; title: string } }[]) {
    if (by.has(r.rfx_id)) continue;
    const set = (loads.data ?? []).find((l) => l.rfx_id === r.rfx_id)?.payload?.set ?? "clean"; // newest load wins
    by.set(r.rfx_id, { id: r.rfx_id, code: r.rfx.code, title: r.rfx.title, set });
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export type StoredEval = { id: string; rfx_id: string; ran_at: string; totals: EvalTotals; per_cell: CellResult[]; per_question: EvalResult["per_question"] };
export async function latestEval(rfxId: string): Promise<StoredEval | null> {
  const { data, error } = await db().from("eval_runs").select("*").eq("rfx_id", rfxId).order("ran_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as StoredEval | null;
}

/** Plain-text table for the scripts (CLAUDE.md §7 wants the numbers pasted into PROGRESS.md). */
export function formatEval(r: EvalResult): string {
  const vendors = [...new Set(r.per_cell.map((c) => c.vendor))];
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const lines = [
    `${pad("vendor", 12)}${pad("correct", 9)}${pad("flag_ok", 9)}${pad("wrong", 7)}${pad("missing", 9)}states`,
    ...vendors.map((v) => {
      const cs = r.per_cell.filter((c) => c.vendor === v);
      const n = (x: Verdict) => cs.filter((c) => c.verdict === x).length;
      return `${pad(v, 12)}${pad(n("correct"), 9)}${pad(n("flagged_ok"), 9)}${pad(n("wrong"), 7)}${pad(n("missing"), 9)}${Object.entries(r.states[v]).map(([s, k]) => `${s} ${k}`).join(", ")}`;
    }),
    "",
    `TOTAL ${r.totals.correct + r.totals.flagged_ok}/${r.totals.cells} (correct ${r.totals.correct}, flagged_ok ${r.totals.flagged_ok}, wrong ${r.totals.wrong}, missing ${r.totals.missing}) · questionnaire ${r.totals.questionnaire_correct}/${r.totals.questionnaire_total}`,
  ];
  const off = r.per_cell.filter((c) => c.verdict !== "correct");
  if (off.length) lines.push("", "Cells not 'correct':", ...off.map((c) => `  ${c.vendor} L${c.line_no}: ${c.verdict} — expected ${c.expected_state}${c.expected != null ? ` ${c.expected}` : ""}, got ${c.state ?? "no cell"}${c.got != null ? ` ${c.got}` : ""}${c.best_guess != null ? ` (best guess ${c.best_guess})` : ""}${c.why ? ` · ${c.why}` : ""}`));
  const qOff = r.per_question.filter((q) => !q.ok);
  if (qOff.length) lines.push("", "Questionnaire answers not matching gold:", ...qOff.map((q) => `  ${q.vendor} Q${q.q_no}: expected ${JSON.stringify(q.expected)} got ${JSON.stringify(q.got)}`));
  return lines.join("\n");
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
