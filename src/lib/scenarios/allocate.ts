// TRD §14.1 built-in allocation rules — deterministic, no model, no I/O (unit-tested in allocate.test.ts).
// Totals and the single-vendor baseline per TRD §13.5 / §14.2.

export type ALine = { id: string; line_no: number; description: string; annual_qty: number; ply: number | null; item_type: string | null; delivery_location: string | null };
/** q_score = share of mandatory questions answered with passes = true (TRD §14.1). */
export type AVendor = { id: string; name: string; code?: string; cleared: boolean | null; q_score: number };
/** guess_* = the system's best guess on an ambiguous / low-confidence cell (landed = guess + the vendor's freight). */
export type ACell = { line_id: string; vendor_id: string; state: string; unit: number | null; landed: number | null; guess_unit: number | null; guess_landed: number | null };
/** P10 D2–D3: a vendor's total-level discount and what it depends on (read from its quote; checked here per award option). */
export type ADiscount = { vendor_id: string; pct: number; condition: string | null; kind: "all_lines" | "min_lines" | "min_value" | "payment_days" | "none" | "unclear";
  min_lines: number | null; min_value_inr: number | null; payment_days: number | null };
export type Inputs = { lines: ALine[]; vendors: AVendor[]; cells: ACell[]; discounts?: ADiscount[]; payment_days?: number | null };

export type Basis = "unit" | "landed";
export type Filter = { ply?: number; item_type?: string; delivery_location?: string; line_nos?: number[] };
export type SubRule = { type: "cheapest_per_line" | "weighted"; qualified_only: boolean; weights?: { price: number; questionnaire: number } };
export type Rule = {
  type: "cheapest_per_line" | "weighted" | "grouped" | "from_query";
  price_basis: Basis; include_best_guess?: boolean;
  qualified_only?: boolean; weights?: { price: number; questionnaire: number }; // cheapest_per_line / weighted / from_query
  groups?: { filter: Filter; rule: SubRule }[];                                 // grouped
  query_id?: string; question?: string; sql?: string;                            // from_query (TRD §13.5)
};

export type SLine = {
  rfx_line_id: string; line_no: number; vendor_id: string | null; price: number | null; annual_value: number | null;
  runner_up_vendor_id: string | null; runner_up_price: number | null; gap_pct: number | null; reason: string;
  single_source: boolean; best_guess: boolean;
};

const COUNTED = ["confirmed", "inferred", "reviewed"];
const GUESSABLE = ["ambiguous", "low_confidence"];

/** The price a cell offers under this basis, or null when it isn't eligible. */
export function priceOf(c: ACell, basis: Basis, includeBestGuess = false): { price: number; guess: boolean } | null {
  const p = basis === "unit" ? c.unit : c.landed;
  if (COUNTED.includes(c.state) && p !== null) return { price: p, guess: false };
  const g = basis === "unit" ? c.guess_unit : c.guess_landed;
  if (includeBestGuess && GUESSABLE.includes(c.state) && g !== null) return { price: g, guess: true };
  return null;
}

