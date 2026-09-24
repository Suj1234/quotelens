import "server-only";
import { db } from "@/lib/db";
import { signedUrl, type Bucket } from "@/lib/storage";

export type Attachment = { name: string; url: string | null; size?: number };
export type Comm = {
  id: string; direction: "outbound" | "inbound"; kind: string; mode: string; status: string; vendor: string | null; vendor_id: string | null;
  from: string | null; to: string | null; reply_to: string | null; subject: string | null; body: string | null;
  at: string; message_id: string | null; attachments: Attachment[]; response_id: string | null; error: string | null;
};

/** Every communication of an RFx with signed links for its attachments (outbound files live in `outbound`, inbound in `raw`). */
export async function listComms(rfxId: string, o: { direction?: "outbound" | "inbound"; vendorId?: string; kind?: string } = {}): Promise<Comm[]> {
  let q = db().from("communications").select("*, vendors(name)").eq("rfx_id", rfxId);
  if (o.direction) q = q.eq("direction", o.direction);
  if (o.vendorId) q = q.eq("vendor_id", o.vendorId);
  if (o.kind) q = q.eq("kind", o.kind);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  const rawPaths = new Map<string, string>();
  const inboundFileIds = (data ?? []).filter((c) => c.direction === "inbound").flatMap((c) => (c.attachments as { file_id?: string }[]).map((a) => a.file_id).filter(Boolean)) as string[];
  if (inboundFileIds.length) {
    const { data: files } = await db().from("response_files").select("id, storage_path").in("id", inboundFileIds);
    (files ?? []).forEach((f) => rawPaths.set(f.id, f.storage_path));
  }
  return Promise.all((data ?? []).map(async (c) => ({
    id: c.id, direction: c.direction, kind: c.kind, mode: c.mode, status: c.status, vendor: (c.vendors as { name: string } | null)?.name ?? null, vendor_id: c.vendor_id,
    from: c.from_addr, to: c.to_addr, reply_to: c.reply_to, subject: c.subject, body: c.body_text,
    at: c.sent_at ?? c.received_at ?? c.created_at, message_id: c.message_id, response_id: c.response_id, error: c.error,
    attachments: await Promise.all((c.attachments as { name: string; path?: string; bucket?: Bucket; file_id?: string; size?: number }[]).map(async (a) => {
      const path = a.path ?? (a.file_id ? rawPaths.get(a.file_id) : undefined);
      const bucket: Bucket = a.bucket ?? "raw";
      return { name: a.name, size: a.size, url: path ? await signedUrl(bucket, path, a.name).catch(() => null) : null };
    })),
  })));
}
