import "server-only";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { longDate } from "@/lib/format";
import { get, put } from "@/lib/storage";
import { issueBlockers, NO_RULES } from "@/lib/line-rules";
import { assertDraft, getDraft, type Draft } from "@/lib/rfx-draft";
import { getSetting } from "@/lib/settings";
import { buildEml, replyToAddress, sendEmail, type OutAttachment } from "@/lib/email";
import { quoteFormXlsx } from "@/lib/dispatch-docs";

export const REPLY_SENTENCE = "Please reply to this email with your quotation in any format convenient to you — we will process it as sent.";

// TRD §9.3 P-DISPATCH, verbatim except the attachment note and the layout line (DECISIONS 2026-09-25; v1 in prompts/archive).
const P_DISPATCH = `Write a professional RFx cover email from {buyer_name}, {buyer_title}, Meridian Foods Pvt Ltd to {vendor_name}.
Include: RFx code {code}, title, one-paragraph scope ({cover_note}), commercial terms (currency, quoting unit, incoterm, freight, payment terms, validity requested, contract duration, delivery locations), response deadline {deadline}, a note that one Excel quote form is attached, with the line items on its first tab and the supplier questionnaire on its "Questionnaire" tab, and this exact sentence: "Please reply to this email with your quotation in any format convenient to you — we will process it as sent."
Sign off with buyer name and email. Plain text, no markdown. Under 220 words.
Lay it out like a real business email, with a blank line between blocks: greeting ("Dear {vendor_name} team,") on its own line; one short intro paragraph (RFx code and title); the scope paragraph; the line "Commercial terms:" followed by one term per line as "- Label: value"; the attachment note; the reply sentence; the deadline; then the sign-off on separate lines ("Best regards," / name / title / email).
Return ONLY JSON: {"subject": string, "body_text": string}`;

const Dispatch = z.object({
  subject: z.string().min(5).max(200),
  body_text: z.string().min(50).refine((t) => t.includes(REPLY_SENTENCE), { message: `body_text must contain this exact sentence: "${REPLY_SENTENCE}"` })
    .refine((t) => t.split(/\n\s*\n/).length >= 5 && /^- /m.test(t), { message: "body_text must be laid out in blocks separated by blank lines, with the commercial terms one per line starting \"- \"" }),
});

// The users table has no job title; DESIGN §3.9 signs the memo "Sujit Menon, Category Buyer".
const TITLE: Record<string, string> = { buyer: "Category Buyer", admin: "Category Buyer", approver: "VP Procurement" };
const UNIT: Record<string, string> = { per_1000_pcs: "Per 1000 pieces", per_piece: "Per piece", per_kg: "Per kg", per_box: "Per box" };
const INCO: Record<string, string> = { delivered: "Delivered to plant", ex_works: "Ex-works", fob: "FOB" };

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const quoteFormName = (code: string) => `${code}_Quote_Form.xlsx`;

type Buyer = { id: string; name: string; email: string; role: string };

/** P-DISPATCH for one vendor: the cover email's subject and body. */
function draftDispatch(r: Draft["rfx"], vendorName: string, user: Buyer) {
  // Values written as they should read in the email (capitalised; the model copies them).
  const terms = `Currency: ${r.currency}; Quoting unit: ${UNIT[r.quote_unit] ?? r.quote_unit}; Incoterm: ${INCO[r.incoterm] ?? r.incoterm}; Freight: ${r.freight_included_requested ? "Included in the price" : "Excluded — state it separately"}; GST: ${r.tax_basis === "incl_gst" ? "Included in the prices" : "Excluded from the prices — state the GST rate separately"}; Payment terms: ${r.payment_terms_days} days; Validity requested: ${r.validity_days_requested} days; Contract duration: ${r.contract_months} months; Delivery locations: ${r.delivery_locations.join(" and ")}`;
  const prompt = P_DISPATCH.replace("{buyer_name}", user.name).replace("{buyer_title}", TITLE[user.role] ?? "Buyer").replaceAll("{vendor_name}", vendorName)
    .replace("{code}", r.code).replace("{cover_note}", r.cover_note ?? r.title).replace("{deadline}", longDate(r.response_deadline!));
  return generateJSON({ tier: "fast", purpose: "dispatch", rfx_id: r.id, schema: Dispatch, temperature: 0.7,
    parts: [{ text: prompt }, { text: `Details — title: ${r.title}; terms (copy each value as written): ${terms}; buyer email: ${user.email}.` }] });
}

/** P9 N1: one vendor's cover email as issuing would write it now — same prompt and details; nothing stored or sent. */
export async function previewDispatch(rfxId: string, vendorId: string, user: Buyer) {
  await assertDraft(rfxId);
  const d = await getDraft(rfxId);
  const v = d.vendors.find((x) => x.vendor_id === vendorId);
  if (!v) throw new AppError("NOT_FOUND", "That vendor isn't on this RFx.", undefined, 404);
  if (!d.rfx.response_deadline) throw new AppError("NOT_READY", "Set the response deadline first — the email states it.", undefined, 409);
  const mail = await draftDispatch(d.rfx, v.name, user);
  return { to: v.email, from: `${user.name} (Meridian Foods) <${user.email}>`, subject: mail.subject, body: mail.body_text, attachment: quoteFormName(d.rfx.code) };
}

