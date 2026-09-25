// Pure helpers for Ask results (TRD §13.1 steps 5 and 7, §13.6). No I/O.
export type Row = Record<string, unknown>;
/** P11 #12: the chart forms Ask draws. The planner may suggest one; the code picks from the result's shape (chartSpec). */
export const CHART_TYPES = ["bar", "line", "grouped", "share", "diverging", "heatmap"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export type ChartSpec =
  | { type: "bar" | "line"; title: string; x: string; series: { name: string; y: string }[]; data: Record<string, number | string>[] }
  /** Several vendors' prices per line: one datum per line, a key per vendor. */
  | { type: "grouped"; title: string; y: string; series: string[]; data: ({ label: string } & Record<string, number | string | null>)[] }
  /** How an allocation splits across vendors (value and lines won). */
  | { type: "share"; title: string; data: { vendor: string; value: number; pct: number; lines: number | null }[] }
  /** A signed change or saving per row, from a zero baseline. */
  | { type: "diverging"; title: string; x: string; y: string; data: { label: string; value: number }[] }
  /** Lines × vendors: the price, shaded by how far above the line's lowest price it is. */
  | { type: "heatmap"; title: string; y: string; vendors: string[]; lines: { label: string; cells: { price: number | null; over_pct: number | null }[] }[] };
export type FollowUp = { label: string; message: string };

const isNum = (v: unknown) => v !== null && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v));

/**
 * Step 5: sums of columns named like /annual_value|total/, row count, distinct vendors.
 * A *total* column that repeats one value on every row (a window total) is taken once, not summed.
 */
export function aggregates(rows: Row[]) {
  const totals: Record<string, number> = {};
  const cols = rows.length ? Object.keys(rows[0]) : [];
  for (const c of cols.filter((c) => /annual_(\w+_)?value|total/i.test(c))) { // TRD /annual_value|total/, plus annual_landed_value_*
    const vals = rows.map((r) => r[c]).filter(isNum).map(Number);
    if (!vals.length) continue;
    const repeated = /total/i.test(c) && !/annual_(\w+_)?value/i.test(c) && vals.length > 1 && vals.every((v) => v === vals[0]);
    totals[c] = repeated ? vals[0] : vals.reduce((a, b) => a + b, 0);
  }
  const vendors = cols.includes("vendor") ? new Set(rows.map((r) => r.vendor).filter(Boolean)).size : null;
  return { row_count: rows.length, vendors, totals };
}

/** The headline total: the first annual-value column, else the first total column. */
export function primaryTotal(totals: Record<string, number>): number | null {
  const keys = Object.keys(totals);
  const k = keys.find((x) => /annual_(\w+_)?value/i.test(x)) ?? keys[0];
  return k === undefined ? null : totals[k];
}

/** Step 7 / §13.6. One-row answers (e.g. "Q1 total vs best single vendor") chart their numeric columns as bars. */
type PlanChart = { needs_chart: boolean; intent: string; chart: { type: ChartType | null; x: string | null; y: string | null; title: string | null } };
const VENDOR = (c: string) => /vendor/i.test(c) && !/runner|second|next|alt|count|_id$|_code$/i.test(c);
const PRICE = /price/i;
const VALUE = /annual_(\w+_)?value|value_inr|_inr$|total/i;
const SIGNED = /saving|change|delta|diff|gap|variance|increase|decrease/i;

