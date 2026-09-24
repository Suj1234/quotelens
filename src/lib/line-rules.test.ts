import { expect, test } from "vitest";
import { gapText, hasField, lineErrors, lineGaps } from "./line-rules";

const rules = { required: ["description", "ply", "dimensions", "gsm_spec", "monthly_qty", "delivery_location"] as const, recommended: ["weight_per_piece_g", "sku"] as const, allowed_ply: [3, 5, 7] };
const box = { line_no: 1, sku: "MF-1", description: "Box", ply: 5, length_mm: 600, width_mm: 400, height_mm: 400, gsm_spec: "150/120/150/120/150", item_type: "box", weight_per_piece_g: 1318, monthly_qty: 3600, delivery_location: "Hosur" };

test("stored defaults count as missing: qty 0, plant —, SKU LINE-n; a box needs H, a sheet doesn't", () => {
  expect(hasField({ monthly_qty: 0 }, "monthly_qty")).toBe(false);
  expect(hasField({ delivery_location: "—" }, "delivery_location")).toBe(false);
  expect(hasField({ sku: "LINE-4" }, "sku")).toBe(false);
  expect(hasField({ item_type: "box", length_mm: 1, width_mm: 1, height_mm: null }, "dimensions")).toBe(false);
  expect(hasField({ item_type: "sheet", length_mm: 1, width_mm: 1, height_mm: null }, "dimensions")).toBe(true);
});

test("gaps are grouped per field with line numbers; complete lines have none", () => {
  const g = lineGaps([box, { ...box, line_no: 2, monthly_qty: 0, weight_per_piece_g: null }, { ...box, line_no: 3, monthly_qty: null, gsm_spec: null }], { ...rules, required: [...rules.required], recommended: [...rules.recommended] });
  expect(gapText(g.required)).toEqual(["GSM spec missing on line 3", "monthly quantity missing on lines 2, 3"]);
  expect(gapText(g.recommended)).toEqual(["weight per piece missing on line 2"]);
  expect(lineGaps([box], { ...rules, required: [...rules.required], recommended: [...rules.recommended] }).required).toEqual([]);
});

test("wrong values: ply outside the template, GSM layers ≠ ply", () => {
  expect(lineErrors({ ply: 4 }, [3, 5, 7])).toEqual(["ply 4 — allowed: 3, 5, 7"]);
  expect(lineErrors({ ply: 5, gsm_spec: "150/120/150" }, [3, 5, 7])).toEqual(["GSM spec has 3 layers for a 5-ply board"]);
});
