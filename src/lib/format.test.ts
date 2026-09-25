import { expect, test } from "vitest";
import { inrShort, isMoneyColumn, longDate, money, shortDate } from "./format";

test("money uses Indian grouping for INR", () => {
  expect(money(104280)).toBe("₹1,04,280");
  expect(money(13710)).toBe("₹13,710");
  expect(money(837.95, "USD")).toBe("$837.95");
  expect(money(null)).toBe("—");
});

test("dates read 24 Sep / 07 Oct 2026 in IST", () => {
  expect(shortDate("2026-09-24T04:30:00Z")).toBe("24 Sep");
  expect(longDate("2026-10-07")).toBe("07 Oct 2026");
  expect(shortDate("2026-09-23T20:00:00Z")).toBe("24 Sep"); // 01:30 IST next day
});

test("inrShort: crore / lakh / plain", () => {
  expect(inrShort(43_912_000)).toBe("₹4.39 cr");
  expect(inrShort(3_820_000)).toBe("₹38.2 L");
  expect(inrShort(99_950.4)).toBe("₹99,950");
});

test("isMoneyColumn: rupees by name, never counts", () => {
  for (const c of ["total_quote_value", "unit_price_inr_per_1000", "annual_value_inr", "line_total", "saving_inr", "annual_value_deprec_3pct"]) expect(isMoneyColumn(c), c).toBe(true);
  for (const c of ["priced_lines", "total_lines", "priced_line_count", "annual_qty", "gap_pct", "original_value", "price_rank", "vendors"]) expect(isMoneyColumn(c), c).toBe(false);
});
