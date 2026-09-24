import "server-only";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { replyToAddress, sendEmail } from "@/lib/email";
import type { SessionUser } from "@/lib/auth";
import type { ResponseRow } from "@/types/db";

// TRD §8.7 / §9.6 / §12.3 — the clarification loop.

/** Cards a vendor can be asked about (DESIGN §3.6: ambiguous units, low reads, prior pricing, questionnaire). */
export const ASKABLE = ["ambiguous_unit", "low_confidence_read", "prior_pricing", "questionnaire_ambiguous", "questionnaire_missing"];

// TRD §9.6 P-CLARIFY, verbatim.
const P_CLARIFY = `Draft a short, polite clarification email from {buyer_name} (Meridian Foods) to {vendor_name} regarding RFx {code}.
We need explicit answers for the following, listed as bullet points the supplier can reply against:
{items}
Ask them to reply to this email. Keep under 150 words. Plain text.
Return ONLY JSON: {"subject": string, "body_text": string}`;

// Format note sent with P-CLARIFY (v1 had none and the fast model ran the bullets into one paragraph; DECISIONS P6-T3).
const CLARIFY_FORMAT = "Format body_text with line breaks (\\n): the greeting on its own line, a blank line, one bullet per line starting with \"- \" (keep each bullet's item number and wording), a blank line, the request to reply, then the sign-off on separate lines.";

/** The vendor's main reply: the non-clarification response that supplied most of its cells (as the grid header uses). */
export async function mainResponse(rfxId: string, vendorId: string): Promise<string | null> {
  const [{ data: resp }, { data: cells }] = await Promise.all([
    db().from("responses").select("id, received_at").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("is_clarification", false).order("received_at", { ascending: false }),
    db().from("line_quotes").select("response_id").eq("rfx_id", rfxId).eq("vendor_id", vendorId),
  ]);
  const count = (id: string) => (cells ?? []).filter((c) => c.response_id === id).length;
  return [...(resp ?? [])].sort((a, b) => count(b.id) - count(a.id))[0]?.id ?? null;
}

const sentClarifications = (rfxId: string, vendorId: string) => db().from("communications").select("id, reply_to, message_id, sent_at, subject")
  .eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("direction", "outbound").eq("kind", "clarification").eq("status", "sent").order("created_at");

/** Which clarification email a reply answers (`-clar-n`, else the latest), and the reply it corrects. */
export async function clarificationContext(rfxId: string, vendorId: string, n: number | null) {
  const { data: reqs } = await sentClarifications(rfxId, vendorId);
  const req = (n ? (reqs ?? []).find((r) => r.reply_to?.includes(`-clar-${n}@`)) : undefined) ?? (reqs ?? []).at(-1) ?? null;
  const num = n ?? (req ? Number(req.reply_to?.match(/-clar-(\d+)@/)?.[1] ?? 0) || null : null);
  return { request_id: req?.id ?? null, n: num, supersedes: await mainResponse(rfxId, vendorId) };
}

/** Clarifications still waiting for a reply, per vendor (for "This answers the clarification sent <date>"). */
export async function outstandingClarifications(rfxId: string) {
  const [{ data: rv }, { data: reqs }] = await Promise.all([
    db().from("rfx_vendors").select("vendor_id, status").eq("rfx_id", rfxId).eq("status", "clarification_sent"),
    db().from("communications").select("id, vendor_id, sent_at").eq("rfx_id", rfxId).eq("direction", "outbound").eq("kind", "clarification").eq("status", "sent").order("created_at"),
  ]);
  return new Map((rv ?? []).flatMap((v) => {
    const last = (reqs ?? []).filter((r) => r.vendor_id === v.vendor_id).at(-1);
    return last ? [[v.vendor_id as string, { request_id: last.id as string, sent_at: last.sent_at as string }]] : [];
  }));
}

type Item = { id: string; type: string; title: string; detail: string | null; status: string; rfx_line_id: string | null; question_id: string | null; evidence: Record<string, unknown> };

