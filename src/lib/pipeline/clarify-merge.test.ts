import { describe, expect, it } from "vitest";
import { mergeClarified } from "./normalise";
import type { ExtractedItem } from "./map";

const item = (o: Partial<ExtractedItem>): ExtractedItem => ({
  id: "x", item_index: 0, file_id: null, unit_price: null, price_unit_raw: null, currency_raw: null, pack_size: null, pack_size_unit: null,
  discount_pct: null, notes: null, raw_confidence: 1, location: {}, vendor_description: "", vendor_sku: null, ...o,
} as ExtractedItem);

describe("clarification reply laid over the first read (TRD §8.7)", () => {
  const westline9 = item({ id: "orig", unit_price: 1374, price_unit_raw: "per bundle", currency_raw: "INR", raw_confidence: 0.95 });
  it("keeps the first price and takes the pack size the vendor now states", () => {
    const m = mergeClarified(westline9, item({ id: "reply", vendor_description: "Item 9 (550x350x350, 5-ply)", pack_size: 20, raw_confidence: 1 }));
    expect(m).toMatchObject({ id: "reply", unit_price: 1374, price_unit_raw: "per bundle", currency_raw: "INR", pack_size: 20, raw_confidence: 0.95 });
  });
  it("reads a pack size written in the unit (\"per bundle of 40\")", () => {
    expect(mergeClarified(westline9, item({ price_unit_raw: "per bundle of 40" })).pack_size).toBe(40);
  });
  it("a new price wins, with its own unit, currency and read confidence", () => {
    const m = mergeClarified(item({ unit_price: null, raw_confidence: 0.2, currency_raw: "USD", price_unit_raw: "per 1000 pcs" }),
      item({ unit_price: 64.5, price_unit_raw: "per 1000 pcs", currency_raw: "USD", raw_confidence: 0.9 }));
    expect(m).toMatchObject({ unit_price: 64.5, currency_raw: "USD", raw_confidence: 0.9 });
  });
  it("an answer with neither price nor pack changes nothing about the price", () => {
    const m = mergeClarified(westline9, item({ notes: "will confirm next week" }));
    expect(m).toMatchObject({ unit_price: 1374, pack_size: null });
  });
});
