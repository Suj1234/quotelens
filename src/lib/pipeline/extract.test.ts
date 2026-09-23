import { expect, test } from "vitest";
import { isShort } from "./extract";

test("extraction self-check: retry only when clearly fewer items than counted rows", () => {
  const r = (rows: number, items: number) => ({ rows_with_prices: rows, items: Array(items).fill(0) });
  expect(isShort(r(30, 1))).toBe(true);   // collapsed table
  expect(isShort(r(8, 1))).toBe(true);
  expect(isShort(r(30, 29))).toBe(false); // one unreadable row is fine
  expect(isShort(r(3, 2))).toBe(false);
  expect(isShort(r(2, 3))).toBe(false);   // e.g. Anand: ranges + an unpriced line
});
