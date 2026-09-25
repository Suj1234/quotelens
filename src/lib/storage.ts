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

/** Every file under prefix, folders walked (Settings → Evaluation → Seed data lists the dataset pack). */
export async function listDeep(bucket: Bucket, prefix: string): Promise<{ path: string; size: number }[]> {
  const { data, error } = await db().storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new AppError("STORAGE_LIST", `List of ${bucket}/${prefix} failed: ${error.message}`, undefined, 500);
  const out: { path: string; size: number }[] = [];
  for (const f of data) {
    const p = `${prefix}/${f.name}`;
    if (f.id) out.push({ path: p, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
    else out.push(...(await listDeep(bucket, p))); // folders have no id
  }
  return out;
}

/** Many 60-minute download links in one call. */
export async function signedUrls(bucket: Bucket, paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await db().storage.from(bucket).createSignedUrls(paths, 3600, { download: true });
  if (error) throw new AppError("STORAGE_SIGN", `Signing ${bucket} files failed: ${error.message}`, undefined, 500);
  return new Map(data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

/** 60-minute signed URL for the browser (TRD §5). */
export async function signedUrl(bucket: Bucket, path: string, download?: string) {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw new AppError("STORAGE_SIGN", `Signing ${bucket}/${path} failed: ${error.message}`, undefined, 500);
  return data.signedUrl;
}
