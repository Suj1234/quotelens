import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { mimeFor, preprocess } from "@/lib/preprocess";
import { derivedPath, get, list, put, rawPath } from "@/lib/storage";
import { STAGES, type ResponseRow } from "@/types/db";

export type IncomingFile = { name: string; mime?: string; buf: Buffer };
export type Source = "mock_upload" | "mock_paste" | "portal" | "seed" | "gmail" | "clarification_reply";

const pending = () => Object.fromEntries(STAGES.map((s) => [s, "pending"]));

/**
 * TRD §1.2 "raw before processed": communication + response rows, every file stored raw with its
 * response_files row, then preprocessed into the `derived` bucket (TRD §7).
 */
export async function createResponse(input: {
  rfxId: string; vendorId: string | null; source: Source; emailText?: string | null; files: IncomingFile[]; actor: string;
  subject?: string; fromAddr?: string;
  // Mailbox replies (P6): the message's own ids; clarification replies link to the request and the reply they correct (TRD §8.7).
  messageId?: string | null; inReplyTo?: string | null; toAddr?: string | null;
  clarification?: { request_id: string | null; n: number | null; supersedes: string | null };
}): Promise<string> {
  const { rfxId, vendorId, source, files } = input;
  const emailText = input.emailText?.trim() || null;
  if (!files.length && !emailText) throw new AppError("EMPTY_RESPONSE", "Add at least one file or paste the email text.");

  const vendor = vendorId ? (await db().from("vendors").select("email, name").eq("id", vendorId).single()).data : null;
  const comm = await db().from("communications").insert({
    rfx_id: rfxId, vendor_id: vendorId, direction: "inbound", kind: "vendor_reply", mode: source === "gmail" ? "gmail" : "mock",
    from_addr: input.fromAddr ?? vendor?.email ?? null, to_addr: input.toAddr ?? null, subject: input.subject ?? null, body_text: emailText,
    message_id: input.messageId ?? null, in_reply_to: input.inReplyTo ?? null,
    received_at: new Date().toISOString(), status: "received",
  }).select("id").single();
  if (comm.error) throw comm.error;

  const resp = await db().from("responses").insert({
    rfx_id: rfxId, vendor_id: vendorId, source, communication_id: comm.data.id, email_text: emailText, pipeline_status: pending(),
    is_clarification: !!input.clarification, supersedes_response_id: input.clarification?.supersedes ?? null,
    summary: input.clarification ? { clarification: { request_id: input.clarification.request_id, n: input.clarification.n } } : {},
  }).select("id").single();
  if (resp.error) throw resp.error;
  const responseId = resp.data.id as string;

  const attachments = [];
  for (const f of files) {
    const fileId = randomUUID();
    const mime = mimeFor(f.name, f.mime);
    const storage_path = await put("raw", rawPath(rfxId, responseId, fileId, f.name), f.buf, mime);
    const row = await db().from("response_files").insert({
      id: fileId, response_id: responseId, original_name: f.name, mime, size_bytes: f.buf.length, storage_path,
    });
    if (row.error) throw row.error;
    await derive(rfxId, responseId, fileId, f);
    attachments.push({ file_id: fileId, name: f.name, size: f.buf.length, mime });
  }

  await db().from("communications").update({ response_id: responseId, attachments }).eq("id", comm.data.id);
  await audit({ rfx_id: rfxId, actor: input.actor, event: "response.received", entity_type: "response", entity_id: responseId, payload: { source, vendor: vendor?.name ?? null, files: files.length, email_text: !!emailText, clarification: !!input.clarification, message_id: input.messageId ?? null } });
  console.log(`[stage:intake] response ${responseId} (${source}): ${files.length} files${emailText ? " + email text" : ""}`);
  return responseId;
}