/**
 * Mock mode only: rewrite the body of RFx emails already "sent" (they never left the system) with the current P-DISPATCH.
 * Keeps each email's Message-ID, subject, recipients and attachment, so replies and threading still line up;
 * rewrites communications.body_text and the stored .eml. Gmail-sent emails are skipped — those can't be unsent.
 */
export async function redraftDispatch(rfxId: string, user: Buyer) {
  const d = await getDraft(rfxId);
  const { data: comms, error } = await db().from("communications").select("id, vendor_id, mode, from_addr, to_addr, reply_to, subject, message_id, attachments, eml_path, body_text")
    .eq("rfx_id", rfxId).eq("kind", "rfx_dispatch").eq("direction", "outbound").eq("status", "sent");
  if (error) throw error;
  const out: { vendor: string; ok: boolean; note?: string }[] = [];
  for (const c of comms ?? []) {
    const v = d.vendors.find((x) => x.vendor_id === c.vendor_id);
    const name = v?.name ?? c.to_addr;
    if (c.mode !== "mock") { out.push({ vendor: name, ok: false, note: `sent by ${c.mode}, left as sent` }); continue; }
    const mail = await draftDispatch(d.rfx, v?.name ?? "Supplier", user);
    const atts = c.attachments as OutAttachment[];
    const files = await Promise.all(atts.map(async (a) => ({ filename: a.name, content: await get(a.bucket, a.path), contentType: a.mime })));
    const { eml } = await buildEml({ from: c.from_addr, to: c.to_addr, reply_to: c.reply_to, subject: c.subject, text: mail.body_text, attachments: files, message_id: c.message_id });
    await put("outbound", c.eml_path, eml, "message/rfc822");
    const upd = await db().from("communications").update({ body_text: mail.body_text }).eq("id", c.id);
    if (upd.error) throw upd.error;
    await audit({ rfx_id: rfxId, actor: user.id, event: "dispatch.redrafted", entity_type: "communication", entity_id: c.id, payload: { vendor: name, message_id: c.message_id, previous_body: c.body_text } });
    out.push({ vendor: name, ok: true });
  }
  return out;
}

/** TRD §16 POST /api/rfx/{id}/issue (+ §15.1–15.2): freeze v1, build the attachments, one dispatch email per vendor. */
export async function issueRfx(rfxId: string, user: Buyer) {
  await assertDraft(rfxId);
  const d = await getDraft(rfxId);
  const template = (await getSetting("category_templates"))[d.rfx.category]; // P9: the category template's required line fields block Issue too
  const blockers = issueBlockers(d, template?.line_rules ?? NO_RULES);
  if (blockers.length) throw new AppError("NOT_READY", `Add ${blockers.join(", ")} before issuing.`, { blockers }, 409);
  const r = d.rfx;

  // Attachments first: if they can't be built, nothing is frozen.
  const xlsx = await quoteFormXlsx(d);
  const name = quoteFormName(r.code);
  const atts: OutAttachment[] = [
    { name, bucket: "outbound", path: `rfx/${rfxId}/outbound/${name}`, mime: XLSX_MIME, size: xlsx.length },
  ];
  await put("outbound", atts[0].path, xlsx, atts[0].mime);

  // Freeze v1 (TRD §6.3: version 1 = frozen); the status guard makes a double click a no-op instead of a second dispatch.
  const now = new Date().toISOString();
  const fr = await db().from("rfx").update({ version: 1, frozen_at: now, status: "issued", updated_at: now }).eq("id", rfxId).eq("status", "draft").select("id");
  if (fr.error) throw fr.error;
  if (!fr.data?.length) throw new AppError("FROZEN", `${r.code} was issued already.`, undefined, 409);
  await audit({ rfx_id: rfxId, actor: user.id, event: "rfx.frozen", entity_type: "rfx", entity_id: rfxId, payload: { version: 1, lines: d.lines.length, questions: d.questions.length, vendors: d.vendors.length } });

  const { data: inv } = await db().from("rfx_vendors").select("vendor_id, reply_tag").eq("rfx_id", rfxId);
  const results = await Promise.all(d.vendors.map(async (v) => {
    const tag = inv?.find((i) => i.vendor_id === v.vendor_id)?.reply_tag ?? `rfx-${r.code.toLowerCase()}-${v.short_code}`;
    try {
      const mail = await draftDispatch(r, v.name, user);
      const sent = await sendEmail({
        rfx_id: rfxId, vendor_id: v.vendor_id, kind: "rfx_dispatch",
        from: `"${user.name} (Meridian Foods)" <${user.email}>`, to: v.email, reply_to: replyToAddress(tag),
        subject: mail.subject, text: mail.body_text, attachments: atts,
      });
      await db().from("rfx_vendors").update({ invited_at: new Date().toISOString(), status: "invited" }).eq("rfx_id", rfxId).eq("vendor_id", v.vendor_id);
      await audit({ rfx_id: rfxId, actor: user.id, event: "dispatch.sent", entity_type: "communication", entity_id: sent.id, payload: { vendor: v.name, to: v.email, reply_tag: tag, mode: "mock", message_id: sent.message_id } });
      return { vendor: v.name, ok: true };
    } catch (e) {
      console.error(`[dispatch] ${v.name}: ${(e as Error).message}`);
      await audit({ rfx_id: rfxId, actor: user.id, event: "dispatch.failed", entity_type: "rfx", entity_id: rfxId, payload: { vendor: v.name, error: (e as Error).message } });
      return { vendor: v.name, ok: false, error: (e as Error).message };
    }
  }));
  return { sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok) };
}
