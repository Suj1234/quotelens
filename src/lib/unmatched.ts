import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { runAll } from "@/lib/pipeline/run";
import type { SessionUser } from "@/lib/auth";
import { STAGES } from "@/types/db";

// TRD §16: unmatched items (items that fit no RFx line) and unmatched responses (replies with no vendor).

export type UnmatchedItem = {
  id: string; review_id: string | null; vendor: string; description: string; price: string;
  best: { line_no: number; description: string; p: number } | null;
};

export async function getUnmatched(rfxId: string): Promise<UnmatchedItem[]> {
  const { data, error } = await db().from("unmatched_items")
    .select("id, extracted_item_id, best_candidate_probability, rfx_lines:best_candidate_line_id(line_no, description), extracted_items(vendor_description, unit_price, price_unit_raw, currency_raw), responses(vendors(name))")
    .eq("rfx_id", rfxId).eq("status", "open").order("created_at");
  if (error) throw error;
  const ids = (data ?? []).map((u) => u.extracted_item_id);
  const { data: reviews } = ids.length ? await db().from("review_items").select("id, extracted_item_id").eq("type", "unmapped_item").eq("status", "open").in("extracted_item_id", ids) : { data: [] };
  return (data ?? []).map((u) => {
    const it = u.extracted_items as unknown as { vendor_description: string; unit_price: number | null; price_unit_raw: string | null; currency_raw: string | null };
    const l = u.rfx_lines as unknown as { line_no: number; description: string } | null;
    return {
      id: u.id, review_id: reviews?.find((r) => r.extracted_item_id === u.extracted_item_id)?.id ?? null,
      vendor: (u.responses as unknown as { vendors: { name: string } | null } | null)?.vendors?.name ?? "Unknown sender",
      description: it.vendor_description, price: it.unit_price === null ? "—" : `${it.currency_raw ?? ""} ${it.unit_price} ${it.price_unit_raw ?? ""}`.trim(),
      best: l ? { line_no: l.line_no, description: l.description, p: Number(u.best_candidate_probability ?? 0) } : null,
    };
  });
}

export type UnmatchedResponse = { id: string; received_at: string; source: string; from: string | null; files: string[]; items: number; email: boolean };

export async function getUnmatchedResponses(rfxId: string): Promise<UnmatchedResponse[]> {
  const { data, error } = await db().from("responses").select("id, received_at, source, email_text, communications:communication_id(from_addr), response_files(original_name), extracted_items(id)")
    .eq("rfx_id", rfxId).is("vendor_id", null).order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, received_at: r.received_at, source: r.source, email: !!r.email_text,
    from: (r.communications as unknown as { from_addr: string | null } | null)?.from_addr ?? null,
    files: (r.response_files as { original_name: string }[]).map((f) => f.original_name), items: (r.extracted_items as unknown[]).length,
  }));
}

/** TRD §16 POST /api/responses/{id}/assign-vendor — existing vendor or a new one; then pricing runs for the reply. */
export async function assignVendor(responseId: string, body: { vendor_id?: string; new_vendor?: { name?: string; email?: string } }, user: SessionUser) {
  const { data: resp } = await db().from("responses").select("id, rfx_id, vendor_id, communication_id, pipeline_status, rfx(code)").eq("id", responseId).maybeSingle();
  if (!resp) throw new AppError("NOT_FOUND", "Response not found", undefined, 404);
  let vendorId = body.vendor_id ?? null;
  if (!vendorId) {
    const name = body.new_vendor?.name?.trim(), email = body.new_vendor?.email?.trim();
    if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError("BAD_INPUT", "Give the new vendor a name and a valid email.", undefined, 400);
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "vendor";
    const { data: taken } = await db().from("vendors").select("short_code").like("short_code", `${base}%`);
    const code = taken?.length ? `${base}${taken.length + 1}` : base;
    const { data: v, error } = await db().from("vendors").insert({ name, email, short_code: code, created_by: "user" }).select("id").single();
    if (error) throw error;
    vendorId = v.id as string;
  } else {
    const { data: v } = await db().from("vendors").select("id").eq("id", vendorId).maybeSingle();
    if (!v) throw new AppError("BAD_INPUT", "That vendor doesn't exist.", undefined, 400);
  }
  const rfxCode = (resp.rfx as unknown as { code: string }).code;
  // Not invited before (e.g. a new supplier who replied anyway): add them to the RFx as responded.
  await db().from("rfx_vendors").upsert({ rfx_id: resp.rfx_id, vendor_id: vendorId, status: "responded", reply_tag: `rfx-${rfxCode.toLowerCase()}-${vendorId.slice(0, 8)}` }, { onConflict: "rfx_id,vendor_id", ignoreDuplicates: true });
  const [a, b] = await Promise.all([
    db().from("responses").update({ vendor_id: vendorId, updated_at: new Date().toISOString() }).eq("id", responseId),
    resp.communication_id ? db().from("communications").update({ vendor_id: vendorId }).eq("id", resp.communication_id) : Promise.resolve({ error: null }),
  ]);
  if (a.error || b.error) throw a.error ?? b.error;
  await db().from("review_items").update({ vendor_id: vendorId }).eq("response_id", responseId);
  await db().from("review_items").update({ status: "confirmed", resolution: { note: "Vendor assigned", by: user.name, at: new Date().toISOString() } }).eq("response_id", responseId).eq("type", "unknown_vendor").eq("status", "open");
  await audit({ rfx_id: resp.rfx_id, actor: user.id, event: "response.assign_vendor", entity_type: "response", entity_id: responseId, payload: { vendor_id: vendorId, new: !body.vendor_id } });

  // Continue the pipeline from the first stage that isn't done (normally normalise).
  const status = resp.pipeline_status as Record<string, string>;
  const from = STAGES.find((s) => status[s] !== "done") ?? "normalise";
  const events = [];
  for await (const ev of runAll(responseId, user.id, from)) events.push(ev);
  return { vendor_id: vendorId, events };
}