async function loadItems(rfxId: string, vendorId: string, ids: string[]) {
  if (!ids.length) throw new AppError("BAD_INPUT", "Pick at least one item to ask about.", undefined, 400);
  const { data, error } = await db().from("review_items").select("id, type, title, detail, status, rfx_line_id, question_id, evidence").in("id", ids).eq("rfx_id", rfxId).eq("vendor_id", vendorId);
  if (error) throw error;
  const items = (data ?? []) as Item[];
  if (items.length !== ids.length) throw new AppError("BAD_INPUT", "Some items aren't this vendor's cards on this RFx.", undefined, 400);
  const bad = items.find((i) => i.status !== "open" || !ASKABLE.includes(i.type));
  if (bad) throw new AppError("BAD_INPUT", `“${bad.title}” can't be asked about (${bad.status === "open" ? bad.type.replaceAll("_", " ") : bad.status.replaceAll("_", " ")}).`, undefined, 409);
  return items;
}

/** One bullet per card, naming the line and exactly what is missing (TRD §9.6 {items}). */
async function bullets(rfxId: string, vendorId: string, items: Item[]) {
  const [{ data: lines }, { data: qs }, { data: cells }] = await Promise.all([
    db().from("rfx_lines").select("id, line_no, description, ply, length_mm, width_mm, height_mm").eq("rfx_id", rfxId),
    db().from("rfx_questions").select("id, q_no, text").eq("rfx_id", rfxId),
    db().from("line_quotes").select("rfx_line_id, original_unit").eq("rfx_id", rfxId).eq("vendor_id", vendorId),
  ]);
  const spec = (id: string | null) => {
    const l = (lines ?? []).find((x) => x.id === id);
    if (!l) return null;
    const dims = l.length_mm && l.width_mm && l.height_mm ? `${l.length_mm}x${l.width_mm}x${l.height_mm}` : l.description;
    return { no: l.line_no as number, label: `Item ${l.line_no} (${dims}${l.ply ? `, ${l.ply}-ply` : ""})` };
  };
  const out = items.map((i) => {
    const s = spec(i.rfx_line_id);
    const unit = `${(cells ?? []).find((c) => c.rfx_line_id === i.rfx_line_id)?.original_unit ?? ""} ${i.type === "ambiguous_unit" ? i.detail ?? "" : ""}`;
    const pack = /bundle/i.test(unit) ? "bundle" : /box/i.test(unit) ? "box" : null;
    const q = (qs ?? []).find((x) => x.id === i.question_id);
    switch (i.type) {
      case "ambiguous_unit":
        return { id: i.id, ref: s?.no ?? null, text: pack ? `${s?.label}: priced per ${pack} but the ${pack} size is not stated — please state the number of pieces per ${pack}.` : `${s?.label}: ${i.detail ?? "the unit is unclear"} — please state the price in INR per 1000 pieces.` };
      case "low_confidence_read":
        return { id: i.id, ref: s?.no ?? null, text: `${s?.label}: we could not read the price clearly — please confirm the price in INR per 1000 pieces.` };
      case "prior_pricing": {
        const nos = ((i.evidence.lines as number[] | undefined) ?? []);
        const phrase = i.title.match(/“([^”]+)”/)?.[1] ?? "same as last year";
        return { id: i.id, ref: nos[0] ?? null, text: `${nos.length > 1 ? `Items ${nos[0]}–${nos.at(-1)}` : `Item ${nos[0]}`}: your quote says “${phrase}”. We do not hold earlier prices against this RFx — please state the current price in INR per 1000 pieces for each.` };
      }
      case "questionnaire_ambiguous":
        return { id: i.id, ref: q?.q_no ?? null, text: `Q${q?.q_no} (${q?.text}): your answer ${i.title.replace(/^Q\d+:\s*/, "")} — please confirm yes or no, with the date if it is pending.` };
      default: // questionnaire_missing
        return { id: i.id, ref: null, text: `Questionnaire: please answer ${i.detail ?? "the mandatory questions"}.` };
    }
  });
  // Line order, then questions (a supplier answers down their own sheet).
  const rank = (b: { ref: number | null }, i: Item) => (i.question_id ? 1000 : 0) + (b.ref ?? 999);
  return out.map((b, k) => ({ b, r: rank(b, items[k]) })).sort((x, y) => x.r - y.r).map((x) => x.b);
}

