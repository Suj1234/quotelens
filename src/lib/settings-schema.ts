import { z } from "zod";

// One schema per settings key (TRD §6.19). Pure, so the rules are unit-tested.

// P9: a sourcing template per category — the company's standard terms, the fields every line must carry, the approved
// question library and the approved vendors. The co-pilot works from it and says so; Issue enforces its required fields.
// Industry equivalent: event/sourcing templates + supplier-qualification question library + approved vendor list.
export const LINE_FIELDS = ["sku", "description", "ply", "dimensions", "gsm_spec", "burst_factor", "item_type", "weight_per_piece_g", "monthly_qty", "delivery_location"] as const;
export type LineField = (typeof LINE_FIELDS)[number];
export const CategoryTemplate = z.object({
  source: z.string().trim().max(200).describe("where the values came from, shown to the buyer"),
  title_pattern: z.string().trim().min(3).max(200).describe("naming convention the co-pilot fills from what the buyer says"),
  standard_terms: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code."), quote_unit: z.enum(["per_1000_pcs", "per_piece", "per_kg", "per_box"]),
    incoterm: z.enum(["delivered", "ex_works", "fob"]), freight_included: z.boolean(), tax_basis: z.enum(["excl_gst", "incl_gst"]),
    payment_terms_days: z.number().int().min(0).max(365), validity_days: z.number().int().min(1).max(365), contract_months: z.number().int().min(1).max(60),
  }).strict(),
  line_rules: z.object({
    required: z.array(z.enum(LINE_FIELDS)).min(1, "At least the description must be required."),
    recommended: z.array(z.enum(LINE_FIELDS)),
    allowed_ply: z.array(z.number().int().positive()).min(1),
  }).strict().refine((r) => r.required.includes("description"), "Description is always required."),
  question_library: z.array(z.object({
    text: z.string().trim().min(5).max(500), answer_type: z.enum(["yes_no", "number", "text"]), mandatory: z.boolean(),
    disqualify_if: z.string().trim().regex(/^(no|yes|(lt|lte|gt|gte):\d+(\.\d+)?)$/, 'Disqualify rule: "no", "yes", "lt:200", "gt:30".').nullable(),
  }).strict()).max(50),
  approved_vendor_ids: z.array(z.uuid()).max(200),
  // P10 S4: the usual price per kg is a fact about the category (corrugated ≠ IT hardware), so it lives here, not globally.
  price_band: z.object({ rs_per_kg_min: z.number().min(0), rs_per_kg_max: z.number().positive() }).strict()
    .refine((p) => p.rs_per_kg_min < p.rs_per_kg_max, "The ₹/kg minimum must be below the maximum.").nullable().optional(),
}).strict();
export type CategoryTemplate = z.infer<typeof CategoryTemplate>;

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
  // P10: no discount switch, no default freight, no cost of money — those were facts about one vendor's quote, not policy.
  vendor_addresses: z.record(z.string(), z.email()),
  category_templates: z.record(z.string().trim().min(1), CategoryTemplate),
  // P9 D2: price sanity check — flag > ratio× / < 1/ratio× the other vendors' median (the ₹/kg band is per category, P10 S4).
  price_check: z.object({ median_ratio: z.number().min(1.2, "The ratio must be at least 1.2.").max(10) }).strict(),
};

export type Settings = {
  email_mode: "mock" | "gmail" | "resend";
  decision_provider: "auto" | "gemini" | "jev";
  thresholds: { act: number; review: number };
  fx_rates: Record<string, { rate: number; date: string; source: string }>;
  vendor_addresses: Record<string, string>;
  category_templates: Record<string, CategoryTemplate>;
  price_check: { median_ratio: number };
};

const PROVIDER_WORD: Record<string, string> = { auto: "Auto", gemini: "Gemini only", jev: "Jev only" };
const fxWords = (r: Settings["fx_rates"] | undefined) => Object.entries(r ?? {}).map(([c, x]) => `${c} ${x.rate} (${x.date}, ${x.source})`).join(", ") || "none";
/** A settings change in words, for "Recent changes" on the Settings page. */
export function describeChange(key: string, before: unknown, after: unknown): string {
  switch (key) {
    case "decision_provider": return `Decision provider: ${PROVIDER_WORD[String(before)] ?? before} → ${PROVIDER_WORD[String(after)] ?? after}`;
    case "thresholds": { const b = before as Settings["thresholds"], a = after as Settings["thresholds"]; return `Thresholds: act ${b?.act} → ${a.act}, review ${b?.review} → ${a.review}`; }
    case "fx_rates": return `FX rates: ${fxWords(before as Settings["fx_rates"])} → ${fxWords(after as Settings["fx_rates"])}`;
    case "email_mode": return `Email transport: ${before} → ${after}`;
    case "price_check": { const b = before as Settings["price_check"], a = after as Settings["price_check"]; return `Price check: ${b?.median_ratio}× → ${a.median_ratio}× median`; }
    case "category_templates": return `Category template changed: ${Object.keys((after ?? {}) as object).join(", ") || "none"}`;
    default: return `${key.replaceAll("_", " ")} changed`;
  }
}