/** The forms beyond the basic bar (P11 #12), from the result's shape; `want` = the type the planner or the user asked for. */
function shapedChart(want: ChartType | null, title: string, rows: Row[], columns: string[], numeric: string[], yHint: string | null, forced = false): ChartSpec | null {
  const vcol = columns.find((c) => c === "vendor") ?? columns.find(VENDOR);
  const priceCol = (yHint && numeric.includes(yHint) && PRICE.test(yHint) ? yHint : null) ?? numeric.find((c) => PRICE.test(c) && !/rank|pct|percent/i.test(c));
  const valueCol = numeric.find((c) => /annual_(\w+_)?value|value_inr/i.test(c)) ?? numeric.find((c) => VALUE.test(c) && !/pct|percent/i.test(c));
  const hasLine = columns.includes("line_no");
  // Long form (one row per line × vendor): vendors side by side per line.
  if (hasLine && vcol && priceCol && (want === null || want === "grouped" || want === "heatmap")) {
    const lines = [...new Set(rows.map((r) => Number(r.line_no)))].sort((a, b) => a - b);
    const vendors = [...new Set(rows.map((r) => String(r[vcol] ?? "")).filter(Boolean))];
    if (vendors.length >= 2 && lines.length < rows.length) {
      const price = (n: number, v: string) => { const r = rows.find((x) => Number(x.line_no) === n && x[vcol] === v); return r && isNum(r[priceCol]) ? Number(r[priceCol]) : null; };
      // Side-by-side bars read up to ~8 lines (15 when the user asked for them); past that, the heatmap — whatever the planner said.
      const grouped = want !== "heatmap" && vendors.length <= 8 && lines.length <= (forced ? 15 : 8);
      if (grouped) return { type: "grouped", title, y: priceCol, series: vendors,
        data: lines.map((n) => ({ label: `Line ${n}`, ...Object.fromEntries(vendors.map((v) => [v, price(n, v)])) })) };
      return { type: "heatmap", title, y: priceCol, vendors, lines: lines.map((n) => {
        const ps = vendors.map((v) => price(n, v));
        const low = Math.min(...ps.filter((p): p is number => p !== null));
        return { label: `Line ${n}`, cells: ps.map((p) => ({ price: p, over_pct: p === null || !Number.isFinite(low) || low <= 0 ? null : Math.round((p - low) / low * 1000) / 10 })) };
      }) };
    }
  }
  // An allocation (one vendor per line), or one row per vendor with a value: the split across vendors.
  const perLine = hasLine && vcol && allocationColumn(columns, rows) !== null;
  const perVendor = !hasLine && vcol && new Set(rows.map((r) => r[vcol])).size === rows.length && rows.length <= 8;
  if (valueCol && vcol && (perLine || (perVendor && (want === "share"))) && (want === null || want === "share")) {
    const by = new Map<string, { value: number; lines: number }>();
    for (const r of rows) {
      const k = String(r[vcol] ?? ""); if (!k || !isNum(r[valueCol])) continue;
      const cur = by.get(k) ?? { value: 0, lines: 0 };
      cur.value += Number(r[valueCol]); cur.lines += perLine ? 1 : Number(r.lines ?? r.lines_won ?? NaN) || 0; by.set(k, cur);
    }
    const sum = [...by.values()].reduce((a, b) => a + b.value, 0);
    if (by.size >= 1 && sum > 0) return { type: "share", title,
      data: [...by].map(([vendor, b]) => ({ vendor, value: b.value, pct: Math.round(b.value / sum * 1000) / 10, lines: b.lines || null })).sort((a, b) => b.value - a.value) };
  }
  // A signed change or saving per row.
  const signed = numeric.find((c) => SIGNED.test(c) && rows.some((r) => Number(r[c]) < 0)) ?? (want === "diverging" ? numeric.find((c) => SIGNED.test(c)) : undefined);
  if (signed && rows.length <= 40 && (want === null || want === "diverging")) {
    const x = hasLine ? "line_no" : columns.find((c) => !numeric.includes(c)) ?? columns[0];
    const label = (r: Row) => (x === "line_no" ? `Line ${r.line_no}${vcol ? ` · ${r[vcol]}` : ""}` : String(r[x] ?? "—"));
    return { type: "diverging", title, x, y: signed, data: rows.map((r) => ({ label: label(r), value: Number(r[signed] ?? 0) })) };
  }
  return null;
}

/**
 * Step 7 / §13.6 (+ P11 #12). `force` (P11 #13, "show that as a chart") draws that form when the rows allow it, or nothing.
 */
