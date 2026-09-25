// P9 D1: price sanity check ("check unit"). Pure, so the rule is unit-tested (D6); the flags stage writes the cards.
// A price far from the other vendors' median on the same line, or an implied ₹/kg outside the usual band, is most often
// a unit slip (per piece read as per 1000, per box of 25 read as per piece). The cell keeps its state — the card asks.

/** The global ratio (Settings) plus the category's usual ₹/kg band (category template; null = no ₹/kg check). */
export type PriceCheckSettings = { median_ratio: number; rs_per_kg_min: number | null; rs_per_kg_max: number | null };
export const PRICE_CHECK_DEFAULT = { median_ratio: 2 };

export type PricedCell = { line_quote_id: string; line_no: number; vendor: string; price: number; weight_g: number | null };
export type Outlier = PricedCell & { median: number | null; ratio: number | null; rs_per_kg: number | null; reasons: ("median" | "per_kg")[] };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Cells whose price (₹ per 1000 pcs) is > ratio× or < 1/ratio× the median of at least 2 other vendors, or whose ₹/kg is outside the band. */
export function priceOutliers(cells: PricedCell[], s: PriceCheckSettings): Outlier[] {
  return cells.flatMap((c) => {
    const others = cells.filter((o) => o.line_no === c.line_no && o.vendor !== c.vendor).map((o) => o.price);
    const med = others.length >= 2 ? median(others) : null;
    const ratio = med ? c.price / med : null;
    // ₹ per 1000 pcs ÷ (1000 × g per piece / 1000 g per kg) = ₹ per 1000 pcs ÷ g per piece.
    const perKg = c.weight_g && c.weight_g > 0 ? c.price / c.weight_g : null;
    const reasons: Outlier["reasons"] = [];
    if (ratio !== null && (ratio > s.median_ratio || ratio < 1 / s.median_ratio)) reasons.push("median");
    if (perKg !== null && s.rs_per_kg_min !== null && s.rs_per_kg_max !== null && (perKg < s.rs_per_kg_min || perKg > s.rs_per_kg_max)) reasons.push("per_kg");
    return reasons.length ? [{ ...c, median: med, ratio, rs_per_kg: perKg, reasons }] : [];
  });
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/** The card's title: the numbers that tripped the check. */
export function outlierTitle(o: Outlier, s: PriceCheckSettings): string {
  const parts: string[] = [];
  if (o.reasons.includes("median")) parts.push(`${inr(o.price)} per 1000 is ${o.ratio! >= 1 ? `${o.ratio!.toFixed(1)}×` : `${(1 / o.ratio!).toFixed(1)}× below`} the other vendors' median (${inr(o.median!)})`);
  if (o.reasons.includes("per_kg")) parts.push(`${o.reasons.includes("median") ? "" : `${inr(o.price)} per 1000 `}implies ₹${o.rs_per_kg!.toFixed(1)}/kg (usual ₹${s.rs_per_kg_min}–${s.rs_per_kg_max})`);
  return `Check unit — ${parts.join("; ")}`;
}
