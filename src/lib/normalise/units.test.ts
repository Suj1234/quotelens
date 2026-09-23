import { expect, test } from "vitest";
import { currencyCode, fxRate } from "./fx";
import { grossUp, landed } from "./price";
import { parseAmount, parsePrice, parseUnit, toPer1000Factor } from "./units";

test("unit dictionary (CLAUDE.md P2-T4 cases + what extraction actually returns)", () => {
  expect(parseUnit("Rs. per 1000 Nos").unit).toBe("per_1000_pcs");
  expect(parseUnit("per bundle of 25 nos")).toEqual({ unit: "per_bundle", pack: 25 });
  expect(parseUnit("USD / 1000 pcs").unit).toBe("per_1000_pcs");
  expect(parseUnit("1000 pcs").unit).toBe("per_1000_pcs");
  expect(parseUnit("Price per bundle (Rs.)").unit).toBe("per_bundle");
  expect(parseUnit("/kg").unit).toBe("per_kg");
  expect(parseUnit("per box").unit).toBe("per_box");
  expect(parseUnit("per MT").unit).toBe("per_tonne");
  expect(parseUnit("per piece").unit).toBe("per_piece");
  expect(parseUnit("lump sum").unit).toBe("unknown");
  expect(parseUnit(null).unit).toBe("unknown");
});

test("amounts: Indian grouping, /- suffix, decimals", () => {
  expect(parseAmount("13,710/-")).toBe(13710);
  expect(parseAmount("1,04,280")).toBe(104280);
  expect(parseAmount("1,285.74")).toBe(1285.74);
  expect(parseAmount("Rs.42/-")).toBe(42);
  expect(parseAmount("n/a")).toBeNull();
});

test("full price strings", () => {
  expect(parsePrice("Rs.42/- per kg", currencyCode)).toMatchObject({ value: 42, unit: "per_kg", currency: "INR" });
  expect(parsePrice("USD 837.95 / 1000 pcs", currencyCode)).toMatchObject({ value: 837.95, unit: "per_1000_pcs", currency: "USD" });
  expect(parsePrice("Rs. 1,709 per bundle of 25", currencyCode)).toMatchObject({ value: 1709, unit: "per_bundle", pack: 25 });
});

test("conversion factors to per 1000 pcs (TRD §11.2)", () => {
  expect(toPer1000Factor("per_bundle", { pack: 25 })).toBe(40);
  expect(toPer1000Factor("per_bundle", {})).toBeNull();
  expect(42 * toPer1000Factor("per_kg", { weight_g: 1318.1 })!).toBeCloseTo(55360.2, 1); // gold: Anand line 1
  expect(toPer1000Factor("per_piece", {})).toBe(1000);
  expect(toPer1000Factor("unknown", { pack: 25 })).toBeNull();
});

test("FX, gross-up, landed", () => {
  expect(837.95 * fxRate({ USD: { rate: 83.15, date: "2026-09-23", source: "manual" } }, "USD")!.rate).toBeCloseTo(69675.54, 1); // gold: OrientPack line 1
  expect(fxRate({}, "USD")).toBeNull();
  expect(fxRate({}, "INR")!.rate).toBe(1);
  expect(grossUp(65820, 2.5)).toBeCloseTo(67507.69, 1); // gold: Kohinoor line 1
  expect(landed(1000, { freight_included: false, freight_per_1000: 180 })).toBe(1180);
  expect(landed(1000, { freight_included: true, freight_per_1000: 180 })).toBe(1000);
});