/** Preprocess one stored file. A file we can't read is recorded on its row (visible), not thrown away. */
async function derive(rfxId: string, responseId: string, fileId: string, f: IncomingFile) {
  let update: Record<string, unknown>;
  try {
    const p = await preprocess(f.name, f.buf);
    if (p.mode === "text") {
      update = { derived_text_path: await put("derived", derivedPath(rfxId, responseId, fileId, "text.txt"), p.text, "text/plain; charset=utf-8") };
    } else if (p.mode === "image") {
      update = { derived_image_paths: [await put("derived", derivedPath(rfxId, responseId, fileId, "image.png"), p.png, "image/png")] };
    } else if (p.mode === "pdf") {
      update = { page_count: p.pageCount };
    } else {
      update = { file_kind: "unknown", classify_reason: p.note };
    }
  } catch (e) {
    console.error(`[stage:intake] preprocess failed for ${f.name}:`, e);
    update = { file_kind: "unknown", classify_reason: `could not read file: ${(e as Error).message}` };
  }
  const { error } = await db().from("response_files").update(update).eq("id", fileId);
  if (error) throw error;
}

// ---- Seeded responses (mock mode "Load seeded responses", TRD §16; dataset README §8) ----

type SeedEntry = { vendor: string; files: string[]; email?: string };
/** Which dataset files make up each vendor's reply. Loader config only — the pipeline treats them like any upload. */
const SEED_SETS: Record<"clean" | "realistic", SeedEntry[]> = {
  clean: [
    { vendor: "balaji", files: ["01_balaji/SBP_Price_Offer_MER-0417.xlsx", "01_balaji/SBP_ISO9001_Certificate.pdf"] },
    { vendor: "kohinoor", files: ["02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf", "02_kohinoor/Kohinoor_Company_Profile.pdf"] },
    { vendor: "westline", files: ["03_westline/Westline_Offer_MER-0417.docx", "03_westline/Westline_Company_Profile.pdf"] },
    // The human's real photo replaces the synthetic one when present (README §6); PRINT_ME.pdf is the photo's source, not a reply.
    { vendor: "orientpack", files: ["04_orientpack/OrientPack_Rate_Card_PHOTO.jpg|04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg", "04_orientpack/OrientPack_Supplier_Questionnaire_Response.pdf"] },
    { vendor: "anand", files: [], email: "05_anand/anand_email_body.txt" },
  ],
  realistic: [
    { vendor: "balaji", files: ["realistic/01_balaji/Qtn SBP-0912 Meridian.xlsx"], email: "realistic/01_balaji/balaji_cover_email.txt" },
    { vendor: "kohinoor", files: ["realistic/02_kohinoor/KC_Quotation_1187_Meridian.pdf"] },
    { vendor: "westline", files: ["realistic/03_westline/Westline offer Meridian Foods Sept26.docx"] },
    { vendor: "orientpack", files: ["realistic/04_orientpack/IMG_20261001_114532.jpg"] },
    { vendor: "anand", files: [], email: "realistic/05_anand/anand_email_realistic.txt" },
  ],
};

