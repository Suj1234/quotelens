import { describe, expect, it } from "vitest";
import { aggregates, chartSpec, primaryTotal, unverifiedNumbers } from "./result";

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
    expect(c?.data).toEqual([{ label: "q1 total inr", value: 4.4e7 }, { label: "single vendor total inr", value: 4.6e7 }]);
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
