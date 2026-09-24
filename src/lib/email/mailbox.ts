import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { listComms, type Comm } from "@/lib/comms";
import { put } from "@/lib/storage";
import type { IncomingFile } from "@/lib/responses";
import { buildEml } from "./index";

// The vendor's side of the mock mailbox (DECISIONS "Mock mailbox design"): what we sent them, and their replies.

export type MailboxMessage = Comm & { mailbox_id: string; replied: boolean };

/** Every email we sent this vendor for this RFx (dispatch, clarifications), newest first — the portal's inbox. */
export async function vendorInbox(rfxId: string, vendorId: string): Promise<MailboxMessage[]> {
  const [{ data: box, error }, comms] = await Promise.all([
    db().from("mock_mailbox").select("id, message_id").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("direction", "to_vendor"),
    listComms(rfxId, { direction: "outbound", vendorId }),
  ]);
  if (error) throw error;
  const ids = (box ?? []).map((b) => b.message_id);
  const { data: replies } = ids.length ? await db().from("mock_mailbox").select("in_reply_to").eq("direction", "to_buyer").in("in_reply_to", ids) : { data: [] };
  const answered = new Set((replies ?? []).map((r) => r.in_reply_to));
  return comms.flatMap((c) => {
    const b = (box ?? []).find((x) => x.message_id === c.message_id);
    return b ? [{ ...c, mailbox_id: b.id, replied: answered.has(c.message_id) }] : [];
  }).reverse();
}

/**
 * The vendor hits Reply in their mailbox: a real RFC 822 reply To the tagged Reply-To of the email answered,
 * threaded with In-Reply-To / References, left unread for the buyer's Sync inbox. No response is created here.
 */
export async function replyAsVendor(o: { rfxId: string; vendorId: string; mailboxId: string; text: string | null; files: IncomingFile[] }) {
  if (!o.files.length && !o.text?.trim()) throw new AppError("EMPTY_RESPONSE", "Add at least one file or write the reply text.");
  const [{ data: orig }, { data: v }] = await Promise.all([
    db().from("mock_mailbox").select("id, message_id, subject").eq("id", o.mailboxId).eq("rfx_id", o.rfxId).eq("vendor_id", o.vendorId).eq("direction", "to_vendor").maybeSingle(),
    db().from("vendors").select("name, email").eq("id", o.vendorId).single(),
  ]);
  if (!orig || !v) throw new AppError("NOT_FOUND", "That email isn't in this vendor's mailbox.", undefined, 404);
  const { data: comm } = await db().from("communications").select("reply_to, from_addr, in_reply_to").eq("message_id", orig.message_id).single();
  const subject = /^re:/i.test(orig.subject ?? "") ? orig.subject! : `Re: ${orig.subject ?? ""}`;
  const to = comm?.reply_to || comm?.from_addr;
  if (!to) throw new AppError("NO_REPLY_TO", "The email being answered has no reply address.", undefined, 409);
  const from = `"${v.name.replaceAll('"', "")}" <${v.email}>`;
  const { eml, messageId } = await buildEml({
    from, to, subject, text: o.text?.trim() ?? "",
    attachments: o.files.map((f) => ({ filename: f.name, content: f.buf, contentType: f.mime })),
    in_reply_to: orig.message_id, references: [comm?.in_reply_to, orig.message_id].filter((x): x is string => !!x),
  });
  const id = randomUUID();
  const eml_path = await put("raw", `mock-mailbox/${id}.eml`, eml, "message/rfc822");
  const { error } = await db().from("mock_mailbox").insert({
    id, rfx_id: o.rfxId, direction: "to_buyer", from_addr: from, to_addr: to, subject, message_id: messageId, in_reply_to: orig.message_id, eml_path,
  });
  if (error) throw error;
  console.log(`[mailbox] ${v.name} replied to ${orig.message_id} → unread for the buyer (${messageId})`);
  return { mailbox_id: id, message_id: messageId };
}
