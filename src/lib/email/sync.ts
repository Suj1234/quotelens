import "server-only";
import { simpleParser, type AddressObject } from "mailparser";
import { db } from "@/lib/db";
import { audit } from "@/lib/log";
import { getSetting } from "@/lib/settings";
import { get, put } from "@/lib/storage";
import { createResponse } from "@/lib/responses";
import { clarificationContext } from "@/lib/clarify";
import { syncGmail } from "./gmail";
import { parseTag } from "./tag";

// TRD §15.3 receive half, against the mock mailbox (live Gmail out of scope): unread → parse → match by tag
// (To, then Subject, then In-Reply-To) → idempotent on Message-ID → raw .eml + attachments → response → seen.

export type SyncResult = {
  new_responses: { response_id: string; vendor: string | null; clarification: boolean }[];
  new_response_ids: string[];
  skipped: { message_id: string; reason: string }[];
  ignored: { message_id: string; subject: string | null; reason: string }[];
};
type Known = { rfx_id: string; vendor_id: string; reply_tag: string; vendor: string };

const addrText = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a : a ? [a] : []).map((x) => x.text).join(", ");

export async function syncInbox(rfxId: string, actor: string): Promise<SyncResult> {
  if ((await getSetting("email_mode")) !== "mock") await syncGmail(rfxId); // throws NOT_CONFIGURED (501)
  const [{ data: unread, error }, { data: tags }, { data: rfxs }] = await Promise.all([
    db().from("mock_mailbox").select("id, message_id, eml_path").eq("direction", "to_buyer").eq("seen", false).order("created_at"),
    db().from("rfx_vendors").select("rfx_id, vendor_id, reply_tag, vendors(name)"),
    db().from("rfx").select("id, code"),
  ]);
  if (error) throw error;
  const known: Known[] = (tags ?? []).map((t) => ({ rfx_id: t.rfx_id, vendor_id: t.vendor_id, reply_tag: t.reply_tag, vendor: (t.vendors as unknown as { name: string }).name }));
  const code = (rfxs ?? []).find((r) => r.id === rfxId)?.code ?? "";
  const out: SyncResult = { new_responses: [], new_response_ids: [], skipped: [], ignored: [] };

  for (const row of unread ?? []) {
    const eml = await get("raw", row.eml_path);
    const m = await simpleParser(eml);
    const messageId = m.messageId ?? row.message_id;
    const seen = () => db().from("mock_mailbox").update({ seen: true }).eq("id", row.id);

    // Idempotency: a message we already turned into a response is skipped (re-delivered or re-synced).
    const { data: dup } = await db().from("communications").select("id").eq("message_id", messageId).maybeSingle();
    if (dup) { await seen(); out.skipped.push({ message_id: messageId, reason: "already received" }); continue; }

    // Tag: To first (the reply goes to the tagged Reply-To), then the subject, then the email it answers.
    const tagList = known.map((k) => k.reply_tag);
    const inReplyTo = typeof m.inReplyTo === "string" ? m.inReplyTo : null;
    const answered = inReplyTo ? (await db().from("communications").select("rfx_id, vendor_id, reply_to").eq("message_id", inReplyTo).maybeSingle()).data : null;
    const tag = parseTag(addrText(m.to), tagList) ?? parseTag(m.subject, tagList) ?? parseTag(answered?.reply_to, tagList);
    const k = tag ? known.find((x) => x.reply_tag === tag.reply_tag)! : null;
    const mentions = (c: string) => !!c && (m.subject ?? "").toLowerCase().includes(c.toLowerCase());

    if (k && k.rfx_id !== rfxId) continue; // another RFx's reply: left unread for that RFx's sync
    if (!k) {
      const ours = answered?.rfx_id === rfxId || mentions(code);
      const theirs = (answered && answered.rfx_id !== rfxId) || (rfxs ?? []).some((r) => r.id !== rfxId && mentions(r.code));
      if (!ours && theirs) continue;
      if (!ours) { // TRD §15.3: not a reply to anything we sent and no RFx in the subject → ignored
        await seen();
        out.ignored.push({ message_id: messageId, subject: m.subject ?? null, reason: "no reply tag, not a reply to our email, no RFx code in the subject" });
        continue;
      }
    }

    const clar = k && tag?.clar_n ? await clarificationContext(rfxId, k.vendor_id, tag.clar_n) : null;
    let responseId: string;
    try {
      responseId = await createResponse({
        rfxId, vendorId: k?.vendor_id ?? null, source: "portal", actor, emailText: m.text ?? null,
        files: m.attachments.map((a) => ({ name: a.filename ?? "attachment", mime: a.contentType, buf: a.content })),
        subject: m.subject, fromAddr: addrText(m.from) || undefined, toAddr: addrText(m.to) || null, messageId, inReplyTo,
        ...(clar ? { clarification: clar } : {}),
      });
    } catch (e) {
      // Two syncs at once: the unique Message-ID index lets only one through (TRD §15.3 "on conflict skip").
      if ((e as { code?: string }).code === "23505") { out.skipped.push({ message_id: messageId, reason: "received by another sync" }); continue; }
      throw e;
    }
    const path = await put("raw", `rfx/${rfxId}/responses/${responseId}/message.eml`, eml, "message/rfc822");
    await db().from("communications").update({ eml_path: path }).eq("message_id", messageId);
    await seen();
    out.new_responses.push({ response_id: responseId, vendor: k?.vendor ?? null, clarification: !!clar });
    out.new_response_ids.push(responseId);
  }
  if (out.new_response_ids.length || out.ignored.length || out.skipped.length) {
    await audit({ rfx_id: rfxId, actor, event: "email.synced", entity_type: "rfx", entity_id: rfxId, payload: { new: out.new_response_ids.length, skipped: out.skipped.length, ignored: out.ignored.length } });
  }
  console.log(`[email:sync] ${code}: ${out.new_response_ids.length} new, ${out.skipped.length} skipped, ${out.ignored.length} ignored`);
  return out;
}

/** Unread replies waiting for this RFx, by vendor (for "Sync inbox — Westline replied"); reads headers already on the row. */
export async function pendingReplies(rfxId: string) {
  const [{ data: unread }, { data: tags }] = await Promise.all([
    db().from("mock_mailbox").select("to_addr, subject").eq("direction", "to_buyer").eq("seen", false),
    db().from("rfx_vendors").select("reply_tag, vendors(name)").eq("rfx_id", rfxId),
  ]);
  const list = (tags ?? []).map((t) => t.reply_tag);
  const by = new Map<string, { vendor: string; count: number; clarification: boolean }>();
  for (const u of unread ?? []) {
    const t = parseTag(u.to_addr, list) ?? parseTag(u.subject, list);
    if (!t) continue;
    const name = ((tags ?? []).find((x) => x.reply_tag === t.reply_tag)?.vendors as unknown as { name: string }).name;
    const e = by.get(name) ?? { vendor: name, count: 0, clarification: false };
    by.set(name, { ...e, count: e.count + 1, clarification: e.clarification || t.clar_n !== null });
  }
  return { total: [...by.values()].reduce((a, b) => a + b.count, 0), by_vendor: [...by.values()] };
}
