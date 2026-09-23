import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type Bucket = "raw" | "derived" | "outbound" | "seed";

// TRD §5 path conventions
export const rawPath = (rfxId: string, responseId: string, fileId: string, name: string) =>
  `rfx/${rfxId}/responses/${responseId}/${fileId}-${safeName(name)}`;
export const derivedPath = (rfxId: string, responseId: string, fileId: string, name: string) =>
  `rfx/${rfxId}/responses/${responseId}/${fileId}/${safeName(name)}`;

/** Storage keys reject some characters; keep names readable but safe. */
export const safeName = (name: string) => name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_");

export async function put(bucket: Bucket, path: string, body: Buffer | string, contentType: string) {
  const { error } = await db().storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new AppError("STORAGE_PUT", `Upload to ${bucket}/${path} failed: ${error.message}`, undefined, 500);
  return path;
}

export async function get(bucket: Bucket, path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error || !data) throw new AppError("STORAGE_GET", `Download of ${bucket}/${path} failed: ${error?.message}`, undefined, 500);
  return Buffer.from(await data.arrayBuffer());
}

export async function list(bucket: Bucket, prefix: string): Promise<string[]> {
  const { data, error } = await db().storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new AppError("STORAGE_LIST", `List of ${bucket}/${prefix} failed: ${error.message}`, undefined, 500);
  return data.filter((f) => f.id).map((f) => `${prefix}/${f.name}`); // folders have no id
}

/** 60-minute signed URL for the browser (TRD §5). */
export async function signedUrl(bucket: Bucket, path: string, download?: string) {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw new AppError("STORAGE_SIGN", `Signing ${bucket}/${path} failed: ${error.message}`, undefined, 500);
  return data.signedUrl;
}
