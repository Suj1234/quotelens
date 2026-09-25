import { describe, expect, it } from "vitest";
import { allocate, applyDiscounts, baseline, fromQuery, ruleText, tidyTitle, totals, type ACell, type ADiscount, type Inputs } from "./allocate";

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
  it("cheapest qualified: a tie goes to the better questionnaire score and says so; a line nobody qualified for is unallocated", () => {
    const s = allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" });
    expect(s[0]).toMatchObject({ vendor_id: "a", price: 100, runner_up_vendor_id: "b", runner_up_price: 100, gap_pct: 0 });
    expect(s[0].reason).toBe("Lowest price among vendors who cleared the questionnaire; same price as Beta — chosen for its better questionnaire score");
    expect(s[1]).toMatchObject({ vendor_id: "a", price: 200, annual_value: 400, single_source: true, runner_up_vendor_id: null }); // Beta's cell is ambiguous
    expect(s[2]).toMatchObject({ vendor_id: null, reason: "No vendor who cleared the questionnaire has a usable price" });
    const t = totals(s);
    expect(t).toMatchObject({ total: 500, vendor_count: 1, allocated: 2, single_source_lines: 1, unallocated_lines: [3] });
    expect(t.share).toEqual([{ vendor_id: "a", lines: 2, value: 500, pct: 100 }]);
  });

  it("best guesses count only when asked, and are marked", () => {
    const s = allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit", include_best_guess: true });
    expect(s[1]).toMatchObject({ vendor_id: "b", price: 150, best_guess: true, runner_up_vendor_id: "a", gap_pct: 33.33 });
    expect(s[1].reason).toBe("Lowest price among vendors who cleared the questionnaire; uses the system's best guess for a price still being checked");
    const landed = allocate(inp, { type: "cheapest_per_line", qualified_only: false, price_basis: "landed" });
    expect(landed[0]).toMatchObject({ vendor_id: "c", price: 100, reason: "Lowest price of all vendors (landed cost)" });
  });

  it("grouped: lines no group covers are unallocated and flagged", () => {
    const one = allocate(inp, { type: "grouped", price_basis: "unit", groups: [{ filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } }] });
    expect(one.map((l) => l.vendor_id)).toEqual(["a", null, null]);
    expect(one[1].reason).toBe("No group covers this line");
    expect(one[2].reason).toBe("5-ply lines: no vendor who cleared the questionnaire has a usable price");
    const two = allocate(inp, { type: "grouped", price_basis: "unit", groups: [
      { filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } },
      { filter: { ply: 3 }, rule: { type: "cheapest_per_line", qualified_only: false } }] });
    expect(two[1]).toMatchObject({ vendor_id: "c", price: 120, reason: "3-ply lines: lowest price of all vendors" });
  });

  it("weighted, worked by hand: min 90 on line 1; Alpha .5×.9+.5×1 = .95, Beta .5×.9+.5×.5 = .70, Gamma .5×1+.5×1 = 1.00", () => {
    const s = allocate(inp, { type: "weighted", qualified_only: false, price_basis: "unit", weights: { price: 0.5, questionnaire: 0.5 } });
    expect(s[0]).toMatchObject({ vendor_id: "c", price: 90, runner_up_vendor_id: "a", runner_up_price: 100, gap_pct: 11.11 });
    expect(s[0].reason).toBe("Best weighted score (50% price, 50% questionnaire): 1.00");
    // 0.9/0.1 on line 2: min 120; Alpha .9×.6+.1 = .64, Gamma .9×1+.1 = 1.00 (Beta ambiguous, not eligible)
    expect(allocate(inp, { type: "weighted", qualified_only: false, price_basis: "unit", weights: { price: 0.9, questionnaire: 0.1 } })[1].vendor_id).toBe("c");
  });

  it("baseline: cheapest vendor who priced every line; else most lines, with a note", () => {
    expect(baseline(inp, "unit", false)).toMatchObject({ vendor_id: "c", total: 90 + 240 + 80, lines_priced: 3, note: null });
    const q = baseline(inp, "unit", true)!;
    expect(q).toMatchObject({ vendor_id: "a", total: 500, lines_priced: 2 });
    expect(q.note).toBe("No qualified vendor priced all 3 lines; Alpha priced 2, and the baseline covers those lines only.");
  });

  it("from a query: winners copied, prices / runner-up / reason from the comparison", () => {
    const s = fromQuery(inp, new Map([[1, "c"], [2, "a"]]), { type: "from_query", qualified_only: true, price_basis: "unit" });
    expect(s[0]).toMatchObject({ vendor_id: "c", price: 90, reason: "Lowest price of all vendors", runner_up_vendor_id: "a", runner_up_price: 100 });
    expect(s[1]).toMatchObject({ vendor_id: "a", price: 200, reason: "Lowest price among vendors who cleared the questionnaire", single_source: true });
    expect(s[2]).toMatchObject({ vendor_id: null, reason: "Not in the answer" });
  });

  it("from a query that picked one of two equal prices: the tie rule decides, not the query's row order", () => {
    const s = fromQuery(inp, new Map([[1, "b"]]), { type: "from_query", qualified_only: true, price_basis: "unit" });
    expect(s[0]).toMatchObject({ vendor_id: "a", price: 100, runner_up_vendor_id: "b", runner_up_price: 100 });
    expect(s[0].reason).toBe("Lowest price among vendors who cleared the questionnaire; same price as Beta — chosen for its better questionnaire score");
  });

  it("tie order: questionnaire score, then the quote valid longer, then the name (MER-0424: Anand vs Sri Balaji at ₹26,770)", () => {
    const two = (anand: Partial<Inputs["vendors"][0]>, balaji: Partial<Inputs["vendors"][0]>): Inputs => ({
      lines: [line("l1", 24, 5, 1000)],
      vendors: [{ id: "an", name: "Anand Box Works", cleared: true, q_score: 1, ...anand }, { id: "sb", name: "Sri Balaji Packaging", cleared: true, q_score: 1, ...balaji }],
      cells: [cell("l1", "an", "reviewed", 26770), cell("l1", "sb", "reviewed", 26770)],
    });
    const rule = { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" } as const;
    expect(allocate(two({ q_score: 0.8 }, {}), rule)[0]).toMatchObject({ vendor_id: "sb", reason: "Lowest price among vendors who cleared the questionnaire; same price as Anand Box Works — chosen for its better questionnaire score" });
    expect(allocate(two({ validity_days: 30 }, { validity_days: 90 }), rule)[0]).toMatchObject({ vendor_id: "sb", reason: "Lowest price among vendors who cleared the questionnaire; same price as Anand Box Works — chosen because its quote is valid longer" });
    expect(allocate(two({}, {}), rule)[0]).toMatchObject({ vendor_id: "an", reason: "Lowest price among vendors who cleared the questionnaire; same price as Sri Balaji Packaging — nothing else separates them, so chosen alphabetically" });
  });

  it("fallback title: drops the 'create a scenario' opener, fixes caps lock, stays short", () => {
    expect(tidyTitle("cREATE A SCEANRIO WITH Cheapest vendor for 3 ply priority")).toBe("Cheapest vendor for 3 ply priority");
    expect(tidyTitle("please make an option where 5-ply goes to Anand")).toBe("5-ply goes to Anand");
    expect(tidyTitle("cheapest per line")).toBe("Cheapest per line");
    expect(tidyTitle("x ".repeat(60)).length).toBeLessThanOrEqual(81);
  });

  it("rule in plain words", () => {
    expect(ruleText({ type: "cheapest_per_line", qualified_only: true, price_basis: "unit" })).toBe("Each line to the cheapest vendor who cleared the questionnaire, on unit price");
    expect(ruleText({ type: "grouped", price_basis: "unit", groups: [{ filter: { ply: 5 }, rule: { type: "cheapest_per_line", qualified_only: true } }, { filter: { ply: 3 }, rule: { type: "cheapest_per_line", qualified_only: false } }] }))
      .toBe("5-ply lines: cheapest vendor who cleared the questionnaire; 3-ply lines: cheapest vendor overall; other lines unallocated (unit price)");
  });
});

