import { describe, expect, it } from "vitest";
import type { Inputs } from "./allocate";
import { whatIf } from "./whatif";

const inp: Inputs = {
  lines: [{ id: "l1", line_no: 1, description: "Box A", annual_qty: 1000, ply: 5, item_type: null, delivery_location: null },
    { id: "l2", line_no: 2, description: "Box B", annual_qty: 2000, ply: 3, item_type: null, delivery_location: null }],
  vendors: [{ id: "a", name: "A", cleared: true, q_score: 1 }, { id: "u", name: "U", cleared: true, q_score: 1 }],
  cells: [
    { line_id: "l1", vendor_id: "a", state: "confirmed", unit: 100, landed: 100, guess_unit: null, guess_landed: null },
    { line_id: "l1", vendor_id: "u", state: "inferred", unit: 98, landed: 108, guess_unit: null, guess_landed: null },
    { line_id: "l2", vendor_id: "a", state: "confirmed", unit: 50, landed: 50, guess_unit: null, guess_landed: null },
    { line_id: "l2", vendor_id: "u", state: "inferred", unit: 60, landed: 70, guess_unit: null, guess_landed: null },
  ],
  discounts: [{ vendor_id: "a", pct: 10, condition: "all lines", kind: "all_lines", min_lines: null, min_value_inr: null, payment_days: null }],
};
const usd = new Map([["u", "USD"], ["a", "INR"]]);
const base = { basis: "unit" as const, qualified_only: false };

describe("P11 #9 whatIf", () => {
  it("the rupee weakens 3%: the USD vendor loses line 1, totals and discounts follow", () => {
    const w = whatIf(inp, base, [{ kind: "fx", currency: "USD", pct: 3 }], usd);
    expect(w.before.total_quoted).toBe(98 + 100); // U wins line 1 at 98, A line 2 at 50 × 2
    expect(w.after.total_quoted).toBe(100 + 100); // 98 × 1.03 = 100.94 > 100 → A wins both
    expect(w.after.discount_saving).toBe(20);     // A now has all lines: its 10% is earned
    expect(w.changed_lines).toEqual([{ line_no: 1, before_vendor: "u", after_vendor: "a", before_value: 98, after_value: 100 }]);
  });
  it("fixed winners are re-priced; a dropped winner's line goes to the cheapest remaining vendor", () => {
    const winners = new Map([["l1", "u"], ["l2", "u"]]);
    const w = whatIf(inp, { ...base, winners }, [{ kind: "drop_vendor", vendor_id: "u" }], usd);
    expect(w.before.total_quoted).toBe(98 + 120);
    expect(w.after.total_quoted).toBe(100 + 100);
    expect(w.reassigned).toEqual([1, 2]);
  });
  it("freight on landed cost and volume changes; nothing changes the input", () => {
    const land = whatIf(inp, { ...base, basis: "landed" }, [{ kind: "freight", vendor_id: "u", inr_per_1000: 0 }], usd);
    expect(land.after.lines[0]).toMatchObject({ vendor_id: "u", annual_value: 98 });
    const vol = whatIf(inp, base, [{ kind: "volume", pct: 50, line_ids: ["l2"] }], usd);
    expect(vol.after.total_quoted).toBe(98 + 150);
    expect(inp.lines[1].annual_qty).toBe(2000);
  });
});
