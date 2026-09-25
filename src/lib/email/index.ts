import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { get, put } from "@/lib/storage";
import { sendGmail } from "./gmail";

// TRD §15.1 common send path: the communications row is written (queued) before sending and updated after.
export type OutAttachment = { name: string; bucket: "outbound"; path: string; mime: string; size: number };
export type SendInput = {
  rfx_id: string; vendor_id: string | null; kind: "rfx_dispatch" | "clarification" | "award" | "regret" | "other";
  from: string; to: string; reply_to: string; subject: string; text: string; attachments: OutAttachment[];
  in_reply_to?: string | null; references?: string[];
};
export type EmlInput = {
  from: string; to: string; reply_to?: string; subject: string; text: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[]; in_reply_to?: string | null; references?: string[];
  message_id?: string; // keep an existing Message-ID when rebuilding a stored email (redraftDispatch)
};

/** Reply-To carries the tag that ties a reply to the RFx and vendor (TRD §15.1). Mock mailbox address — live Gmail is out of scope. */
export function replyToAddress(tag: string) {
  return `sourcing+${tag}@meridianfoods.example`;
}

// streamTransport + buffer builds the complete RFC 822 message (headers, MIME parts, Message-ID) without sending it.
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });

/** The email exactly as SMTP would carry it; the Message-ID is generated here (`<uuid@sender-domain>`). */
export async function buildEml(m: EmlInput): Promise<{ eml: Buffer; messageId: string }> {
  const info = await composer.sendMail({
    from: m.from, to: m.to, replyTo: m.reply_to, subject: m.subject, text: m.text, attachments: m.attachments, messageId: m.message_id,
    ...(m.in_reply_to ? { inReplyTo: m.in_reply_to, references: m.references?.length ? m.references : [m.in_reply_to] } : {}),
  });
  return { eml: info.message as Buffer, messageId: info.messageId };
}

export async function sendEmail(m: SendInput) {
  const mode = await getSetting("email_mode");
  const row = await db().from("communications").insert({
    rfx_id: m.rfx_id, vendor_id: m.vendor_id, direction: "outbound", kind: m.kind, mode,
    from_addr: m.from, to_addr: m.to, reply_to: m.reply_to, subject: m.subject, body_text: m.text, in_reply_to: m.in_reply_to ?? null,
    attachments: m.attachments, status: "queued",
  }).select("id").single();
  if (row.error) throw row.error;
  const id = row.data.id as string;
  try {
    const files = await Promise.all(m.attachments.map(async (a) => ({ filename: a.name, content: await get(a.bucket, a.path), contentType: a.mime })));
    const { eml, messageId } = await buildEml({ ...m, attachments: files });
    if (mode !== "mock") await sendGmail({ eml, from: m.from, to: m.to }); // throws NOT_CONFIGURED (501): never a silent no-op
    // Mock mode: nothing leaves the system. The message is stored and delivered to the vendor's mock mailbox (portal).
    const eml_path = await put("outbound", `rfx/${m.rfx_id}/outbound/mail/${id}.eml`, eml, "message/rfc822");
    const box = await db().from("mock_mailbox").insert({
      rfx_id: m.rfx_id, vendor_id: m.vendor_id, direction: "to_vendor", from_addr: m.from, to_addr: m.to, subject: m.subject,
      message_id: messageId, in_reply_to: m.in_reply_to ?? null, eml_path,
    });
    if (box.error) throw box.error;
    const upd = await db().from("communications").update({ status: "sent", sent_at: new Date().toISOString(), message_id: messageId, eml_path }).eq("id", id);
    if (upd.error) throw upd.error;
    return { id, status: "sent" as const, message_id: messageId };
  } catch (e) {
    await db().from("communications").update({ status: "failed", error: (e as Error).message.slice(0, 1000) }).eq("id", id);
    throw e instanceof AppError ? e : new AppError("SEND_FAILED", (e as Error).message, undefined, 500);
  }
}