describe("conditional discounts (P10 D3) — checked per award option, never in line prices", () => {
  const lines = Array.from({ length: 30 }, (_, i) => line(`l${i + 1}`, i + 1, 5, 1000));
  const d = (kind: ADiscount["kind"], extra: Partial<ADiscount> = {}): ADiscount => ({ vendor_id: "bal", pct: 3, condition: "if all 30 items are awarded to us", kind, min_lines: null, min_value_inr: null, payment_days: null, ...extra });
  it("MER-0419 Balaji: all 30 lines → met, 3% of its value off; 16 of 30 → not met, nothing off", () => {
    const all = applyDiscounts([{ vendor_id: "bal", lines: 30, value: 45_835_488 }], { lines, discounts: [d("all_lines")] });
    expect(all.lines[0]).toMatchObject({ met: true, why: "30 of 30 lines awarded; needs all 30" });
    expect(Math.round(all.saving)).toBe(1_375_065);
    const split = applyDiscounts([{ vendor_id: "bal", lines: 16, value: 20_000_000 }, { vendor_id: "koh", lines: 13, value: 1 }], { lines, discounts: [d("all_lines")] });
    expect(split.lines[0]).toMatchObject({ met: false, why: "16 of 30 lines awarded; needs all 30", saving: 0 });
  });
  it("min lines, min value, payment days, no condition, unclear, and a vendor that wins nothing", () => {
    const share = [{ vendor_id: "bal", lines: 16, value: 2_00_00_000 }];
    expect(applyDiscounts(share, { lines, discounts: [d("min_lines", { min_lines: 15 })] }).lines[0].met).toBe(true);
    expect(applyDiscounts(share, { lines, discounts: [d("min_value", { min_value_inr: 3_00_00_000 })] }).lines[0].met).toBe(false);
    expect(applyDiscounts(share, { lines, discounts: [d("payment_days", { payment_days: 10 })], payment_days: 45 }).lines[0]).toMatchObject({ met: false, why: "we pay at 45 days; needs payment within 10" });
    expect(applyDiscounts(share, { lines, discounts: [d("none")] }).lines[0].met).toBe(true);
    expect(applyDiscounts(share, { lines, discounts: [d("unclear")] }).lines[0]).toMatchObject({ met: null, saving: 0 });
    expect(applyDiscounts([], { lines, discounts: [d("none")] }).lines[0]).toMatchObject({ met: false, why: "no lines awarded" });
  });
  it("the single-vendor baseline gets a vendor's discount when that vendor alone meets it, and can change who is best", () => {
    const two: Inputs = {
      lines: lines.slice(0, 2), vendors: [{ id: "bal", name: "Balaji", cleared: true, q_score: 1 }, { id: "koh", name: "Kohinoor", cleared: true, q_score: 1 }],
      cells: [cell("l1", "bal", "confirmed", 100), cell("l2", "bal", "confirmed", 100), cell("l1", "koh", "confirmed", 98), cell("l2", "koh", "confirmed", 99)],
      discounts: [d("all_lines")],
    };
    const b = baseline(two, "unit", true)!;
    expect(b).toMatchObject({ vendor_id: "bal", total_quoted: 200, total: 194 }); // 200 − 3% beats Kohinoor's 197
    expect(b.discount).toMatchObject({ met: true });
  });
});
