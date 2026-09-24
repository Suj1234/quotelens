import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";

// TRD §15.1 common send path: the communications row is written (queued) before sending and updated after.
export type OutAttachment = { name: string; bucket: "outbound"; path: string; mime: string; size: number };
export type SendInput = {
  rfx_id: string; vendor_id: string | null; kind: "rfx_dispatch" | "clarification" | "award" | "regret" | "other";
  from: string; to: string; reply_to: string; subject: string; text: string; attachments: OutAttachment[];
};

/** Reply-To carries the tag that ties a reply to the RFx and vendor (TRD §15.1); gmail mode uses the sender's plus-address. */
export function replyToAddress(tag: string) {
  const user = process.env.GMAIL_USER || ""; // empty in mock setups
  return user ? `${user.split("@")[0]}+${tag}@${user.split("@")[1] ?? "gmail.com"}` : `sourcing+${tag}@meridianfoods.example`;
}

export async function sendEmail(m: SendInput) {
  const mode = await getSetting("email_mode");
  const row = await db().from("communications").insert({
    rfx_id: m.rfx_id, vendor_id: m.vendor_id, direction: "outbound", kind: m.kind, mode,
    from_addr: m.from, to_addr: m.to, reply_to: m.reply_to, subject: m.subject, body_text: m.text,
    attachments: m.attachments, status: "queued",
  }).select("id").single();
  if (row.error) throw row.error;
  const id = row.data.id as string;
  try {
    if (mode !== "mock") throw new AppError("NOT_CONFIGURED", `Email mode "${mode}" sends arrive with Gmail mode (P6); switch Settings to mock.`, undefined, 501);
    // TRD §15.2 mock mode: nothing leaves the system; the Outbox and the vendor portal show the email.
    const upd = await db().from("communications").update({ status: "sent", sent_at: new Date().toISOString(), message_id: `<mock-${randomUUID()}@quotelens.local>` }).eq("id", id);
    if (upd.error) throw upd.error;
    return { id, status: "sent" as const };
  } catch (e) {
    await db().from("communications").update({ status: "failed", error: (e as Error).message.slice(0, 1000) }).eq("id", id);
    throw e;
  }
}