type Offer = { vendor: AVendor; price: number; guess: boolean };
function offers(inp: Inputs, line: ALine, basis: Basis, qualifiedOnly: boolean, includeBestGuess: boolean): Offer[] {
  return inp.cells.filter((c) => c.line_id === line.id).flatMap((c) => {
    const vendor = inp.vendors.find((v) => v.id === c.vendor_id);
    const p = priceOf(c, basis, includeBestGuess);
    return vendor && p && (!qualifiedOnly || vendor.cleared === true) ? [{ vendor, ...p }] : [];
  });
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const gap = (win: number | null, ru: number | null) => (win && ru !== null ? r2((ru - win) / win * 100) : null);
const annual = (price: number | null, line: ALine) => (price === null ? null : price * line.annual_qty / 1000);
const byName = (a: Offer, b: Offer) => a.vendor.name.localeCompare(b.vendor.name);

export function filterLabel(f: Filter): string {
  if (f.ply !== undefined) return `${f.ply}-ply`;
  if (f.item_type) return f.item_type;
  if (f.delivery_location) return f.delivery_location;
  if (f.line_nos?.length) return `lines ${f.line_nos.join(", ")}`;
  return "all lines";
}
export function matches(f: Filter, l: ALine): boolean {
  if (f.ply !== undefined && l.ply !== f.ply) return false;
  if (f.item_type && (l.item_type ?? "").toLowerCase() !== f.item_type.toLowerCase()) return false;
  if (f.delivery_location && (l.delivery_location ?? "").toLowerCase() !== f.delivery_location.toLowerCase()) return false;
  if (f.line_nos?.length && !f.line_nos.includes(l.line_no)) return false;
  return true;
}

/** One line under one (sub)rule: winner, runner-up, gap, reason in words. */
function allocateLine(inp: Inputs, line: ALine, rule: SubRule, basis: Basis, bg: boolean, prefix = ""): SLine {
  const os = offers(inp, line, basis, rule.qualified_only, bg);
  const base = { rfx_line_id: line.id, line_no: line.line_no, single_source: os.length === 1 };
  if (!os.length) return { ...base, vendor_id: null, price: null, annual_value: null, runner_up_vendor_id: null, runner_up_price: null, gap_pct: null, best_guess: false,
    reason: `${prefix}no ${rule.qualified_only ? "qualified " : ""}quote` };
  let ranked: Offer[], reason: string;
  const who = rule.qualified_only ? "qualified" : "overall";
  if (rule.type === "weighted") {
    const w = rule.weights ?? { price: 0.7, questionnaire: 0.3 };
    const min = Math.min(...os.map((o) => o.price));
    const score = (o: Offer) => w.price * (min / o.price) + w.questionnaire * o.vendor.q_score;
    ranked = [...os].sort((a, b) => score(b) - score(a) || byName(a, b));
    reason = `weighted ${w.price}/${w.questionnaire}: score ${score(ranked[0]).toFixed(2)}`;
    if (ranked[1] && score(ranked[1]) === score(ranked[0])) reason += ` (tie with ${ranked[1].vendor.name}; lower name wins)`;
  } else {
    ranked = [...os].sort((a, b) => a.price - b.price || byName(a, b));
    reason = `cheapest ${who}${basis === "landed" ? " (landed)" : ""}`;
    if (ranked[1] && ranked[1].price === ranked[0].price) reason += ` (tie with ${ranked[1].vendor.name} at the same price; lower name wins)`;
  }
  const [win, ru] = ranked;
  if (win.guess) reason += " — best guess";
  return { ...base, vendor_id: win.vendor.id, price: win.price, annual_value: annual(win.price, line), best_guess: win.guess,
    runner_up_vendor_id: ru?.vendor.id ?? null, runner_up_price: ru?.price ?? null, gap_pct: gap(win.price, ru?.price ?? null), reason: prefix + reason };
}

/** TRD §14.1: cheapest_per_line, grouped (uncovered lines unallocated and flagged), weighted. */
export function allocate(inp: Inputs, rule: Rule): SLine[] {
  const bg = !!rule.include_best_guess;
  const lines = [...inp.lines].sort((a, b) => a.line_no - b.line_no);
  if (rule.type === "grouped") {
    return lines.map((l) => {
      const g = (rule.groups ?? []).find((x) => matches(x.filter, l));
      if (!g) return { rfx_line_id: l.id, line_no: l.line_no, vendor_id: null, price: null, annual_value: null, runner_up_vendor_id: null, runner_up_price: null, gap_pct: null, single_source: false, best_guess: false, reason: "not covered by any group" };
      return allocateLine(inp, l, g.rule, rule.price_basis, bg, `${filterLabel(g.filter)} group: `);
    });
  }
  if (rule.type === "from_query") throw new Error("from_query scenarios are built by fromQuery()");
  return lines.map((l) => allocateLine(inp, l, { type: rule.type as SubRule["type"], qualified_only: !!rule.qualified_only, weights: rule.weights }, rule.price_basis, bg));
}

/**
 * TRD §13.5: winners copied from a saved answer; prices, runner-up and gap recomputed from the comparison (never the query's own numbers).
 * The reason says whether the pick is the cheapest qualified / overall quote or simply the query's choice.
 */
export function fromQuery(inp: Inputs, winners: Map<number, string>, rule: Rule): SLine[] {
  const bg = !!rule.include_best_guess;
  return [...inp.lines].sort((a, b) => a.line_no - b.line_no).map((l) => {
    const vid = winners.get(l.line_no);
    const base = { rfx_line_id: l.id, line_no: l.line_no };
    const cell = vid ? inp.cells.find((c) => c.line_id === l.id && c.vendor_id === vid) : undefined;
    const p = cell ? priceOf(cell, rule.price_basis, bg) : null;
    if (!vid || !p) return { ...base, vendor_id: null, price: null, annual_value: null, runner_up_vendor_id: null, runner_up_price: null, gap_pct: null, single_source: false, best_guess: false,
      reason: vid ? "the answer picked a vendor with no counted price on this line" : "not in the answer" };
    const pool = offers(inp, l, rule.price_basis, !!rule.qualified_only, bg);
    const others = pool.filter((o) => o.vendor.id !== vid).sort((a, b) => a.price - b.price || byName(a, b));
    const minQ = Math.min(...offers(inp, l, rule.price_basis, true, bg).map((o) => o.price));
    const minAll = Math.min(...offers(inp, l, rule.price_basis, false, bg).map((o) => o.price));
    const reason = p.price === minQ ? "cheapest qualified" : p.price === minAll ? "cheapest overall" : "as chosen by the query";
    return { ...base, vendor_id: vid, price: p.price, annual_value: annual(p.price, l), best_guess: p.guess, single_source: others.length === 0,
      runner_up_vendor_id: others[0]?.vendor.id ?? null, runner_up_price: others[0]?.price ?? null, gap_pct: gap(p.price, others[0]?.price ?? null),
      reason: reason + (rule.price_basis === "landed" ? " (landed)" : "") + (p.guess ? " — best guess" : "") };
  });
}

export type Totals = {
  total: number; vendor_count: number; allocated: number; lines: number; single_source_lines: number; unallocated_lines: number[];
  share: { vendor_id: string; lines: number; value: number; pct: number }[];
};
export function totals(lines: { vendor_id: string | null; annual_value: number | null; single_source: boolean; line_no: number }[]): Totals {
  const won = lines.filter((l) => l.vendor_id && l.annual_value !== null);
  const total = won.reduce((a, l) => a + l.annual_value!, 0);
  const by = new Map<string, { lines: number; value: number }>();
  for (const l of won) { const s = by.get(l.vendor_id!) ?? { lines: 0, value: 0 }; s.lines++; s.value += l.annual_value!; by.set(l.vendor_id!, s); }
  return {
    total, vendor_count: by.size, allocated: won.length, lines: lines.length, single_source_lines: won.filter((l) => l.single_source).length,
    unallocated_lines: lines.filter((l) => !l.vendor_id).map((l) => l.line_no),
    share: [...by].map(([vendor_id, s]) => ({ vendor_id, ...s, pct: total ? s.value / total * 100 : 0 })).sort((a, b) => b.value - a.value),
  };
}

export type DiscountLine = { vendor_id: string; pct: number; condition: string | null; met: boolean | null; why: string; saving: number };
const inr0 = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/**
 * P10 D3: each vendor's discount against what that vendor wins in this award option. Met → pct off its awarded value.
 * "unclear" is never applied (the buyer settles it on the review card). Pure; the same rule for every vendor.
 */
export function applyDiscounts(share: { vendor_id: string; lines: number; value: number }[], inp: Pick<Inputs, "lines" | "discounts" | "payment_days">): { lines: DiscountLine[]; saving: number } {
  const n = inp.lines.length;
  const out = (inp.discounts ?? []).map((d): DiscountLine => {
    const s = share.find((x) => x.vendor_id === d.vendor_id) ?? { lines: 0, value: 0 };
    let met: boolean | null, why: string;
    switch (d.kind) {
      case "all_lines": met = s.lines === n; why = `${s.lines} of ${n} lines awarded; needs all ${n}`; break;
      case "min_lines": met = s.lines >= (d.min_lines ?? Infinity); why = `${s.lines} lines awarded; needs at least ${d.min_lines}`; break;
      case "min_value": met = s.value >= (d.min_value_inr ?? Infinity); why = `${inr0(s.value)} awarded; needs at least ${inr0(d.min_value_inr ?? 0)}`; break;
      case "payment_days": met = inp.payment_days != null && d.payment_days != null && inp.payment_days <= d.payment_days; why = `we pay at ${inp.payment_days ?? "?"} days; needs payment within ${d.payment_days}`; break;
      case "none": met = s.lines > 0; why = s.lines ? "no condition" : "no lines awarded"; break;
      default: met = null; why = "condition unclear — settle it on the review card";
    }
    if (met && !s.lines) { met = false; why = "no lines awarded"; }
    return { vendor_id: d.vendor_id, pct: d.pct, condition: d.condition, met, why, saving: met ? s.value * d.pct / 100 : 0 };
  });
  return { lines: out, saving: out.reduce((a, d) => a + d.saving, 0) };
}

/** "Sri Balaji Packaging −3% (“if all 30 items are awarded to us”): met — 30 of 30 lines awarded; needs all 30" (Decide, Award, memo, Overview). */
export function discountText(d: { vendor: string; pct: number; condition: string | null; met: boolean | null; why: string }): string {
  return `${d.vendor} −${d.pct}%${d.condition ? ` (“${d.condition}”)` : ""}: ${d.met === true ? "met" : d.met === false ? "not met" : "not applied"} — ${d.why}`;
}

/** total = after any discount whose condition the single-vendor award meets; total_quoted = as quoted. */
export type Baseline = { vendor_id: string; total: number; total_quoted: number; discount: DiscountLine | null; lines_priced: number; note: string | null };
/**
 * TRD §13.5: the cheapest single vendor among those who priced every line (same eligibility as the scenario:
 * qualified vendors when it is qualified-only). If nobody priced every line, the vendors with the most lines priced
 * are compared over the lines each priced, with a note (DECISIONS P7).
 */
export function baseline(inp: Inputs, basis: Basis, qualifiedOnly: boolean, includeBestGuess = false): Baseline | null {
  const cands = inp.vendors.filter((v) => !qualifiedOnly || v.cleared === true).map((v) => {
    let total = 0, n = 0;
    for (const l of inp.lines) {
      const c = inp.cells.find((x) => x.line_id === l.id && x.vendor_id === v.id);
      const p = c ? priceOf(c, basis, includeBestGuess) : null;
      if (p) { total += p.price * l.annual_qty / 1000; n++; }
    }
    // Everything to this one vendor: its own discount is checked against that award (P10 D3).
    const d = applyDiscounts([{ vendor_id: v.id, lines: n, value: total }], { ...inp, discounts: (inp.discounts ?? []).filter((x) => x.vendor_id === v.id) });
    return { v, total: total - d.saving, quoted: total, discount: d.lines[0] ?? null, n };
  }).filter((c) => c.n > 0);
  if (!cands.length) return null;
  const most = Math.max(...cands.map((c) => c.n));
  const best = cands.filter((c) => c.n === most).sort((a, b) => a.total - b.total || a.v.name.localeCompare(b.v.name))[0];
  return { vendor_id: best.v.id, total: best.total, total_quoted: best.quoted, discount: best.discount, lines_priced: best.n,
    note: most === inp.lines.length ? null : `No ${qualifiedOnly ? "qualified " : ""}vendor priced all ${inp.lines.length} lines; ${best.v.name} priced ${most}, and the baseline covers those lines only.` };
}

/** The rule in plain words (scenarios.rule_text, memo part 6). */
export function ruleText(rule: Rule): string {
  const basis = rule.price_basis === "landed" ? "landed cost" : "unit price";
  const bg = rule.include_best_guess ? "; unresolved cells counted at the system's best guess" : "";
  const sub = (r: SubRule) => r.type === "weighted"
    ? `best weighted score (${Math.round((r.weights?.price ?? 0.7) * 100)}% price, ${Math.round((r.weights?.questionnaire ?? 0.3) * 100)}% questionnaire)${r.qualified_only ? " among qualified vendors" : ""}`
    : `cheapest ${r.qualified_only ? "vendor who cleared the questionnaire" : "vendor overall"}`;
  if (rule.type === "from_query") return rule.question ?? "From a saved answer";
  if (rule.type === "grouped") return `${(rule.groups ?? []).map((g) => `${filterLabel(g.filter)} lines: ${sub(g.rule)}`).join("; ")}; other lines unallocated (${basis}${bg})`;
  return `Each line to the ${sub({ type: rule.type as SubRule["type"], qualified_only: !!rule.qualified_only, weights: rule.weights })}, on ${basis}${bg}`;
}
