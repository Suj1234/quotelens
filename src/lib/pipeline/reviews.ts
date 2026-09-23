import "server-only";
import { db } from "@/lib/db";
import type { ResponseRow } from "@/types/db";

export type ReviewInput = {
  type: string; title: string; detail?: string | null;
  rfx_line_id?: string | null; line_quote_id?: string | null; extracted_item_id?: string | null; question_id?: string | null;
  proposed_value?: number | null; proposed_state?: string | null; proposed_note?: string | null; probability?: number | null;
  evidence?: Record<string, unknown>;
};

const key = (r: { type: string; rfx_line_id?: string | null; question_id?: string | null; extracted_item_id?: string | null }) =>
  [r.type, r.rfx_line_id ?? "-", r.question_id ?? "-", r.extracted_item_id ?? "-"].join("|");

/** Idempotency: a stage re-run removes the open review items it created earlier (tagged evidence.stage). */
export async function clearStageReviews(responseId: string, stage: string) {
  const { error } = await db().from("review_items").delete().eq("response_id", responseId).eq("status", "open").eq("evidence->>stage", stage);
  if (error) throw error;
}

/**
 * Insert with the TRD §12.1 dedupe key (+ extracted item, so two unplaceable items stay two cards):
 * skips anything already present for this response, from any stage, in any status — a buyer's decision is never re-opened.
 */
export async function insertReviews(resp: ResponseRow, stage: string, items: ReviewInput[]) {
  if (!items.length) return 0;
  const { data, error } = await db().from("review_items").select("type, rfx_line_id, question_id, extracted_item_id").eq("response_id", resp.id);
  if (error) throw error;
  const seen = new Set((data ?? []).map(key));
  const rows = items.filter((r) => !seen.has(key(r)) && seen.add(key(r))).map((r) => ({
    ...r, rfx_id: resp.rfx_id, vendor_id: resp.vendor_id, response_id: resp.id, evidence: { ...(r.evidence ?? {}), stage },
  }));
  if (rows.length) {
    const { error: e } = await db().from("review_items").insert(rows);
    if (e) throw e;
  }
  return rows.length;
}
