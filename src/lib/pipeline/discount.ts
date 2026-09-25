import "server-only";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { VENDOR_DATA_RULE, vendorText } from "@/lib/ai/vendor-data";

// P10 D2: what a vendor's total-level discount depends on. The model only sorts the condition into one of a few kinds and
// reads its number; whether it is met is decided in code, per award option (src/lib/scenarios/allocate.ts applyDiscounts).
export const DISCOUNT_KINDS = ["all_lines", "min_lines", "min_value", "payment_days", "none", "unclear"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
export type DiscountReading = { kind: DiscountKind; min_lines: number | null; min_value_inr: number | null; payment_days: number | null };

const Reading = z.object({
  kind: z.enum(DISCOUNT_KINDS),
  min_lines: z.number().int().positive().nullable(),
  min_value_inr: z.number().positive().nullable(),
  payment_days: z.number().int().positive().nullable(),
}).refine((r) => (r.kind !== "min_lines" || r.min_lines !== null) && (r.kind !== "min_value" || r.min_value_inr !== null) && (r.kind !== "payment_days" || r.payment_days !== null),
  "min_lines / min_value_inr / payment_days must be set for their kind");

const PROMPT = (lines: number) => `A supplier offers a discount on the total of its quotation. Sort the condition it depends on into exactly one kind:
- all_lines: the supplier must be awarded every item of the enquiry (this enquiry has ${lines} items), e.g. "if all 30 items are awarded to us".
- min_lines: at least a number of items; set min_lines.
- min_value: an order of at least an amount in rupees; set min_value_inr (convert lakh/crore: 1 lakh = 100000, 1 crore = 10000000).
- payment_days: payment within a number of days; set payment_days.
- none: no condition stated.
- unclear: any other condition, or you can't tell.
Leave the numbers of other kinds null. Return only JSON.`;

export async function readDiscount(o: { pct: number; condition: string | null; lines: number; rfx_id: string; response_id: string }): Promise<DiscountReading> {
  if (!o.condition?.trim()) return { kind: "none", min_lines: null, min_value_inr: null, payment_days: null };
  return generateJSON({
    tier: "fast", purpose: "discount_condition", rfx_id: o.rfx_id, response_id: o.response_id, schema: Reading, temperature: 0,
    parts: [{ text: PROMPT(o.lines) }, { text: vendorText("discount condition", `${o.pct}% discount — ${o.condition}`) }, { text: VENDOR_DATA_RULE }],
  });
}

/** "applies when all 30 lines are awarded" — the reading in words, for the card and the ledger. */
export function readingText(r: DiscountReading, lines: number): string {
  switch (r.kind) {
    case "all_lines": return `applies when all ${lines} lines are awarded to this vendor`;
    case "min_lines": return `applies when at least ${r.min_lines} lines are awarded to this vendor`;
    case "min_value": return `applies when this vendor's award is at least ₹${r.min_value_inr!.toLocaleString("en-IN")}`;
    case "payment_days": return `applies when we pay within ${r.payment_days} days`;
    case "none": return "applies to any award";
    default: return "condition unclear — confirm it on the card";
  }
}
