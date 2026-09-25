import "server-only";
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { listComms, type Comm } from "@/lib/comms";
import { get, put } from "@/lib/storage";
import type { IncomingFile } from "@/lib/responses";
import { buildEml } from "./index";

// The vendor's side of the mock mailbox (DECISIONS "Mock mailbox design"): what we sent them, and their replies.

export type VendorReply = Pick<Comm, "from" | "to" | "subject" | "body" | "attachments"> & { id: string; at: string; seen: boolean };
export type MailboxMessage = Comm & { mailbox_id: string; replies: VendorReply[] };

/** Every email we sent this vendor for this RFx (dispatch, clarifications), newest first, each with the vendor's replies to it — the portal's inbox. */
export async function vendorInbox(rfxId: string, vendorId: string): Promise<MailboxMessage[]> {
  const [{ data: box, error }, comms, received] = await Promise.all([
    db().from("mock_mailbox").select("id, message_id").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("direction", "to_vendor"),
    listComms(rfxId, { direction: "outbound", vendorId }),
    listComms(rfxId, { direction: "inbound", vendorId }),
  ]);
  if (error) throw error;
  const ids = (box ?? []).map((b) => b.message_id);
  const { data: rows } = ids.length
    ? await db().from("mock_mailbox").select("id, message_id, in_reply_to, from_addr, to_addr, subject, eml_path, seen, created_at").eq("direction", "to_buyer").in("in_reply_to", ids).order("created_at")
    : { data: [] };
  // Synced replies come from `communications` (attachments downloadable); unsynced ones are read from their .eml (names only).
  const replies = await Promise.all((rows ?? []).map(async (r): Promise<VendorReply & { in_reply_to: string }> => {
    const c = received.find((x) => x.message_id === r.message_id);
    const base = { id: r.id, at: r.created_at, seen: r.seen, in_reply_to: r.in_reply_to!, from: r.from_addr, to: r.to_addr, subject: r.subject };
    if (c) return { ...base, body: c.body, attachments: c.attachments };
    const m = await simpleParser(await get("raw", r.eml_path));
    return { ...base, body: m.text?.trim() || null, attachments: m.attachments.map((a) => ({ name: a.filename ?? "attachment", url: null })) };
  }));
  return comms.flatMap((c) => {
    const b = (box ?? []).find((x) => x.message_id === c.message_id);
    return b ? [{ ...c, mailbox_id: b.id, replies: replies.filter((r) => r.in_reply_to === c.message_id) }] : [];
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