/** One vendor's reply from the dataset (files + email body), e.g. for "Use seed file" in Add response (DESIGN §3.5). */
export async function seedReply(vendorCode: string, set: "clean" | "realistic" = "clean"): Promise<{ files: IncomingFile[]; emailText: string | null } | null> {
  const e = SEED_SETS[set].find((x) => x.vendor === vendorCode);
  if (!e) return null;
  const available = new Set<string>();
  for (const dir of new Set([...e.files, e.email ?? ""].filter(Boolean).map((f) => path.dirname(f.split("|")[0])))) {
    (await list("seed", `seed/${dir}`)).forEach((p) => available.add(p.replace(/^seed\//, "")));
  }
  const names = e.files.map((f) => f.split("|").find((alt) => available.has(alt))).filter((f): f is string => !!f);
  const files = await Promise.all(names.map(async (n) => ({ name: path.basename(n), buf: await get("seed", `seed/${n}`) })));
  return { files, emailText: e.email ? (await get("seed", `seed/${e.email}`)).toString("utf8") : null };
}

/**
 * Replace this RFx's previously seeded responses (and their pipeline outputs) with a fresh copy of the dataset.
 * Responses from other sources are left untouched.
 */
export async function loadSeedResponses(rfxId: string, set: "clean" | "realistic", actor: string): Promise<string[]> {
  const { data: rfx } = await db().from("rfx").select("code, title").eq("id", rfxId).single();
  if (!rfx) throw new AppError("NOT_FOUND", "RFx not found", undefined, 404);
  const { data: vendors } = await db().from("vendors").select("id, short_code");
  const vendorId = (code: string) => vendors?.find((v) => v.short_code === code)?.id ?? null;

  await clearResponses(rfxId, "seed");

  const ids: string[] = [];
  for (const e of SEED_SETS[set]) {
    const reply = await seedReply(e.vendor, set);
    ids.push(await createResponse({
      rfxId, vendorId: vendorId(e.vendor), source: "seed", files: reply!.files, emailText: reply!.emailText, actor, subject: `Re: RFx ${rfx.code} - ${rfx.title}`,
    }));
  }
  await audit({ rfx_id: rfxId, actor, event: "seed.responses_loaded", payload: { set, responses: ids.length } });
  return ids;
}

/** Delete responses of one source for an RFx, with everything later stages wrote for them. */
async function clearResponses(rfxId: string, source: string) {
  const { data: base } = await db().from("responses").select("id, vendor_id, communication_id").eq("rfx_id", rfxId).eq("source", source);
  if (!base?.length) return;
  const vendorIds = base.map((r) => r.vendor_id).filter(Boolean);
  // Clarification replies to these vendors go too (they answer the replies being replaced), with the clarification emails and their mock mail.
  const { data: clars } = vendorIds.length ? await db().from("responses").select("id, vendor_id, communication_id").eq("rfx_id", rfxId).eq("is_clarification", true).in("vendor_id", vendorIds) : { data: [] };
  const data = [...base, ...(clars ?? []).filter((c) => !base.some((b) => b.id === c.id))];
  const ids = data.map((r) => r.id);
  // Children before line_quotes: review items and ledger rows point at cells.
  for (const t of ["review_items", "questionnaire_answers"]) {
    const { error } = await db().from(t).delete().in("response_id", ids);
    if (error) throw error;
  }
  if (vendorIds.length) {
    const { error } = await db().from("assumptions").delete().eq("rfx_id", rfxId).in("vendor_id", vendorIds);
    if (error) throw error;
  }
  // The reloaded vendors start again as invited (flags sets responded); a clarification asked during testing doesn't linger.
  if (vendorIds.length) await db().from("rfx_vendors").update({ status: "invited" }).eq("rfx_id", rfxId).in("vendor_id", vendorIds).in("status", ["responded", "clarification_sent", "clarified"]);
  const lq = await db().from("line_quotes").delete().in("response_id", ids);
  if (lq.error) throw lq.error;
  const del = await db().from("responses").delete().in("id", ids);
  if (del.error) throw del.error;
  const inbound = data.map((r) => r.communication_id).filter(Boolean);
  const { data: outClar } = vendorIds.length ? await db().from("communications").select("id, message_id, eml_path").eq("rfx_id", rfxId).eq("kind", "clarification").in("vendor_id", vendorIds) : { data: [] };
  const { data: inComms } = inbound.length ? await db().from("communications").select("message_id, eml_path").in("id", inbound) : { data: [] };
  const msgIds = [...(outClar ?? []), ...(inComms ?? [])].map((c) => c.message_id).filter(Boolean) as string[];
  const { data: box } = msgIds.length ? await db().from("mock_mailbox").select("id, direction, eml_path").eq("rfx_id", rfxId).or(`message_id.in.(${msgIds.map((m) => `"${m}"`).join(",")}),in_reply_to.in.(${msgIds.map((m) => `"${m}"`).join(",")})`) : { data: [] };
  await db().from("communications").delete().in("id", [...inbound, ...(outClar ?? []).map((c) => c.id)]);
  if (box?.length) await db().from("mock_mailbox").delete().in("id", box.map((b) => b.id));
  const files = { outbound: (outClar ?? []).map((c) => c.eml_path), raw: [...(inComms ?? []).map((c) => c.eml_path), ...(box ?? []).filter((b) => b.direction === "to_buyer").map((b) => b.eml_path)] };
  for (const [bucket, paths] of Object.entries(files)) { const p = paths.filter(Boolean) as string[]; if (p.length) await db().storage.from(bucket).remove(p); }
}

export async function getResponse(id: string): Promise<ResponseRow> {
  const { data, error } = await db().from("responses").select("*").eq("id", id).single<ResponseRow>();
  if (error || !data) throw new AppError("NOT_FOUND", "Response not found", undefined, 404);
  return data;
}
