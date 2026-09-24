import "server-only";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { longDate } from "@/lib/format";
import { put } from "@/lib/storage";
import { assertDraft, getDraft } from "@/lib/rfx-draft";
import { replyToAddress, sendEmail, type OutAttachment } from "@/lib/email";
import { lineSheetXlsx, questionnairePdf } from "@/lib/dispatch-docs";

export const REPLY_SENTENCE = "Please reply to this email with your quotation in any format convenient to you — we will process it as sent.";

// TRD §9.3 P-DISPATCH, verbatim.
const P_DISPATCH = `Write a professional RFx cover email from {buyer_name}, {buyer_title}, Meridian Foods Pvt Ltd to {vendor_name}.
Include: RFx code {code}, title, one-paragraph scope ({cover_note}), commercial terms (currency, quoting unit, incoterm, freight, payment terms, validity requested, contract duration, delivery locations), response deadline {deadline}, a note that the line-item sheet (Excel) and supplier questionnaire (PDF) are attached, and this exact sentence: "Please reply to this email with your quotation in any format convenient to you — we will process it as sent."
Sign off with buyer name and email. Plain text, no markdown. Under 220 words.
Return ONLY JSON: {"subject": string, "body_text": string}`;

const Dispatch = z.object({
  subject: z.string().min(5).max(200),
  body_text: z.string().min(50).refine((t) => t.includes(REPLY_SENTENCE), { message: `body_text must contain this exact sentence: "${REPLY_SENTENCE}"` }),
});

// The users table has no job title; DESIGN §3.9 signs the memo "Sujit Menon, Category Buyer".
const TITLE: Record<string, string> = { buyer: "Category Buyer", admin: "Category Buyer", approver: "VP Procurement" };
const UNIT: Record<string, string> = { per_1000_pcs: "per 1000 pieces", per_piece: "per piece", per_kg: "per kg", per_box: "per box" };

export function issueBlockers(d: Awaited<ReturnType<typeof getDraft>>) {
  return [
    !d.lines.length && "line items", !d.rfx.terms_set && "commercial terms", !d.rfx.response_deadline && "a response deadline",
    !d.questions.length && "a questionnaire", !d.vendors.length && "vendors",
  ].filter((x): x is string => !!x);
}

/** TRD §16 POST /api/rfx/{id}/issue (+ §15.1–15.2): freeze v1, build the attachments, one dispatch email per vendor. */
export async function issueRfx(rfxId: string, user: { id: string; name: string; email: string; role: string }) {
  await assertDraft(rfxId);
  const d = await getDraft(rfxId);
  const blockers = issueBlockers(d);
  if (blockers.length) throw new AppError("NOT_READY", `Add ${blockers.join(", ")} before issuing.`, { blockers }, 409);
  const r = d.rfx;

  // Attachments first: if they can't be built, nothing is frozen.
  const [xlsx, pdf] = await Promise.all([lineSheetXlsx(d), questionnairePdf(d, user)]);
  const atts: OutAttachment[] = [
    { name: `${r.code}_Line_Sheet.xlsx`, bucket: "outbound", path: `rfx/${rfxId}/outbound/${r.code}_Line_Sheet.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: xlsx.length },
    { name: `${r.code}_Supplier_Questionnaire.pdf`, bucket: "outbound", path: `rfx/${rfxId}/outbound/${r.code}_Supplier_Questionnaire.pdf`, mime: "application/pdf", size: pdf.length },
  ];
  await put("outbound", atts[0].path, xlsx, atts[0].mime);
  await put("outbound", atts[1].path, pdf, atts[1].mime);

  // Freeze v1 (TRD §6.3: version 1 = frozen); the status guard makes a double click a no-op instead of a second dispatch.
  const now = new Date().toISOString();
  const fr = await db().from("rfx").update({ version: 1, frozen_at: now, status: "issued", updated_at: now }).eq("id", rfxId).eq("status", "draft").select("id");
  if (fr.error) throw fr.error;
  if (!fr.data?.length) throw new AppError("FROZEN", `${r.code} was issued already.`, undefined, 409);
  await audit({ rfx_id: rfxId, actor: user.id, event: "rfx.frozen", entity_type: "rfx", entity_id: rfxId, payload: { version: 1, lines: d.lines.length, questions: d.questions.length, vendors: d.vendors.length } });

  const { data: inv } = await db().from("rfx_vendors").select("vendor_id, reply_tag").eq("rfx_id", rfxId);
  const terms = `currency ${r.currency}; quoting unit ${UNIT[r.quote_unit] ?? r.quote_unit}; incoterm ${r.incoterm}; freight ${r.freight_included_requested ? "included" : "excluded"}; payment ${r.payment_terms_days} days; validity requested ${r.validity_days_requested} days; contract ${r.contract_months} months; delivery to ${r.delivery_locations.join(" and ")}`;
  const results = await Promise.all(d.vendors.map(async (v) => {
    const tag = inv?.find((i) => i.vendor_id === v.vendor_id)?.reply_tag ?? `rfx-${r.code.toLowerCase()}-${v.short_code}`;
    try {
      const prompt = P_DISPATCH.replace("{buyer_name}", user.name).replace("{buyer_title}", TITLE[user.role] ?? "Buyer").replace("{vendor_name}", v.name)
        .replace("{code}", r.code).replace("{cover_note}", r.cover_note ?? r.title).replace("{deadline}", longDate(r.response_deadline!));
      const mail = await generateJSON({ tier: "fast", purpose: "dispatch", rfx_id: rfxId, schema: Dispatch, temperature: 0.7,
        parts: [{ text: prompt }, { text: `Details — title: ${r.title}; terms: ${terms}; buyer email: ${user.email}.` }] });
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
