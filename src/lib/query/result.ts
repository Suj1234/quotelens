// Pure helpers for Ask results (TRD §13.1 steps 5 and 7, §13.6). No I/O.
export type Row = Record<string, unknown>;
export type ChartSpec = { type: "bar" | "line"; title: string; x: string; series: { name: string; y: string }[]; data: Record<string, number | string>[] };

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
export function chartSpec(plan: { needs_chart: boolean; intent: string; chart: { type: "bar" | "line" | null; x: string | null; y: string | null; title: string | null } }, rows: Row[], columns: string[]): ChartSpec | null {
  if (!rows.length || rows.length > 12) return null; // a 400px sheet fits ~12 bars; longer answers stay tables
  const numeric = columns.filter((c) => rows.every((r) => r[c] === null || isNum(r[c])) && rows.some((r) => isNum(r[c])));
  const totals = numeric.filter((c) => /total/i.test(c));
  // A one-row answer comparing two or more totals is charted even when the planner didn't ask (PRD Q2 "number + bar chart").
  if (!plan.needs_chart && !(rows.length === 1 && totals.length >= 2)) return null;
  const title = plan.chart.title ?? plan.intent;
  const type = plan.chart.type ?? "bar";
  if (rows.length === 1) {
    const money = totals.length >= 2 ? totals : numeric.filter((c) => !/(^|_)(line_no|rank|count|n|pct|percent)$/i.test(c));
    if (money.length < 2) return null;
    return { type, title, x: "label", series: [{ name: "value", y: "value" }], data: money.map((c) => ({ label: c.replaceAll("_", " "), value: Number(rows[0][c]) })) };
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
  if (typeof v === "string") { for (const m of v.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0])); return; }
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
  for (const m of text.matchAll(/(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lakh|L\b|%)?/gi)) {
    // Grouping must be Indian (1,04,280 / 4,52,59,716) or none; "45,25,9716" is a malformed number even if its digits match.
    if (m[1].includes(",") && !/^\d{1,2}(,\d{2})*,\d{3}$|^\d{1,3},\d{3}$/.test(m[1])) { bad.push(m[0].trim()); continue; }
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
