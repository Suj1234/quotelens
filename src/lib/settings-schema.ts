import { z } from "zod";

// One schema per settings key (TRD §6.19). Pure, so the rules are unit-tested.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
export const SettingSchemas = {
  // Live Gmail and Resend are not in this build (DECISIONS "Live Gmail out of scope"): only mock can be chosen.
  email_mode: z.literal("mock", { error: "Only the mock transport is available in this build." }),
  decision_provider: z.enum(["auto", "gemini", "jev"], { error: "Provider must be auto, gemini or jev." }),
  thresholds: z.object({ act: z.number(), review: z.number() }).strict()
    .refine((t) => t.review > 0 && t.review < t.act && t.act <= 1, "Thresholds must satisfy 0 < review < act ≤ 1."),
  fx_rates: z.record(z.string(),
    z.object({ rate: z.number().positive("Rate must be above 0."), date, source: z.string().trim().min(1, "Source is required.").max(60) }).strict())
    .refine((r) => Object.keys(r).every((c) => /^[A-Z]{3}$/.test(c)), "Currency must be a 3-letter code like USD.")
    .refine((r) => !("INR" in r), "INR is the RFx currency; it has no rate."),
  landed_cost: z.object({ include_tax: z.literal(false), cost_of_money_annual_pct: z.literal(0) }).strict(), // neither is in this build
  discount_default: z.enum(["gross", "net"], { error: "Discount default must be gross or net." }),
  vendor_addresses: z.record(z.string(), z.email()),
  freight_default_inr_per_1000: z.number().min(0, "Freight can't be negative.").max(100000),
};

export type Settings = {
  email_mode: "mock" | "gmail" | "resend";
  decision_provider: "auto" | "gemini" | "jev";
  thresholds: { act: number; review: number };
  fx_rates: Record<string, { rate: number; date: string; source: string }>;
  landed_cost: { include_tax: boolean; cost_of_money_annual_pct: number };
  discount_default: "gross" | "net";
  vendor_addresses: Record<string, string>;
  freight_default_inr_per_1000: number;
};

const PROVIDER_WORD: Record<string, string> = { auto: "Auto", gemini: "Gemini only", jev: "Jev only" };
const fxWords = (r: Settings["fx_rates"] | undefined) => Object.entries(r ?? {}).map(([c, x]) => `${c} ${x.rate} (${x.date}, ${x.source})`).join(", ") || "none";
/** A settings change in words, for "Recent changes" on the Settings page. */
export function describeChange(key: string, before: unknown, after: unknown): string {
  switch (key) {
    case "decision_provider": return `Decision provider: ${PROVIDER_WORD[String(before)] ?? before} → ${PROVIDER_WORD[String(after)] ?? after}`;
    case "thresholds": { const b = before as Settings["thresholds"], a = after as Settings["thresholds"]; return `Thresholds: act ${b?.act} → ${a.act}, review ${b?.review} → ${a.review}`; }
    case "fx_rates": return `FX rates: ${fxWords(before as Settings["fx_rates"])} → ${fxWords(after as Settings["fx_rates"])}`;
    case "discount_default": return `Total-level discounts: ${before} → ${after}`;
    case "freight_default_inr_per_1000": return `Freight default: ₹${before} → ₹${after} per 1000 pcs`;
    case "email_mode": return `Email transport: ${before} → ${after}`;
    default: return `${key.replaceAll("_", " ")} changed`;
  }
}
