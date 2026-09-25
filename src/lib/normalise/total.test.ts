import { expect, test } from "vitest";
import { linesTotal, totalCheck } from "./total";

const it = (unit_price: number, price_unit_raw: string, quantity: number | null, quantity_unit: string | null = "nos", pack_size: number | null = null) => ({ unit_price, price_unit_raw, quantity, quantity_unit, pack_size });

test("sums price × quantity in the vendor's own units, skipping what can't be read as pieces", () => {
  const r = linesTotal([it(13710, "per 1000 nos", 20000), it(12, "per piece", 1000), it(699, "per bundle of 25 nos", 500), it(42, "per kg", 100), it(5, "per piece", null)]);
  expect(r.priced).toBe(5);
  expect(r.covered).toBe(3); // per kg needs a weight; no quantity on the last
  expect(Math.round(r.sum)).toBe(Math.round(13710 * 20 + 12 * 1000 + 699 / 25 * 500));
});

test("a total is fine within 2%, or once 18% GST is added; otherwise it's a mismatch with the gap", () => {
  expect(totalCheck(100_000, 99_000)).toMatchObject({ ok: true, gst: false });
  expect(totalCheck(118_000, 100_000)).toMatchObject({ ok: true, gst: true });
  expect(totalCheck(100_000, 90_000)).toEqual({ ok: false, pct: 10, gst: false });
});
