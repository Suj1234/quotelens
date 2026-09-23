// TRD §11.4 discounts, §11.7 landed cost. Pure.

/** Line-level discount as written (vendor-stated, applied net). */
export const applyLineDiscount = (v: number, pct: number | null) => (pct ? v * (1 - pct / 100) : v);

/** Rates printed net of a discount the buyer won't earn → payable = printed ÷ (1 − pct). */
export const grossUp = (v: number, pct: number) => v / (1 - pct / 100);

/** landed = unit + freight (0 when included) (+ tax when settings say so). Cost of money is cut-list item 2 (CLAUDE.md §5). */
export function landed(unit: number, o: { freight_included: boolean | null; freight_per_1000: number; tax_pct?: number | null; include_tax?: boolean }) {
  const freight = o.freight_included === true ? 0 : o.freight_per_1000;
  const tax = o.include_tax && o.tax_pct ? unit * (o.tax_pct / 100) : 0;
  return unit + freight + tax;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
