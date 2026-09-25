import { describe, expect, it } from "vitest";
import { aggregates, allocationColumn, chartSpec, followUps, primaryTotal, unverifiedNumbers } from "./result";

describe("aggregates / primaryTotal (TRD §13.1 step 5)", () => {
  it("sums annual values, takes a repeated window total once, counts vendors", () => {
    const rows = [
      { line_no: 1, vendor: "A", annual_value_inr: 100, grand_total: 250, annual_landed_value_inr: 110 },
      { line_no: 2, vendor: "B", annual_value_inr: 150, grand_total: 250, annual_landed_value_inr: 160 },
    ];
    const a = aggregates(rows);
    expect(a).toEqual({ row_count: 2, vendors: 2, totals: { annual_value_inr: 250, grand_total: 250, annual_landed_value_inr: 270 } });
    expect(primaryTotal(a.totals)).toBe(250);
    expect(primaryTotal({})).toBeNull();
  });
});

describe("chartSpec (§13.6)", () => {
  const plan = { needs_chart: true, intent: "savings", chart: { type: "bar" as const, x: null, y: null, title: "Q1 vs single vendor" } };
  it("charts a one-row comparison as bars of its money columns", () => {
    const c = chartSpec(plan, [{ q1_total_inr: 4.4e7, single_vendor_total_inr: 4.6e7, saving_pct: 4.3 }], ["q1_total_inr", "single_vendor_total_inr", "saving_pct"]);
    expect(c).toMatchObject({ type: "bar", data: [{ label: "q1 total", value: 4.4e7 }, { label: "single vendor total", value: 4.6e7 }] });
    expect(chartSpec({ ...plan, needs_chart: false }, [{ a_total: 1, b_total: 2 }], ["a_total", "b_total"])).not.toBeNull();
  });
  it("charts rows by label and a value column; no chart when not asked", () => {
    const rows = [{ vendor: "A", total_inr: 10 }, { vendor: "B", total_inr: 20 }];
    expect(chartSpec(plan, rows, ["vendor", "total_inr"])).toMatchObject({ x: "vendor", series: [{ y: "total_inr" }] });
    expect(chartSpec({ ...plan, needs_chart: false }, rows, ["vendor", "total_inr"])).toBeNull();
  });
});

describe("unverifiedNumbers (P-NARRATE rule)", () => {
  const rows = [{ vendor: "Kohinoor", annual_value_inr: 44812345, validity_until: "2026-10-24", lines: 27 }];
  it("accepts supplied numbers in Indian, crore and lakh forms", () => {
    expect(unverifiedNumbers("Total ₹4,48,12,345 (about ₹4.48 cr) across 27 lines, valid to 24 Oct 2026, per 1000 pcs.", [rows])).toEqual([]);
    expect(unverifiedNumbers("That is ₹448.1 L a year.", [rows])).toEqual([]);
  });
  it("flags an invented number", () => {
    expect(unverifiedNumbers("Saving of ₹12,00,000, 3.2% lower.", [rows])).toEqual(["12,00,000", "3.2%"]);
    expect(unverifiedNumbers("Total ₹44,81,2345.", [rows])).toEqual(["44,81,2345"]); // digits match, grouping doesn't
    expect(unverifiedNumbers("Rate set in September 2023.", [rows])).toEqual(["2023"]); // 2026 is supplied, 2023 is not
    expect(unverifiedNumbers("Converted at 83.15 to ₹69,675.54 per 1000 pcs.", [{ unit: 69675.54, rate: 83.15 }])).toEqual([]); // grouped and decimal
    expect(unverifiedNumbers("₹73.2 L rides on them; the split is ₹4.53 cr.", [{ stake: "₹73.2 L", total: "₹4.53 cr" }])).toEqual([]); // short forms in tool results
    expect(unverifiedNumbers("You could ask:\n1. Which vendor is cheapest?\n2. What is open?", [])).toEqual([]); // list markers
    expect(unverifiedNumbers("Saving: 12.5% on 3 lines", [])).toEqual(["12.5%", "3"]);
  });
});

describe("allocationColumn", () => {
  it("finds the winner column when there is one row per line", () => {
    const rows = [{ line_no: 1, cheapest_vendor: "Kohinoor", runner_up_vendor: "Balaji" }, { line_no: 2, cheapest_vendor: "Balaji", runner_up_vendor: "Kohinoor" }];
    expect(allocationColumn(["line_no", "cheapest_vendor", "runner_up_vendor"], rows)).toBe("cheapest_vendor");
    expect(allocationColumn(["line_no", "vendor"], [{ line_no: 1, vendor: "A" }, { line_no: 1, vendor: "B" }])).toBeNull(); // two rows for line 1
    expect(allocationColumn(["total_inr"], [{ total_inr: 5 }])).toBeNull();
    expect(allocationColumn(["line_no", "vendor", "state"], [{ line_no: 14, vendor: "OrientPack", state: "low_confidence" }])).toBeNull();
  });
});

