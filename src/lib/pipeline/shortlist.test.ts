import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { RfxLine } from "@/types/db";
import { itemRange, refs, shortlist } from "./shortlist";

// The real RFx line sheet from the dataset pack.
const [head, ...rows] = readFileSync("supabase/seed/00_rfx/rfx_lines.csv", "utf8").trim().split("\n");
const cols = head.split(",");
const LINES = rows.map((r) => {
  const v = Object.fromEntries(r.split(",").map((x, i) => [cols[i], x]));
  const num = (k: string) => (v[k] ? Number(v[k]) : null);
  return { line_no: +v.line_no, sku: v.sku, description: v.description, ply: num("ply"), length_mm: num("length_mm"), width_mm: num("width_mm"), height_mm: num("height_mm"), item_type: v.item_type } as RfxLine;
});
const item = (vendor_description: string, snippet = "", vendor_sku: string | null = null) => ({ vendor_description, vendor_sku, location: { snippet } });
const top = (it: ReturnType<typeof item>) => shortlist(it, LINES).map((c) => c.line_no);

test("Balaji generic description → line 1 in top 5 (size + ply + type)", () => {
  expect(top(item("Corrugated Box 600x400x400 5 ply"))).toContain(1);
  expect(top(item("Corrugated Box 600x400x400 5 ply"))[0]).toBe(1);
});

test("Balaji row: description only 'Export carton', size and ply in the snippet; partition with same size is not first", () => {
  expect(top(item("Export carton", "A8=1 B8=SBP-1001 C8=Export carton D8=600x400x400 E8=5 ply / BF 32", "SBP-1001"))[0]).toBe(1);
  expect(top(item("Partition set 12-cell for 600x400x400", "D35=600x400x400 E35=3 ply", "SBP-1028"))[0]).toBe(28);
});

test("Westline 'item 9' → line 9 via the explicit item number", () => {
  expect(top(item("5-ply cartons item 9"))[0]).toBe(9);
});

test("Westline split sentence: description '9' alone, item number only in the snippet", () => {
  const snip = "For items 5 and 9 our price is Rs. 699 and Rs. 1,374 per bundle respectively.";
  expect(top(item("9", snip))[0]).toBe(9);
  expect(top(item("items 5", snip))[0]).toBe(5);
  expect(top(item("5-ply cartons item 9", snip, "items 9"))[0]).toBe(9);
});

test("Dimensions tolerate ±5% and '×' with spaces", () => {
  expect(top(item("Shipper 5 ply 452 × 298 × 305 mm"))[0]).toBe(3);
});

test("item references and ranges", () => {
  expect(refs("For items 5 and 9 our price")).toEqual([5, 9]);
  expect(refs("S.No 12")).toEqual([12]);
  expect(itemRange(item("the 5-ply boxes (items 1 to 12)"), 30)).toEqual([1, 12]);
  expect(itemRange(item("Sheets", "Sheets, layer pads and partitions (items 23 to 30) - rest same"), 30)).toEqual([23, 30]);
  expect(itemRange(item("item 9"), 30)).toBeNull();
  expect(itemRange(item("items 1 to 40"), 30)).toBeNull();
});