async function vendorAndTag(rfxId: string, vendorId: string) {
  const [{ data: rfx }, { data: v }, { data: rv }, { data: reqs }] = await Promise.all([
    db().from("rfx").select("code, title").eq("id", rfxId).single(),
    db().from("vendors").select("name, email").eq("id", vendorId).single(),
    db().from("rfx_vendors").select("reply_tag").eq("rfx_id", rfxId).eq("vendor_id", vendorId).maybeSingle(),
    sentClarifications(rfxId, vendorId),
  ]);
  if (!rfx || !v || !rv) throw new AppError("NOT_FOUND", "This vendor isn't invited to this RFx.", undefined, 404);
  const n = (reqs ?? []).length + 1;
  return { rfx, v, n, tag: `${rv.reply_tag}-clar-${n}` };
}

/** POST /api/clarify — a P-CLARIFY draft for the chosen cards; nothing is sent. */
export async function draftClarification(rfxId: string, vendorId: string, itemIds: string[], user: SessionUser) {
  const items = await loadItems(rfxId, vendorId, itemIds);
  const { rfx, v, n, tag } = await vendorAndTag(rfxId, vendorId);
  const list = await bullets(rfxId, vendorId, items);
  const refs = list.map((b) => b.ref).filter((r): r is number => r !== null);
  // Every asked item must be in the email (the supplier replies against the bullets).
  const Draft = z.object({ subject: z.string().min(5).max(160), body_text: z.string().min(40).max(2000) })
    .refine((d) => refs.every((r) => new RegExp(`\\b${r}\\b`).test(d.body_text)), { message: `body_text must mention every item number: ${refs.join(", ")}` });
  const prompt = P_CLARIFY.replace("{buyer_name}", user.name).replace("{vendor_name}", v.name).replace("{code}", rfx.code).replace("{items}", list.map((b) => `- ${b.text}`).join("\n"));
  const d = await generateJSON({ tier: "fast", purpose: "clarify", rfx_id: rfxId, schema: Draft, temperature: 0.4, parts: [{ text: prompt }, { text: CLARIFY_FORMAT }, { text: `Sign off as ${user.name}, Category Buyer, Meridian Foods (${user.email}).` }] });
  return { to: v.email, reply_to: replyToAddress(tag), clar_n: n, subject: d.subject, body: d.body_text, items: list.map((b) => ({ id: b.id, text: b.text })) };
}

/** POST /api/clarify/send — send it (mock mailbox), mark the cards asked, vendor → clarification_sent. */
export async function sendClarification(o: { rfxId: string; vendorId: string; subject: string; body: string; itemIds: string[] }, user: SessionUser) {
  if (!o.subject.trim() || !o.body.trim()) throw new AppError("BAD_INPUT", "The email needs a subject and a body.", undefined, 400);
  const items = await loadItems(o.rfxId, o.vendorId, o.itemIds);
  const { v, n, tag } = await vendorAndTag(o.rfxId, o.vendorId);
  // Thread on the RFx email; a seeded RFx has none, so the vendor's own latest email; else a new thread.
  const { data: thread } = await db().from("communications").select("message_id, kind, direction").eq("rfx_id", o.rfxId).eq("vendor_id", o.vendorId)
    .not("message_id", "is", null).order("created_at");
  const dispatch = (thread ?? []).filter((t) => t.kind === "rfx_dispatch").at(-1)?.message_id ?? null;
  const parent = dispatch ?? (thread ?? []).filter((t) => t.direction === "inbound").at(-1)?.message_id ?? null;
  const sent = await sendEmail({
    rfx_id: o.rfxId, vendor_id: o.vendorId, kind: "clarification", from: `"${user.name} (Meridian Foods)" <${user.email}>`, to: v.email,
    reply_to: replyToAddress(tag), subject: o.subject.trim(), text: o.body.trim(), attachments: [], in_reply_to: parent, references: parent ? [parent] : [],
  });
  const at = new Date().toISOString();
  for (const i of items) {
    const { error } = await db().from("review_items").update({ status: "asked_vendor", updated_at: at,
      resolution: { by: user.name, at, note: "Asked the vendor", communication_id: sent.id, clar_n: n } }).eq("id", i.id).eq("status", "open");
    if (error) throw error;
  }
  await db().from("rfx_vendors").update({ status: "clarification_sent" }).eq("rfx_id", o.rfxId).eq("vendor_id", o.vendorId);
  await audit({ rfx_id: o.rfxId, actor: user.id, event: "clarification.sent", entity_type: "communication", entity_id: sent.id,
    payload: { vendor: v.name, n, items: items.length, titles: items.map((i) => i.title), message_id: sent.message_id } });
  return { communication_id: sent.id, message_id: sent.message_id, clar_n: n, asked: items.length };
}

