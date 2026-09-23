import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { signedUrl } from "@/lib/storage";
import type { ResponseFile, ResponseRow, Rfx } from "@/types/db";

export async function getRfx(id: string) {
  const { data, error } = await db().from("rfx").select("*, rfx_lines(count)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("NOT_FOUND", "RFx not found", undefined, 404);
  return { ...(data as Rfx), lines: (data.rfx_lines as { count: number }[])[0]?.count ?? 0 };
}

export type VendorRow = {
  vendor_id: string; name: string; city: string | null; short_code: string; status: string;
  response: (Pick<ResponseRow, "id" | "received_at" | "pipeline_status" | "summary" | "source" | "email_text"> & {
    files: Pick<ResponseFile, "id" | "original_name" | "file_kind">[]; items: number; priced: number;
  }) | null;
};

/** One row per invited vendor with its latest non-clarification response (DESIGN §3.5). */
export async function listVendorResponses(rfxId: string): Promise<VendorRow[]> {
  const [inv, resp] = await Promise.all([
    db().from("rfx_vendors").select("status, vendors(id, name, city, short_code)").eq("rfx_id", rfxId),
    db().from("responses").select("id, vendor_id, received_at, pipeline_status, summary, source, email_text, is_clarification, response_files(id, original_name, file_kind, created_at), extracted_items(unit_price)")
      .eq("rfx_id", rfxId).eq("is_clarification", false).order("received_at", { ascending: false }),
  ]);
  if (inv.error || resp.error) throw inv.error ?? resp.error;
  return (inv.data ?? []).map((iv) => {
    const v = iv.vendors as unknown as { id: string; name: string; city: string | null; short_code: string };
    const r = resp.data?.find((x) => x.vendor_id === v.id);
    return {
      vendor_id: v.id, name: v.name, city: v.city, short_code: v.short_code, status: iv.status,
      response: r ? {
        id: r.id, received_at: r.received_at, pipeline_status: r.pipeline_status, summary: r.summary, source: r.source, email_text: r.email_text,
        files: [...r.response_files].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        items: r.extracted_items.length, priced: r.extracted_items.filter((i) => i.unit_price !== null).length,
      } : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export type ItemRow = {
  id: string; item_index: number; vendor_sku: string | null; vendor_description: string; unit_price: number | null;
  price_unit_raw: string | null; currency_raw: string | null; pack_size: number | null; pack_size_unit: string | null;
  notes: string | null; raw_confidence: number | null; file_id: string | null;
  location: { type: string; sheet?: string; ref?: string; page?: number; line?: number; snippet?: string; source?: string };
};

export async function getResponseDetail(responseId: string) {
  const { data, error } = await db().from("responses")
    .select("*, vendors(name, city, short_code), response_files(*), extracted_items(*), response_terms(*)")
    .eq("id", responseId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("NOT_FOUND", "Response not found", undefined, 404);
  const files = await Promise.all((data.response_files as ResponseFile[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(async (f) => ({ ...f, url: await signedUrl("raw", f.storage_path) })));
  return {
    response: data as ResponseRow,
    vendor: data.vendors as { name: string; city: string | null; short_code: string } | null,
    files,
    items: (data.extracted_items as ItemRow[]).sort((a, b) => a.item_index - b.item_index),
    terms: (data.response_terms as Record<string, unknown>[])[0] ?? null,
  };
}
