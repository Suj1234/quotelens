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

describe("statedPack", () => {
  it("trusts a pack size only when the vendor wrote its number", async () => {
    const { statedPack } = await import("./normalise");
    const item = (pack: number | null, unit: string, snippet: string) => ({ pack_size: pack, price_unit_raw: unit, vendor_description: "item 5", location: { snippet } }) as never;
    expect(statedPack(item(25, "per bundle of 25", "Rs. 857 per bundle of 25"))).toBe(25);
    expect(statedPack(item(25, "per bundle", "item 4 (400x300x250) Rs. 857 per bundle of 25 nos"))).toBe(25);
    expect(statedPack(item(25, "per bundle", "For items 5 and 9 our price is Rs. 699 and Rs. 1,374 per bundle respectively."))).toBeNull(); // extractor guessed 25
    expect(statedPack(item(null, "per bundle", "per bundle"))).toBeNull();
  });
});
