import { describe, expect, it } from "vitest";
import { aggregates, allocationColumn, chartSpec, primaryTotal, unverifiedNumbers } from "./result";

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
    expect(c?.data).toEqual([{ label: "q1 total", value: 4.4e7 }, { label: "single vendor total", value: 4.6e7 }]);
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
    expect(c.data).toEqual([{ label: "q1 total", value: 90 }, { label: "split total", value: 60 }]);
  });
});
