// P0-T4 · TRD §20 steps 1–5. Idempotent: users/vendors/lines/questions/settings upsert on their natural keys;
// RFx headers, invitations and settings are insert-if-missing so a re-seed never resets a demo in progress.
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/errors";
import { hashPassword } from "@/lib/password";

const SEED = path.join(process.cwd(), "supabase/seed");
const read = (p: string) => fs.readFileSync(path.join(SEED, p), "utf8");

function must<T>(res: { data: T; error: unknown }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data as NonNullable<T>;
}

const meta = JSON.parse(read("00_rfx/rfx_meta.json"));
const questions: { q_no: number; text: string; answer_type: string; mandatory: boolean; disqualify_if: string | null }[] =
  JSON.parse(read("00_rfx/questions.json"));
const csv = XLSX.read(read("00_rfx/rfx_lines.csv"), { type: "string", raw: true });
const lines = XLSX.utils.sheet_to_json<Record<string, string>>(csv.Sheets[csv.SheetNames[0]]);
const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));

// 1. Users
const password = await hashPassword(requireEnv("SEED_ADMIN_PASSWORD"));
const users = must(
  await db().from("users").upsert(
    [
      { email: meta.buyer.email, name: meta.buyer.name, role: "buyer", password_hash: password },
      { email: "priya.raghavan@meridianfoods.example", name: meta.approver.name, role: "approver", password_hash: password },
    ],
    { onConflict: "email" },
  ).select("id, email"),
  "users",
);
const buyerId = users.find((u) => u.email === meta.buyer.email)!.id;

// 2. Vendors (PRD §6.4; contacts from the dataset letterheads)
const VENDORS = [
  { short_code: "balaji", name: "Sri Balaji Packaging", contact_name: "R. Krishnan", email: "sales@sribalajipack.example", city: "Hosur", state: "Tamil Nadu" },
  { short_code: "kohinoor", name: "Kohinoor Corrugators Pvt Ltd", contact_name: "R. Deshpande", email: "sales@kohinoorcorr.example", city: "Pune", state: "Maharashtra" },
  { short_code: "westline", name: "Westline Packaging", contact_name: "Hemant Shah", email: "hemant@westlinepack.example", city: "Ahmedabad", state: "Gujarat" },
  { short_code: "orientpack", name: "OrientPack Ltd", contact_name: null, email: "sales.in@orientpack.example", city: "Chennai", state: "Tamil Nadu", notes: "Malaysian parent" },
  { short_code: "anand", name: "Anand Box Works", contact_name: "Anand Kumar", email: "anand@anandboxworks.example", city: "Bengaluru", state: "Karnataka" },
];
const vendors = must(
  await db().from("vendors").upsert(VENDORS.map((v) => ({ ...v, created_by: "seed" })), { onConflict: "short_code" }).select("id, short_code"),
  "vendors",
);

// 3–4. RFx MER-0417 (issued, frozen v1), MER-0418 (draft, live run), MER-0419 (issued, seed pipeline run)
const RFX = [
  { code: "MER-0417", title: meta.title, issued: true },
  { code: "MER-0418", title: "Corrugated packaging — FY26-27 (live run)", issued: false },
  { code: "MER-0419", title: "Corrugated packaging — FY26-27 (seed run)", issued: true },
];
const header = {
  category: meta.category, currency: meta.currency, quote_unit: meta.quote_unit, incoterm: meta.incoterm,
  freight_included_requested: meta.freight_included_requested, payment_terms_days: meta.payment_terms_days,
  validity_days_requested: meta.validity_days_requested, contract_months: meta.contract_months,
  response_deadline: meta.response_deadline, delivery_locations: meta.delivery_locations, cover_note: meta.cover_note,
  buyer_id: buyerId,
};
const issuedAt = new Date(`${meta.issued_on}T10:00:00+05:30`).toISOString();

must(
  await db().from("rfx").upsert(
    RFX.map((r) => ({
      ...header, code: r.code, title: r.title,
      status: r.issued ? "issued" : "draft", version: r.issued ? 1 : 0, frozen_at: r.issued ? issuedAt : null,
    })),
    { onConflict: "code", ignoreDuplicates: true },
  ),
  "rfx",
);
const rfxRows = must(await db().from("rfx").select("id, code").in("code", RFX.map((r) => r.code)), "rfx select");

for (const r of RFX) {
  const rfxId = rfxRows.find((x) => x.code === r.code)!.id;
  must(
    await db().from("rfx_lines").upsert(
      lines.map((l) => ({
        rfx_id: rfxId, line_no: Number(l.line_no), sku: l.sku, description: l.description, ply: num(l.ply),
        length_mm: num(l.length_mm), width_mm: num(l.width_mm), height_mm: num(l.height_mm), gsm_spec: l.gsm_spec || null,
        burst_factor: num(l.burst_factor), item_type: l.item_type || null, weight_per_piece_g: num(l.weight_per_piece_g),
        monthly_qty: Number(l.monthly_qty), annual_qty: Number(l.annual_qty), delivery_location: l.delivery_location,
      })),
      { onConflict: "rfx_id,line_no" },
    ),
    `${r.code} lines`,
  );
  must(
    await db().from("rfx_questions").upsert(questions.map((q) => ({ rfx_id: rfxId, ...q })), { onConflict: "rfx_id,q_no" }),
    `${r.code} questions`,
  );
  must(
    await db().from("rfx_vendors").upsert(
      vendors.map((v) => ({
        rfx_id: rfxId, vendor_id: v.id, status: "invited",
        reply_tag: `rfx-${r.code.toLowerCase()}-${v.short_code}`, // TRD §15
        invited_at: r.issued ? issuedAt : null,
      })),
      { onConflict: "rfx_id,vendor_id", ignoreDuplicates: true },
    ),
    `${r.code} vendors`,
  );
  console.log(`[seed] ${r.code}: ${lines.length} lines, ${questions.length} questions, ${vendors.length} vendors`);
}

// 5. Settings defaults (TRD §6.19) — insert-if-missing so Settings-page edits survive a re-seed
const SETTINGS: Record<string, unknown> = {
  email_mode: "mock",
  decision_provider: "auto",
  thresholds: { act: 0.85, review: 0.6 },
  fx_rates: { USD: { rate: 83.15, date: "2026-09-23", source: "manual" } },
  landed_cost: { include_tax: false, cost_of_money_annual_pct: 0 },
  discount_default: "gross",
  freight_default_inr_per_1000: 180, // TRD §11.7
  vendor_addresses: {}, // shortCode → plus-alias, filled in Settings for gmail mode (P6)
};
must(
  await db().from("settings").upsert(Object.entries(SETTINGS).map(([key, value]) => ({ key, value })), { onConflict: "key", ignoreDuplicates: true }),
  "settings",
);

// Dataset pack → bucket `seed` (TRD §5: seed/…)
const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".txt": "text/plain",
  ".csv": "text/csv", ".json": "application/json", ".eml": "message/rfc822",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const files = (fs.readdirSync(SEED, { recursive: true }) as string[]).filter(
  (f) => fs.statSync(path.join(SEED, f)).isFile() && !f.endsWith(".py") && !path.basename(f).startsWith("."),
);
for (const f of files) {
  const res = await db().storage.from("seed").upload(`seed/${f}`, fs.readFileSync(path.join(SEED, f)), {
    contentType: MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream",
    upsert: true,
  });
  if (res.error) throw new Error(`upload ${f}: ${res.error.message}`);
}
console.log(`[seed] uploaded ${files.length} files to bucket seed`);
console.log("[seed] done");
