import { discountText } from "@/lib/scenarios/allocate";
import { inrShort } from "@/lib/format";

type D = { vendor: string; pct: number; condition: string | null; met: boolean | null; why: string; saving: number };

/** P10 D4: every vendor discount in this award option — met (and what it saves) or not, and why. Nothing when no vendor offers one. */
export function DiscountLines({ discounts, style }: { discounts: D[] | undefined; style?: React.CSSProperties }) {
  if (!discounts?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, ...style }}>
      {discounts.map((d) => (
        <div key={d.vendor} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className={`chip ${d.met === true ? "green" : d.met === false ? "grey" : "amber"}`}>{d.met === true ? "Discount applied" : d.met === false ? "Discount not earned" : "Discount unclear"}</span>
          <span>{discountText(d)}</span>
          {d.met && d.saving > 0 && <span className="mono text-muted-foreground">−{inrShort(d.saving)} a year</span>}
        </div>
      ))}
    </div>
  );
}