export function chartSpec(plan: PlanChart, rows: Row[], columns: string[], force?: ChartType): ChartSpec | null {
  if (!rows.length) return null;
  const numeric = columns.filter((c) => rows.every((r) => r[c] === null || isNum(r[c])) && rows.some((r) => isNum(r[c])));
  const title = plan.chart.title ?? plan.intent;
  const want = force ?? (plan.chart.type && !["bar", "line"].includes(plan.chart.type) ? plan.chart.type : null);
  if (force && force !== "bar" && force !== "line") return shapedChart(force, title, rows, columns, numeric, plan.chart.y, true);
  const totals = numeric.filter((c) => /total/i.test(c));
  // Per-line allocations carry the totals they're compared with on every row (P-SQL v4): chart those, like a one-row answer.
  const constant = rows.length > 1 ? totals.filter((c) => rows.every((r) => Number(r[c]) === Number(rows[0][c]))) : [];
  if (constant.length >= 2 && !force) return { type: "bar", title, x: "label", series: [{ name: "value", y: "value" }],
    data: constant.map((c) => ({ label: c.replace(/_inr$/, "").replaceAll("_", " "), value: Number(rows[0][c]) })) };
  if (!force && rows.length > 1) { const shaped = shapedChart(want, title, rows, columns, numeric, plan.chart.y); if (shaped) return shaped; }
  if (rows.length > (force ? 40 : 12)) return null; // a 400px sheet fits ~12 bars; longer answers stay tables (or a shaped chart above)
  // A one-row answer comparing two or more totals is charted even when the planner didn't ask (PRD Q2 "number + bar chart").
  if (!force && !plan.needs_chart && !(rows.length === 1 && totals.length >= 2)) return null;
  const type = force === "line" || plan.chart.type === "line" ? "line" : "bar";
  if (rows.length === 1) {
    const money = totals.length >= 2 ? totals : numeric.filter((c) => !/(^|_)(line_no|rank|count|n|pct|percent)$/i.test(c));
    if (money.length < 2) return null;
    return { type, title, x: "label", series: [{ name: "value", y: "value" }], data: money.map((c) => ({ label: c.replace(/_inr$/, "").replaceAll("_", " "), value: Number(rows[0][c]) })) };
  }
  const x = plan.chart.x && columns.includes(plan.chart.x) ? plan.chart.x : columns.find((c) => !numeric.includes(c)) ?? columns[0];
  const y = plan.chart.y && numeric.includes(plan.chart.y) ? plan.chart.y
    : numeric.find((c) => /total|annual|value|saving|price/i.test(c) && c !== x) ?? numeric.find((c) => c !== x);
  if (!y) return null;
  return { type, title, x, series: [{ name: y, y }], data: rows.slice(0, 40).map((r) => ({ [x]: String(r[x] ?? "—"), [y]: Number(r[y] ?? 0) })) };
}

/** Every number found anywhere in the supplied values (numbers, numeric strings, digits inside strings such as dates). */
function collect(v: unknown, out: number[]) {
  if (v === null || v === undefined) return;
  if (typeof v === "number") { out.push(v); return; }
  if (typeof v === "string") {
    // "₹73.2 L" / "₹4.53 cr" (inrShort, in tool results) count as the rupees they stand for, as well as the digits.
    for (const m of v.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)(\s*(?:crores?|cr\b|lakhs?|L\b))?/gi)) {
      const n = Number(m[1]), u = (m[2] ?? "").trim().toLowerCase();
      out.push(n);
      if (u) out.push(u.startsWith("cr") ? n * 1e7 : n * 1e5);
    }
    return;
  }
  if (Array.isArray(v)) { v.forEach((x) => collect(x, out)); return; }
  if (typeof v === "object") Object.values(v as object).forEach((x) => collect(x, out));
}

/**
 * P-NARRATE rule "never introduce any number that is not in the rows or aggregates": returns the numbers in the text
 * that match nothing supplied (after reading ₹4.48 cr / ₹38.2 L / 1,04,280 back to plain numbers, within rounding).
 */
