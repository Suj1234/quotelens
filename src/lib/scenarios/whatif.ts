// P11 #9: "what if the rupee moves 3% / we drop Kohinoor / freight goes up": the model picks the change, this code works out
// before and after with the same allocation, price and discount rules as the Award tab. Pure (unit-tested in whatif.test.ts).
import { allocate, applyDiscounts, priceOf, totals, type ACell, type Basis, type Inputs } from "./allocate";

export type Change =
  | { kind: "fx"; currency: string; pct: number }                 // the foreign currency costs pct% more rupees (negative = fewer)
  | { kind: "vendor_price"; vendor_id: string; pct: number }      // the vendor's prices move pct%
  | { kind: "freight"; vendor_id: string; inr_per_1000: number }  // the vendor's freight, per 1000 pcs (landed cost only)
  | { kind: "drop_vendor"; vendor_id: string }
  | { kind: "volume"; pct: number; line_ids?: string[] }          // annual quantities move pct% (all lines, or these)
  | { kind: "no_discounts" };                                     // leave every vendor discount out

/** Cheapest per line under these settings, or fixed winners (a saved scenario) re-priced. */
export type Base = { basis: Basis; qualified_only: boolean; winners?: Map<string, string> };

export type Side = {
  total_quoted: number; discount_saving: number; total_after: number;
  share: { vendor_id: string; lines: number; value: number }[];
  lines: { line_id: string; line_no: number; vendor_id: string | null; annual_value: number | null }[];
};

const scale = (c: ACell, f: number): ACell => ({
  ...c,
  unit: c.unit === null ? null : c.unit * f,
  landed: c.landed === null ? null : c.landed + (c.unit ?? 0) * (f - 1), // freight is in rupees and doesn't move with the price
  guess_unit: c.guess_unit === null ? null : c.guess_unit * f,
  guess_landed: c.guess_landed === null ? null : c.guess_landed + (c.guess_unit ?? 0) * (f - 1),
});

/** The comparison with the changes applied (a copy; nothing else is touched). currencyOf: vendor_id → the currency it quoted in. */
export function applyChanges(inp: Inputs, changes: Change[], currencyOf: Map<string, string>): Inputs {
  let out: Inputs = { ...inp, lines: inp.lines.map((l) => ({ ...l })), cells: inp.cells.map((c) => ({ ...c })), vendors: [...inp.vendors], discounts: [...(inp.discounts ?? [])] };
  for (const ch of changes) {
    if (ch.kind === "fx") out.cells = out.cells.map((c) => (currencyOf.get(c.vendor_id) === ch.currency ? scale(c, 1 + ch.pct / 100) : c));
    if (ch.kind === "vendor_price") out.cells = out.cells.map((c) => (c.vendor_id === ch.vendor_id ? scale(c, 1 + ch.pct / 100) : c));
    if (ch.kind === "freight") out.cells = out.cells.map((c) => (c.vendor_id !== ch.vendor_id ? c : {
      ...c, landed: c.unit === null ? null : c.unit + ch.inr_per_1000, guess_landed: c.guess_unit === null ? null : c.guess_unit + ch.inr_per_1000 }));
    if (ch.kind === "drop_vendor") out = { ...out, cells: out.cells.filter((c) => c.vendor_id !== ch.vendor_id), vendors: out.vendors.filter((v) => v.id !== ch.vendor_id),
      discounts: (out.discounts ?? []).filter((d) => d.vendor_id !== ch.vendor_id) };
    if (ch.kind === "volume") out.lines = out.lines.map((l) => (!ch.line_ids?.length || ch.line_ids.includes(l.id) ? { ...l, annual_qty: l.annual_qty * (1 + ch.pct / 100) } : l));
    if (ch.kind === "no_discounts") out.discounts = [];
  }
  return out;
}

/** One side of the comparison. With fixed winners, a line whose winner has no usable price any more goes to the cheapest eligible vendor. */
export function evaluate(inp: Inputs, base: Base): Side & { reassigned: number[] } {
  const cheapest = allocate(inp, { type: "cheapest_per_line", price_basis: base.basis, qualified_only: base.qualified_only });
  const reassigned: number[] = [];
  const lines = cheapest.map((c) => {
    const line = inp.lines.find((l) => l.id === c.rfx_line_id)!;
    const w = base.winners?.get(c.rfx_line_id);
    if (w) {
      const cell = inp.cells.find((x) => x.line_id === c.rfx_line_id && x.vendor_id === w);
      const p = cell ? priceOf(cell, base.basis) : null;
      if (p) return { line_id: c.rfx_line_id, line_no: c.line_no, vendor_id: w, annual_value: p.price * line.annual_qty / 1000, single_source: c.single_source };
      reassigned.push(c.line_no);
    }
    return { line_id: c.rfx_line_id, line_no: c.line_no, vendor_id: c.vendor_id, annual_value: c.annual_value, single_source: c.single_source };
  });
  const t = totals(lines);
  const d = applyDiscounts(t.share, inp);
  return { total_quoted: t.total, discount_saving: d.saving, total_after: t.total - d.saving, share: t.share.map(({ vendor_id, lines: n, value }) => ({ vendor_id, lines: n, value })),
    lines: lines.map(({ line_id, line_no, vendor_id, annual_value }) => ({ line_id, line_no, vendor_id, annual_value })), reassigned };
}

export type WhatIf = {
  before: Side; after: Side; reassigned: number[];
  changed_lines: { line_no: number; before_vendor: string | null; after_vendor: string | null; before_value: number | null; after_value: number | null }[];
};

/** Before = today's comparison; after = the same rule on the changed comparison. */
export function whatIf(inp: Inputs, base: Base, changes: Change[], currencyOf: Map<string, string>): WhatIf {
  const before = evaluate(inp, base);
  const after = evaluate(applyChanges(inp, changes, currencyOf), base);
  const changed_lines = after.lines.flatMap((a) => {
    const b = before.lines.find((x) => x.line_id === a.line_id)!;
    return b.vendor_id !== a.vendor_id ? [{ line_no: a.line_no, before_vendor: b.vendor_id, after_vendor: a.vendor_id, before_value: b.annual_value, after_value: a.annual_value }] : [];
  });
  return { before, after, reassigned: after.reassigned.filter((n) => !before.reassigned.includes(n)), changed_lines };
}
