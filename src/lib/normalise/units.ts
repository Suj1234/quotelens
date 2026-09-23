// TRD §11.1–11.2: unit dictionary and conversion to per_1000_pcs. Pure.
export type UnitKey = "per_piece" | "per_1000_pcs" | "per_100_pcs" | "per_box" | "per_bundle" | "per_kg" | "per_tonne" | "per_sqm" | "per_set" | "unknown";

// Order matters (TRD §11.1). Widened slightly: "1000 pcs" without "per", "/ 1000" with spaces.
const RULES: [RegExp, UnitKey][] = [
  [/per\s*1,?000\b|\/\s*1,?000\b|per\s*thousand|\/\s*k\b|per\s*1k\b|^\s*1,?000\s*(pcs|pieces|nos|no\.?)\b/i, "per_1000_pcs"],
  [/per\s*100\b|\/\s*100\b|^\s*100\s*(pcs|pieces|nos)\b/i, "per_100_pcs"],
  [/per\s*(pc|piece|pcs|nos|no\.|unit|each)\b|\/\s*(pc|piece|pcs|nos)\b|^\s*(each|per\s*no)\b/i, "per_piece"],
  [/per\s*(box|carton|ctn)\b|\/\s*(box|carton|ctn)\b/i, "per_box"],
  [/per\s*bundle|\/\s*bundle|\bbundle\b/i, "per_bundle"],
  [/per\s*kg|\/\s*kg|kilogram|\bkg\b/i, "per_kg"],
  [/per\s*(mt|ton|tonne)\b|\/\s*(mt|ton|tonne)\b/i, "per_tonne"],
  [/sq\.?\s*m\b|sqm|\bm2\b/i, "per_sqm"],
  [/per\s*set\b|\/\s*set\b/i, "per_set"],
];

/** "per bundle of 25 nos" → {unit: per_bundle, pack: 25}. */
export function parseUnit(raw: string | null | undefined): { unit: UnitKey; pack: number | null } {
  if (!raw) return { unit: "unknown", pack: null };
  const unit = RULES.find(([re]) => re.test(raw))?.[1] ?? "unknown";
  const pack = raw.match(/\bof\s*(\d+)\b/i);
  return { unit, pack: pack ? Number(pack[1]) : null };
}

/** "13,710/-" → 13710 · "1,04,280" → 104280 · "Rs.42/-" → 42 · "837.95" → 837.95. Null when no number. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (!raw) return null;
  const m = raw.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "Rs.42/- per kg" → {value: 42, unit: per_kg, currency: "INR"}. */
export function parsePrice(raw: string, currencyCode: (s: string) => string | null) {
  const cur = raw.match(/₹|\bINR\b|\bRs\.?|US\$|\$|\bUSD\b|€|\bEUR\b/i);
  const { unit, pack } = parseUnit(raw.replace(/\d+(?:[,.]\d+)*\/-/g, " "));
  return { value: parseAmount(raw), unit, pack, currency: cur ? currencyCode(cur[0]) : null };
}

/** Factor to per_1000_pcs, or null when the basis (pack size / weight) is missing. */
export function toPer1000Factor(unit: UnitKey, basis: { pack?: number | null; weight_g?: number | null }): number | null {
  switch (unit) {
    case "per_1000_pcs": return 1;
    case "per_100_pcs": return 10;
    case "per_piece": case "per_set": return 1000; // a partition "set" is one piece on our line sheet
    case "per_box": case "per_bundle": return basis.pack ? 1000 / basis.pack : null;
    case "per_kg": return basis.weight_g ? basis.weight_g : null;           // ₹/kg × g/pc ÷ 1000 × 1000
    case "per_tonne": return basis.weight_g ? basis.weight_g / 1000 : null; // ₹/t × g/pc ÷ 1e6 × 1000
    default: return null; // per_sqm needs spec_attributes.blank_area_sqm (not on our lines); unknown → ambiguous
  }
}