describe("chartSpec on per-line allocations", () => {
  it("charts totals repeated on every row (Q5: split vs Q1)", () => {
    const rows = [1, 2, 3].map((n) => ({ line_no: n, vendor: "A", annual_value_inr: n * 10, q1_total_inr: 90, split_total_inr: 60 }));
    const c = chartSpec({ needs_chart: false, intent: "Split vs Q1", chart: { type: null, x: null, y: null, title: null } }, rows, Object.keys(rows[0]))!;
    expect(c).toMatchObject({ type: "bar", data: [{ label: "q1 total", value: 90 }, { label: "split total", value: 60 }] });
  });
});

describe("P11 #12: chart forms from the result's shape", () => {
  const plan = { needs_chart: false, intent: "x", chart: { type: null, x: null, y: null, title: "t" } };
  const long = [1, 2].flatMap((n) => ["A", "B", "C"].map((v, i) => ({ line_no: n, vendor: v, unit_price: 100 + i * 10 + n })));
  it("vendors side by side per line → grouped; many lines → heatmap with % over the line's lowest", () => {
    const g = chartSpec(plan, long, ["line_no", "vendor", "unit_price"])!;
    expect(g.type).toBe("grouped");
    if (g.type === "grouped") expect(g.data[0]).toEqual({ label: "Line 1", A: 101, B: 111, C: 121 });
    const many = Array.from({ length: 10 }, (_, k) => k + 1).flatMap((n) => ["A", "B"].map((v, i) => ({ line_no: n, vendor: v, unit_price: i ? 150 : 100 })));
    const h = chartSpec(plan, many, ["line_no", "vendor", "unit_price"])!;
    expect(h.type).toBe("heatmap");
    if (h.type === "heatmap") expect(h.lines[0].cells).toEqual([{ price: 100, over_pct: 0 }, { price: 150, over_pct: 50 }]);
  });
  it("an allocation → share by vendor; a signed column → diverging; force redraws or returns nothing", () => {
    const alloc = [1, 2, 3].map((n) => ({ line_no: n, vendor: n === 3 ? "B" : "A", annual_value_inr: 100 }));
    const s = chartSpec(plan, alloc, ["line_no", "vendor", "annual_value_inr"])!;
    expect(s).toMatchObject({ type: "share", data: [{ vendor: "A", value: 200, pct: 66.7, lines: 2 }, { vendor: "B", value: 100, pct: 33.3, lines: 1 }] });
    const d = chartSpec(plan, [{ line_no: 1, rank_change: -1 }, { line_no: 2, rank_change: 2 }], ["line_no", "rank_change"])!;
    expect(d).toMatchObject({ type: "diverging", data: [{ label: "Line 1", value: -1 }, { label: "Line 2", value: 2 }] });
    expect(chartSpec(plan, alloc, ["line_no", "vendor", "annual_value_inr"], "heatmap")).toBeNull(); // one vendor per line: nothing to shade
    expect(chartSpec(plan, alloc, ["line_no", "vendor", "annual_value_inr"], "bar")?.type).toBe("bar");
  });
});

describe("P11 #16 #20: follow-up buttons", () => {
  it("offers the other basis and vendor set, the single-vendor check, the source of a row, a chart", () => {
    const rows = [1, 2, 3].map((n) => ({ line_no: n, vendor: "A", unit_price: 10, annual_value_inr: 100 }));
    const f = followUps({ question: "Cheapest per line?", basis: "unit", qualified: true, columns: Object.keys(rows[0]), rows, chart: true, unsureInScope: false, someNotCleared: true });
    expect(f.map((x) => x.label)).toEqual(["Show with freight (landed cost)", "Include all vendors", "Compare with the best single vendor", "Where did line 1's price come from?"]);
    expect(f[0].message).toBe("Cheapest per line — use landed cost (unit price plus freight) instead of unit price");
    expect(followUps({ question: "Which files?", basis: null, qualified: false, columns: ["file_name"], rows: [{ file_name: "a" }], chart: false, unsureInScope: false, someNotCleared: true })).toEqual([]);
  });
});
