import { z } from "zod";
import { FIELD_LABEL } from "@/lib/line-rules";

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
  // P11 #6: Ask questions per user per window.
  ask_limit: z.object({ questions: z.number().int().min(1, "Allow at least 1 question.").max(1000), minutes: z.number().int().min(1).max(1440, "The window is at most a day (1,440 minutes).") }).strict(),
};

export type Settings = {
  email_mode: "mock" | "gmail" | "resend";
  decision_provider: "auto" | "gemini" | "jev";
  thresholds: { act: number; review: number };
  fx_rates: Record<string, { rate: number; date: string; source: string }>;
  vendor_addresses: Record<string, string>;
  category_templates: Record<string, CategoryTemplate>;
  price_check: { median_ratio: number };
  ask_limit: { questions: number; minutes: number };
};

const PROVIDER_WORD: Record<string, string> = { auto: "Auto", gemini: "Gemini only", jev: "Jev only" };
const fxWords = (r: Settings["fx_rates"] | undefined) => Object.entries(r ?? {}).map(([c, x]) => `${c} ${x.rate} (${x.date}, ${x.source})`).join(", ") || "none";
/** A settings change in words, for the change lists on each Settings / Masters sub-tab and the Audit log. */
export function describeChange(key: string, before: unknown, after: unknown, vendorName?: (id: string) => string): string {
  switch (key) {
    case "decision_provider": return `Decision provider: ${PROVIDER_WORD[String(before)] ?? before} → ${PROVIDER_WORD[String(after)] ?? after}`;
    case "thresholds": { const b = before as Settings["thresholds"], a = after as Settings["thresholds"]; return `Thresholds: act ${b?.act} → ${a.act}, review ${b?.review} → ${a.review}`; }
    case "fx_rates": return `FX rates: ${fxWords(before as Settings["fx_rates"])} → ${fxWords(after as Settings["fx_rates"])}`;
    case "email_mode": return `Email transport: ${before} → ${after}`;
    case "ask_limit": { const b = before as Settings["ask_limit"], a = after as Settings["ask_limit"]; return `Ask limit: ${b?.questions} per ${b?.minutes} min → ${a.questions} per ${a.minutes} min`; }
    case "price_check": { const b = before as Settings["price_check"], a = after as Settings["price_check"]; return `Price check: ${b?.median_ratio}× → ${a.median_ratio}× median`; }
    case "category_templates": {
      const b = (before ?? {}) as Settings["category_templates"], a = (after ?? {}) as Settings["category_templates"];
      const cats = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((c) => JSON.stringify(b[c]) !== JSON.stringify(a[c]));
      return cats.map((c) => `${c}: ${templateChanges(b[c], a[c], vendorName).map((x) => x.text).join("; ") || "no visible change"}`).join(" · ") || "Category template saved, no change";
    }
    default: return `${key.replaceAll("_", " ")} changed`;
  }
}

// Masters sub-tabs, in the order Settings → Masters shows them. The Vendor directory is the vendors table, not the template.
export type TemplatePart = "terms" | "lines" | "questions" | "approved";
const TERM_WORD: Record<keyof CategoryTemplate["standard_terms"], [string, string?]> = {
  currency: ["currency"], quote_unit: ["quote unit"], incoterm: ["delivery basis"], freight_included: ["freight included"], tax_basis: ["GST basis"],
  payment_terms_days: ["payment", "days"], validity_days: ["validity", "days"], contract_months: ["contract", "months"],
};
const lvl = (r: CategoryTemplate["line_rules"], f: LineField) => (r.required.includes(f) ? "required" : r.recommended.includes(f) ? "recommended" : "optional");
const cut = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

/** What changed in one category template, per Masters sub-tab, in words (for the change lists and the Audit log). */
export function templateChanges(before: CategoryTemplate | undefined, after: CategoryTemplate | undefined, vendorName: (id: string) => string = (id) => id): { part: TemplatePart; text: string }[] {
  if (!after) return before ? [{ part: "terms", text: "Template removed" }] : [];
  if (!before) return [{ part: "terms", text: `Template created (${after.source})` }];
  const out: { part: TemplatePart; text: string }[] = [];
  const add = (part: TemplatePart, text: string) => out.push({ part, text });
  if (before.title_pattern !== after.title_pattern) add("terms", `Naming convention: “${before.title_pattern}” → “${after.title_pattern}”`);
  for (const k of Object.keys(TERM_WORD) as (keyof typeof TERM_WORD)[]) {
    const [word, unit] = TERM_WORD[k], x = before.standard_terms[k], y = after.standard_terms[k];
    if (x !== y) add("terms", `Standard terms: ${word} ${String(x).replaceAll("_", " ")} → ${String(y).replaceAll("_", " ")}${unit ? ` ${unit}` : ""}`);
  }
  const band = (p: CategoryTemplate["price_band"]) => (p ? `₹${p.rs_per_kg_min}–${p.rs_per_kg_max}/kg` : "none");
  if (band(before.price_band) !== band(after.price_band)) add("terms", `Usual price: ${band(before.price_band)} → ${band(after.price_band)}`);
  for (const f of LINE_FIELDS) if (lvl(before.line_rules, f) !== lvl(after.line_rules, f)) add("lines", `Line fields: ${FIELD_LABEL[f]} ${lvl(before.line_rules, f)} → ${lvl(after.line_rules, f)}`);
  if (before.line_rules.allowed_ply.join() !== after.line_rules.allowed_ply.join()) add("lines", `Allowed ply: ${before.line_rules.allowed_ply.join(", ")} → ${after.line_rules.allowed_ply.join(", ")}`);
  const qb = before.question_library, qa = after.question_library;
  const qAttrs = (x: (typeof qa)[number], y: (typeof qa)[number], n: number) => {
    if (x.answer_type !== y.answer_type) add("questions", `Question L${n}: answer ${x.answer_type.replace("_", "/")} → ${y.answer_type.replace("_", "/")}`);
    if (x.mandatory !== y.mandatory) add("questions", `Question L${n}: ${y.mandatory ? "now mandatory" : "no longer mandatory"}`);
    if (x.disqualify_if !== y.disqualify_if) add("questions", `Question L${n}: disqualify rule ${x.disqualify_if ?? "none"} → ${y.disqualify_if ?? "none"}`);
  };
  if (qb.length === qa.length) qa.forEach((y, i) => { if (qb[i].text !== y.text) add("questions", `Question L${i + 1} reworded: “${cut(qb[i].text)}” → “${cut(y.text)}”`); qAttrs(qb[i], y, i + 1); });
  else {
    qb.forEach((x, i) => { const j = qa.findIndex((y) => y.text === x.text); if (j < 0) add("questions", `Question L${i + 1} removed: “${cut(x.text)}”`); else qAttrs(x, qa[j], j + 1); });
    qa.forEach((y, j) => { if (!qb.some((x) => x.text === y.text)) add("questions", `Question L${j + 1} added: “${cut(y.text)}”`); });
  }
  const gone = before.approved_vendor_ids.filter((id) => !after.approved_vendor_ids.includes(id)), come = after.approved_vendor_ids.filter((id) => !before.approved_vendor_ids.includes(id));
  if (come.length) add("approved", `Approved vendors: added ${come.map(vendorName).join(", ")}`);
  if (gone.length) add("approved", `Approved vendors: removed ${gone.map(vendorName).join(", ")}`);
  return out;
}
