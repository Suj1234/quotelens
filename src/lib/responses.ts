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
}): Promise<string> {
  const { rfxId, vendorId, source, files } = input;
  const emailText = input.emailText?.trim() || null;
  if (!files.length && !emailText) throw new AppError("EMPTY_RESPONSE", "Add at least one file or paste the email text.");

  const vendor = vendorId ? (await db().from("vendors").select("email, name").eq("id", vendorId).single()).data : null;
  const comm = await db().from("communications").insert({
    rfx_id: rfxId, vendor_id: vendorId, direction: "inbound", kind: "vendor_reply", mode: source === "gmail" ? "gmail" : "mock",
    from_addr: input.fromAddr ?? vendor?.email ?? null, subject: input.subject ?? null, body_text: emailText,
    received_at: new Date().toISOString(), status: "received",
  }).select("id").single();
  if (comm.error) throw comm.error;

  const resp = await db().from("responses").insert({
    rfx_id: rfxId, vendor_id: vendorId, source, communication_id: comm.data.id, email_text: emailText, pipeline_status: pending(),
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
  await audit({ rfx_id: rfxId, actor: input.actor, event: "response.received", entity_type: "response", entity_id: responseId, payload: { source, files: files.length, email_text: !!emailText } });
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

  const available = new Set<string>();
  for (const dir of new Set(SEED_SETS[set].flatMap((e) => [...e.files, e.email ?? ""]).filter(Boolean).map((f) => path.dirname(f.split("|")[0])))) {
    (await list("seed", `seed/${dir}`)).forEach((p) => available.add(p.replace(/^seed\//, "")));
  }
  const ids: string[] = [];
  for (const e of SEED_SETS[set]) {
    const names = e.files.map((f) => f.split("|").find((alt) => available.has(alt))).filter((f): f is string => !!f);
    const files = await Promise.all(names.map(async (n) => ({ name: path.basename(n), buf: await get("seed", `seed/${n}`) })));
    const emailText = e.email ? (await get("seed", `seed/${e.email}`)).toString("utf8") : null;
    ids.push(await createResponse({
      rfxId, vendorId: vendorId(e.vendor), source: "seed", files, emailText, actor, subject: `Re: RFx ${rfx.code} - ${rfx.title}`,
    }));
  }
  await audit({ rfx_id: rfxId, actor, event: "seed.responses_loaded", payload: { set, responses: ids.length } });
  return ids;
}

/** Delete responses of one source for an RFx, with everything later stages wrote for them. */
async function clearResponses(rfxId: string, source: string) {
  const { data } = await db().from("responses").select("id, vendor_id, communication_id").eq("rfx_id", rfxId).eq("source", source);
  if (!data?.length) return;
  const ids = data.map((r) => r.id);
  const vendorIds = data.map((r) => r.vendor_id).filter(Boolean);
  for (const t of ["line_quotes", "review_items", "questionnaire_answers"]) {
    const { error } = await db().from(t).delete().in("response_id", ids);
    if (error) throw error;
  }
  if (vendorIds.length) await db().from("assumptions").delete().eq("rfx_id", rfxId).in("vendor_id", vendorIds);
  const del = await db().from("responses").delete().in("id", ids);
  if (del.error) throw del.error;
  await db().from("communications").delete().in("id", data.map((r) => r.communication_id).filter(Boolean));
}

export async function getResponse(id: string): Promise<ResponseRow> {
  const { data, error } = await db().from("responses").select("*").eq("id", id).single<ResponseRow>();
  if (error || !data) throw new AppError("NOT_FOUND", "Response not found", undefined, 404);
  return data;
}
