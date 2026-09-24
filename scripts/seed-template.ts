// P9: the "Corrugated packaging" category template (Settings → Category templates), built from the dataset's own files:
// terms from 00_rfx/rfx_meta.json (MER-0417), the question library from 00_rfx/questions.json, approved vendors = the five
// vendors invited on MER-0417. Insert-if-missing, so an edited template is never overwritten; `--force` replaces it.
//   npm run seed:template            npm run seed:template -- --force
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { CategoryTemplate } from "@/lib/settings-schema";

const SEED = path.join(process.cwd(), "supabase/seed/00_rfx");
const meta = JSON.parse(fs.readFileSync(path.join(SEED, "rfx_meta.json"), "utf8"));
const questions: { text: string; answer_type: "yes_no" | "number" | "text"; mandatory: boolean; disqualify_if: string | null }[] =
  JSON.parse(fs.readFileSync(path.join(SEED, "questions.json"), "utf8"));

const { data: rfx } = await db().from("rfx").select("id").eq("code", meta.code).maybeSingle();
const { data: invited, error } = await db().from("rfx_vendors").select("vendor_id").eq("rfx_id", rfx?.id ?? "00000000-0000-0000-0000-000000000000");
if (error) throw error;

const template = CategoryTemplate.parse({
  source: `Meridian's corrugated packaging standard, taken from ${meta.code} (${meta.title})`,
  title_pattern: "{Category} — {Period} {Contract type} ({Plants})", // the shape of the MER-0417 title
  standard_terms: {
    currency: meta.currency, quote_unit: meta.quote_unit, incoterm: meta.incoterm, freight_included: meta.freight_included_requested,
    tax_basis: "excl_gst", // every vendor on MER-0417 quoted "GST extra"
    payment_terms_days: meta.payment_terms_days, validity_days: meta.validity_days_requested, contract_months: meta.contract_months,
  },
  line_rules: {
    required: ["description", "ply", "dimensions", "gsm_spec", "monthly_qty", "delivery_location"],
    recommended: ["weight_per_piece_g", "burst_factor", "sku"],
    allowed_ply: [3, 5, 7],
  },
  question_library: questions.map((q) => ({ text: q.text, answer_type: q.answer_type, mandatory: q.mandatory, disqualify_if: q.disqualify_if })),
  approved_vendor_ids: (invited ?? []).map((v) => v.vendor_id as string),
});

const { data: cur } = await db().from("settings").select("value").eq("key", "category_templates").maybeSingle();
const all = (cur?.value ?? {}) as Record<string, unknown>;
if (all[meta.category] && !process.argv.includes("--force")) {
  console.log(`[seed:template] "${meta.category}" already exists — kept (use --force to replace).`);
} else {
  const up = await db().from("settings").upsert({ key: "category_templates", value: { ...all, [meta.category]: template }, updated_at: new Date().toISOString() });
  if (up.error) throw up.error;
  console.log(`[seed:template] "${meta.category}": ${template.question_library.length} questions, ${template.approved_vendor_ids.length} approved vendors, terms ${JSON.stringify(template.standard_terms)}`);
}
