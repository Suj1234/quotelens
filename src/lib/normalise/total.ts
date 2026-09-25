import { parseUnit, toPer1000Factor } from "./units";

// P10 C13: the vendor's own grand total against the sum of its lines — a check that catches a misread line, a hidden charge
// or a discount taken at the bottom without knowing which. Pure, in the vendor's own currency (no conversion needed).
type Item = { unit_price: number | null; price_unit_raw: string | null; quantity: number | null; quantity_unit: string | null; pack_size: number | null };

/** Σ price × quantity over the items whose unit and quantity can be read as pieces; `covered` of `priced` items counted. */
export function linesTotal(items: Item[]): { sum: number; covered: number; priced: number } {
  let sum = 0, covered = 0, priced = 0;
  for (const it of items) {
    if (it.unit_price === null) continue;
    priced++;
    if (it.quantity === null || it.quantity <= 0) continue;
    const q = (it.quantity_unit ?? "").trim().toLowerCase();
    const pcs = !q || /^(no|nos|nos\.|pc|pcs|piece|pieces|number|numbers|unit|units|qty)$/.test(q) ? it.quantity
      : /1000|thousand|'000|k\s*pcs/.test(q) ? it.quantity * 1000 : null;
    const { unit, pack } = parseUnit(it.price_unit_raw);
    const factor = unit === "per_kg" || unit === "per_tonne" ? null : toPer1000Factor(unit, { pack: it.pack_size ?? pack });
    if (pcs === null || factor === null) continue;
    sum += it.unit_price * factor * pcs / 1000;
    covered++;
  }
  return { sum, covered, priced };
}

/** Within 2% — or within 2% once 18% GST is added or taken out (a total that includes GST is not a mismatch). */
export function totalCheck(stated: number, sum: number): { ok: boolean; pct: number; gst: boolean } {
  const off = (x: number) => Math.abs(x - stated) / stated;
  const pct = Math.round(off(sum) * 1000) / 10;
  if (off(sum) <= 0.02) return { ok: true, pct, gst: false };
  if (off(sum * 1.18) <= 0.02 || off(sum / 1.18) <= 0.02) return { ok: true, pct, gst: true };
  return { ok: false, pct, gst: false };
}