/**
 * TRD §8.7 scope of a clarification reply: lines whose cell is still unresolved (references_prior, ambiguous,
 * not_quoted, low_confidence) or that the answered request asked about; questions likewise (ambiguous, missing, asked).
 */
export async function clarificationScope(resp: ResponseRow) {
  const reqId = (resp.summary.clarification as { request_id?: string | null } | undefined)?.request_id ?? null;
  const [{ data: asked }, { data: cells }, { data: answers }, { data: lines }] = await Promise.all([
    reqId ? db().from("review_items").select("id, type, rfx_line_id, question_id, evidence").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id!).eq("resolution->>communication_id", reqId) : Promise.resolve({ data: [] }),
    db().from("line_quotes").select("rfx_line_id, state").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id!),
    db().from("questionnaire_answers").select("question_id, state").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id!),
    db().from("rfx_lines").select("id, line_no").eq("rfx_id", resp.rfx_id),
  ]);
  const lineIds = new Set<string>((cells ?? []).filter((c) => ["references_prior", "ambiguous", "not_quoted", "low_confidence"].includes(c.state)).map((c) => c.rfx_line_id));
  const askedLines = new Set<string>();
  for (const a of (asked ?? []) as { rfx_line_id: string | null; evidence: { lines?: number[] } }[]) {
    if (a.rfx_line_id) askedLines.add(a.rfx_line_id);
    for (const no of a.evidence?.lines ?? []) { const l = (lines ?? []).find((x) => x.line_no === no); if (l) askedLines.add(l.id); }
  }
  askedLines.forEach((l) => lineIds.add(l));
  const questionIds = new Set<string>([
    ...(answers ?? []).filter((a) => a.state === "ambiguous" || a.state === "missing").map((a) => a.question_id),
    ...((asked ?? []) as { question_id: string | null }[]).map((a) => a.question_id).filter((q): q is string => !!q),
  ]);
  return { request_id: reqId, lineIds, askedLines, questionIds };
}

/** After a clarification reply wrote lines / answers: the earlier cards about them → resolved_by_reply. */
export async function resolveByReply(resp: ResponseRow, o: { lineIds: string[]; questionIds: string[] }) {
  if (!resp.vendor_id || (!o.lineIds.length && !o.questionIds.length)) return 0;
  const { data: items } = await db().from("review_items").select("id, type, rfx_line_id, question_id, evidence, resolution").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id)
    .neq("response_id", resp.id).in("status", ["open", "asked_vendor"]);
  const { data: left } = await db().from("line_quotes").select("id").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id).eq("state", "references_prior");
  const lines = new Set(o.lineIds), qs = new Set(o.questionIds);
  const hit = (items ?? []).filter((i) => (i.rfx_line_id && lines.has(i.rfx_line_id)) || (i.question_id && qs.has(i.question_id))
    || (i.type === "prior_pricing" && !(left ?? []).length && o.lineIds.length > 0));
  const at = new Date().toISOString();
  for (const i of hit) {
    const { error } = await db().from("review_items").update({ status: "resolved_by_reply", updated_at: at,
      resolution: { ...(i.resolution as object ?? {}), at, note: "Answered by the vendor's clarification reply", response_id: resp.id, communication_id: resp.communication_id } }).eq("id", i.id);
    if (error) throw error;
  }
  return hit.length;
}