export function unverifiedNumbers(text: string, supplied: unknown[]): string[] {
  const known: number[] = [1000, 100];
  collect(supplied, known);
  const bad: string[] = [];
  const body = text.replace(/^\s*\d{1,2}[.)]\s+/gm, ""); // "1. Which vendor…" is a list marker, not a figure
  for (const m of body.matchAll(/(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lakh|L\b|%)?/gi)) {
    // Grouping must be Indian (1,04,280 / 4,52,59,716) or none; "45,25,9716" is a malformed number even if its digits match.
    const whole = m[1].split(".")[0]; // grouping is checked on the whole part: ₹69,675.54 is well-formed
    if (whole.includes(",") && !/^\d{1,2}(,\d{2})*,\d{3}$|^\d{1,3},\d{3}$/.test(whole)) { bad.push(m[0].trim()); continue; }
    const raw = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const value = unit.startsWith("cr") ? raw * 1e7 : unit.startsWith("l") ? raw * 1e5 : raw;
    const tol = unit.startsWith("cr") ? 0.006 : unit.startsWith("l") ? 0.006 : 0.0051;
    // Whole numbers under 10,000 (years, counts, line numbers, days) must match exactly; money may differ by rounding.
    const exact = !unit && Number.isInteger(value) && value < 10_000;
    const ok = known.some((k) => exact ? Math.round(k) === value : Math.abs(k - value) <= Math.max(0.51, Math.abs(k) * tol));
    if (!ok) bad.push(m[0].trim());
  }
  return bad;
}

/**
 * TRD §13.5: an answer can be saved as a scenario when its rows have line_no, a vendor column and one row per line.
 * Returns that vendor column (the planner names it vendor / winning_vendor / cheapest_vendor run to run), else null.
 */
export function allocationColumn(columns: string[], rows: Row[]): string | null {
  if (!rows.length || !columns.includes("line_no") || columns.includes("state")) return null; // a list of cell states (Q6) is not an allocation
  const lines = rows.map((r) => Number(r.line_no));
  if (lines.some((n) => !Number.isInteger(n)) || new Set(lines).size !== rows.length) return null;
  const cands = columns.filter((c) => /vendor/i.test(c) && !/runner|second|next|alt|count|_id$/i.test(c))
    .sort((a, b) => Number(b === "vendor") - Number(a === "vendor"));
  return cands.find((c) => rows.every((r) => typeof r[c] === "string" && r[c] !== "")) ?? null;
}

/**
 * P11 #16 #20: up to four next questions from this answer's shape — the other price basis or vendor set it didn't use, the
 * single-vendor comparison for an allocation, the unsure cells it left out, where a row's price came from, a chart.
 * Code, not the model: the same answer always offers the same buttons. Each message goes to the analyst as typed.
 */
export function followUps(a: { question: string; basis: "unit" | "landed" | null; qualified: boolean; columns: string[]; rows: Row[]; chart: boolean; unsureInScope: boolean; someNotCleared: boolean }): FollowUp[] {
  const out: FollowUp[] = [];
  const q = a.question.replace(/[.?!\s]+$/, "");
  if (a.basis === "unit") out.push({ label: "Show with freight (landed cost)", message: `${q} — use landed cost (unit price plus freight) instead of unit price` });
  if (a.basis === "landed") out.push({ label: "Show at unit price", message: `${q} — use unit price instead of landed cost` });
  if (a.basis && a.qualified) out.push({ label: "Include all vendors", message: `${q} — include every vendor, not only those who cleared the questionnaire` });
  else if (a.basis && a.someNotCleared) out.push({ label: "Only qualified vendors", message: `${q} — only vendors who cleared the questionnaire` });
  if (allocationColumn(a.columns, a.rows)) out.push({ label: "Compare with the best single vendor", message: "What does the last answer save versus awarding everything to the cheapest single vendor?" });
  if (a.unsureInScope) out.push({ label: "What's unsure here?", message: "Which cells in the last answer are you not sure about, and how much money rides on them?" });
  const vcol = a.columns.find((c) => c === "vendor") ?? a.columns.find(VENDOR);
  const first = a.rows[0];
  if (first && vcol && a.columns.includes("line_no") && first[vcol]) out.push({ label: `Where did line ${first.line_no}'s price come from?`, message: `Explain ${first[vcol]}'s price on line ${first.line_no}` });
  if (!a.chart && a.rows.length >= 3 && a.columns.some((c) => a.rows.every((r) => r[c] === null || isNum(r[c])) && c !== "line_no")) out.push({ label: "Show as a chart", message: "Show the last answer as a chart" });
  return out.slice(0, 4);
}
