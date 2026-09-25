import { expect, test } from "vitest";
import { outlierTitle, priceOutliers, type PricedCell } from "./price-check";

const S = { median_ratio: 2, rs_per_kg_min: 25, rs_per_kg_max: 150 }; // corrugated band (category template)

const c = (vendor: string, price: number, line_no = 1, weight_g: number | null = null): PricedCell => ({ line_quote_id: `${vendor}-${line_no}`, line_no, vendor, price, weight_g });

test("median rule: > 2× or < 0.5× the other vendors' median is flagged; within the band is not", () => {
  const out = priceOutliers([c("a", 50_000), c("b", 52_000), c("c", 48_000), c("d", 120_000), c("e", 20_000)], S);
  expect(out.map((o) => o.vendor)).toEqual(["d", "e"]);
  expect(out[0].median).toBe(49_000); // a, b, c, e → (48k + 50k) / 2
  expect(outlierTitle(out[0], S)).toBe("Check unit — ₹1,20,000 per 1000 is 2.4× the other vendors' median (₹49,000)");
  expect(outlierTitle(out[1], S)).toBe("Check unit — ₹20,000 per 1000 is 2.5× below the other vendors' median (₹51,000)");
});

test("fewer than 2 other vendors on the line = no median check", () => {
  expect(priceOutliers([c("a", 50_000), c("b", 500_000)], S)).toEqual([]);
  expect(priceOutliers([c("a", 50_000, 1), c("b", 52_000, 2), c("c", 500_000, 3)], S)).toEqual([]); // different lines
});

test("₹/kg band: price per 1000 ÷ grams per piece, outside ₹25–150 is flagged even with no other vendors", () => {
  const [o] = priceOutliers([c("a", 13_710, 1, 1318)], S); // ₹10.4/kg — per-piece read as per-1000
  expect(o.reasons).toEqual(["per_kg"]);
  expect(outlierTitle(o, S)).toBe("Check unit — ₹13,710 per 1000 implies ₹10.4/kg (usual ₹25–150)");
  expect(priceOutliers([c("a", 65_000, 1, 1318)], S)).toEqual([]); // ₹49/kg
  expect(priceOutliers([c("a", 65_000, 1, null)], S)).toEqual([]); // no weight, no ₹/kg check
});
