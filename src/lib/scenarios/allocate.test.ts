import { describe, expect, it } from "vitest";
import { allocate, baseline, fromQuery, ruleText, totals, type ACell, type Inputs } from "./allocate";

// Three lines, three vendors. Alpha and Beta cleared the questionnaire; Gamma didn't.
const line = (id: string, n: number, ply: number, qty: number) => ({ id, line_no: n, description: `L${n}`, annual_qty: qty, ply, item_type: "RSC", delivery_location: "Hosur" });
const cell = (line_id: string, vendor_id: string, state: string, unit: number | null, guess: number | null = null): ACell =>
  ({ line_id, vendor_id, state, unit, landed: unit === null ? null : unit + 10, guess_unit: guess, guess_landed: guess === null ? null : guess + 10 });
const inp: Inputs = {
  lines: [line("l1", 1, 5, 1000), line("l2", 2, 3, 2000), line("l3", 3, 5, 1000)],
  vendors: [{ id: "a", name: "Alpha", cleared: true, q_score: 1 }, { id: "b", name: "Beta", cleared: true, q_score: 0.5 }, { id: "c", name: "Gamma", cleared: false, q_score: 1 }],
  cells: [
    cell("l1", "a", "confirmed", 100), cell("l1", "b", "inferred", 100), cell("l1", "c", "confirmed", 90),
    cell("l2", "a", "confirmed", 200), cell("l2", "b", "ambiguous", null, 150), cell("l2", "c", "confirmed", 120),
    cell("l3", "a", "not_quoted", null), cell("l3", "b", "not_quoted", null), cell("l3", "c", "confirmed", 80),
  ],
};

describe("allocate", () => {
  it("cheapest qualified: a tie goes to the lower name and says so; a line nobody qualified for is unallocated", () => {
    const s = allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" });
    expect(s[0]).toMatchObject({ vendor_id: "a", price: 100, runner_up_vendor_id: "b", runner_up_price: 100, gap_pct: 0 });
    expect(s[0].reason).toBe("cheapest qualified (tie with Beta at the same price; lower name wins)");
    expect(s[1]).toMatchObject({ vendor_id: "a", price: 200, annual_value: 400, single_source: true, runner_up_vendor_id: null }); // Beta's cell is ambiguous
    expect(s[2]).toMatchObject({ vendor_id: null, reason: "no qualified quote" });
    const t = totals(s);
    expect(t).toMatchObject({ total: 500, vendor_count: 1, allocated: 2, single_source_lines: 1, unallocated_lines: [3] });
    expect(t.share).toEqual([{ vendor_id: "a", lines: 2, value: 500, pct: 100 }]);
  });

  it("best guesses count only when asked, and are marked", () => {
    const s = allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit", include_best_guess: true });
    expect(s[1]).toMatchObject({ vendor_id: "b", price: 150, best_guess: true, runner_up_vendor_id: "a", gap_pct: 33.33 });
    expect(s[1].reason).toBe("cheapest qualified — best guess");
    const landed = allocate(inp, { type: "cheapest_per_line", qualified_only: false, price_basis: "landed" });
    expect(landed[0]).toMatchObject({ vendor_id: "c", price: 100, reason: "cheapest overall (landed)" });
  });

  it("grouped: lines no group covers are unallocated and flagged", () => {
    const one = allocate(inp, { type: "grouped", price_basis: "unit", groups: [{ filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } }] });
    expect(one.map((l) => l.vendor_id)).toEqual(["a", null, null]);
    expect(one[1].reason).toBe("not covered by any group");
    expect(one[2].reason).toBe("5-ply group: no qualified quote");
    const two = allocate(inp, { type: "grouped", price_basis: "unit", groups: [
      { filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } },
      { filter: { ply: 3 }, rule: { type: "cheapest_per_line", qualified_only: false } }] });
    expect(two[1]).toMatchObject({ vendor_id: "c", price: 120, reason: "3-ply group: cheapest overall" });
  });

  it("weighted, worked by hand: min 90 on line 1; Alpha .5×.9+.5×1 = .95, Beta .5×.9+.5×.5 = .70, Gamma .5×1+.5×1 = 1.00", () => {
    const s = allocate(inp, { type: "weighted", qualified_only: false, price_basis: "unit", weights: { price: 0.5, questionnaire: 0.5 } });
    expect(s[0]).toMatchObject({ vendor_id: "c", price: 90, runner_up_vendor_id: "a", runner_up_price: 100, gap_pct: 11.11 });
    expect(s[0].reason).toBe("weighted 0.5/0.5: score 1.00");
    // 0.9/0.1 on line 2: min 120; Alpha .9×.6+.1 = .64, Gamma .9×1+.1 = 1.00 (Beta ambiguous, not eligible)
    expect(allocate(inp, { type: "weighted", qualified_only: false, price_basis: "unit", weights: { price: 0.9, questionnaire: 0.1 } })[1].vendor_id).toBe("c");
  });

  it("baseline: cheapest vendor who priced every line; else most lines, with a note", () => {
    expect(baseline(inp, "unit", false)).toEqual({ vendor_id: "c", total: 90 + 240 + 80, lines_priced: 3, note: null });
    const q = baseline(inp, "unit", true)!;
    expect(q).toMatchObject({ vendor_id: "a", total: 500, lines_priced: 2 });
    expect(q.note).toBe("No qualified vendor priced all 3 lines; Alpha priced 2, and the baseline covers those lines only.");
  });

  it("from a query: winners copied, prices / runner-up / reason from the comparison", () => {
    const s = fromQuery(inp, new Map([[1, "c"], [2, "a"]]), { type: "from_query", qualified_only: true, price_basis: "unit" });
    expect(s[0]).toMatchObject({ vendor_id: "c", price: 90, reason: "cheapest overall", runner_up_vendor_id: "a", runner_up_price: 100 });
    expect(s[1]).toMatchObject({ vendor_id: "a", price: 200, reason: "cheapest qualified", single_source: true });
    expect(s[2]).toMatchObject({ vendor_id: null, reason: "not in the answer" });
  });

  it("rule in plain words", () => {
    expect(ruleText({ type: "cheapest_per_line", qualified_only: true, price_basis: "unit" })).toBe("Each line to the cheapest vendor who cleared the questionnaire, on unit price");
    expect(ruleText({ type: "grouped", price_basis: "unit", groups: [{ filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } }, { filter: { ply: 3 }, rule: { type: "cheapest_per_line", qualified_only: false } }] }))
      .toBe("5-ply lines: cheapest vendor who cleared the questionnaire; 3-ply lines: cheapest vendor overall; other lines unallocated (unit price)");
  });
});
