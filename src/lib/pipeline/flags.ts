import "server-only";
import { db } from "@/lib/db";
import { currencyCode } from "@/lib/normalise/fx";
import type { ResponseRow, Rfx } from "@/types/db";
import type { NormaliseSummary } from "./normalise";
import { clearStageReviews, insertReviews, type ReviewInput } from "./reviews";
import { decideTerms, type TermsRow } from "./terms";

export type Flag = "references_prior_pricing" | "freight_excluded" | "validity_short" | "currency_not_inr" | "total_discount_present" | "partial_quote";
export type FlagsSummary = { flags: Flag[]; lines_priced: number; lines_total: number; not_quoted: number; open_reviews: number; rfx_status: string; provider: string };

/** TRD §8.6 — vendor-level flags from the decided terms, interpreted terms written back, vendor + RFx status moved on. */
export async function flags(resp: ResponseRow): Promise<FlagsSummary> {
  if (!resp.vendor_id) throw new Error("Response has no vendor yet; assign one first.");
  const [rfxQ, termsQ, cellsQ, itemsQ] = await Promise.all([
    db().from("rfx").select("*").eq("id", resp.rfx_id).single<Rfx>(),
    db().from("response_terms").select("*").eq("response_id", resp.id).maybeSingle(),
    db().from("line_quotes").select("state, unit_price_inr_per_1000").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id),
    db().from("extracted_items").select("currency_raw, notes").eq("response_id", resp.id),
  ]);
  for (const q of [rfxQ, termsQ, cellsQ, itemsQ]) if (q.error) throw q.error;
  const rfx = rfxQ.data!;
  const terms = termsQ.data as (TermsRow & { id: string }) | null;
  const cells = cellsQ.data ?? [];

  // Reuse the decision normalise made on the same terms; decide afresh only if normalise didn't run.
  const td = (resp.summary.normalise as NormaliseSummary | undefined)?.terms
    ?? (terms ? await decideTerms(resp, rfx, terms, [...new Set((itemsQ.data ?? []).map((i) => i.notes).filter(Boolean) as string[])]) : null);

  const currencies = new Set([terms?.currency, ...(itemsQ.data ?? []).map((i) => i.currency_raw)].map((c) => currencyCode(c)).filter(Boolean));
  const notQuoted = cells.filter((c) => c.state === "not_quoted").length;
  const on: Record<Flag, boolean> = {
    references_prior_pricing: (td?.p.references_prior_pricing ?? 0) >= 0.5,
    freight_excluded: (td?.p.freight_excluded ?? 0) >= 0.5,
    validity_short: validityDays(terms, resp.received_at) !== null && validityDays(terms, resp.received_at)! < rfx.validity_days_requested,
    currency_not_inr: [...currencies].some((c) => c !== rfx.currency),
    total_discount_present: !!terms?.total_discount_pct || (td?.p.total_discount_conditional ?? 0) >= 0.5,
    partial_quote: notQuoted > 0,
  };
  const list = (Object.keys(on) as Flag[]).filter((f) => on[f]);

  // "Interpreted" columns (TRD §6.11) carry the decision, not the extractor's guess.
  if (terms && td) {
    const { error } = await db().from("response_terms").update({
      references_prior_pricing: on.references_prior_pricing, freight_included: !on.freight_excluded, taxes_included: td.p.taxes_excluded < 0.5,
    }).eq("id", terms.id);
    if (error) throw error;
  }

  // Review items not already raised by normalise (insertReviews dedupes on type + line + question).
  await clearStageReviews(resp.id, "flags");
  const v = validityDays(terms, resp.received_at);
  const reviews: ReviewInput[] = [];
  if (on.validity_short) reviews.push({ type: "validity_short", title: `Validity ${v} days (RFx asked ${rfx.validity_days_requested})`, detail: terms?.validity_until ? `Valid until ${terms.validity_until}.` : null, proposed_value: v, evidence: { terms: true } });
  if (on.partial_quote) reviews.push({ type: "missing_line", title: `${notQuoted} of ${cells.length} lines not quoted`, detail: terms?.other_notes, proposed_value: notQuoted, evidence: { terms: true } });
  if (on.freight_excluded) reviews.push({ type: "freight_treatment", title: "Freight not included", detail: terms?.freight_terms_raw, probability: td?.p.freight_excluded, evidence: { terms: true } });
  if (on.references_prior_pricing) reviews.push({ type: "prior_pricing", title: "Refers to earlier pricing", detail: terms?.references_prior_pricing_text, probability: td?.p.references_prior_pricing, evidence: { terms: true } });
  if (on.total_discount_present) reviews.push({ type: "discount_treatment", title: "Discount offered", detail: terms?.total_discount_condition, evidence: { terms: true } });
  // A reply that priced nothing (stray file) raises no vendor-level cards.
  if (((resp.summary.map as { mapped?: number } | undefined)?.mapped ?? 0) > 0) await insertReviews(resp, "flags", reviews);

  // Status: vendor responded; RFx issued → receiving → reviewing once no invited vendor is still waiting (TRD §8.6).
  const rv = await db().from("rfx_vendors").update({ status: "responded" }).eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id).eq("status", "invited");
  if (rv.error) throw rv.error;
  const { data: invited, error: ie } = await db().from("rfx_vendors").select("status").eq("rfx_id", resp.rfx_id);
  if (ie) throw ie;
  let status = rfx.status;
  if (status === "issued" || status === "receiving") {
    status = (invited ?? []).some((r) => r.status === "invited") ? "receiving" : "reviewing";
    if (status !== rfx.status) {
      const { error } = await db().from("rfx").update({ status, updated_at: new Date().toISOString() }).eq("id", rfx.id);
      if (error) throw error;
    }
  }
  const { count } = await db().from("review_items").select("id", { count: "exact", head: true }).eq("response_id", resp.id).eq("status", "open");

  return {
    flags: list, lines_priced: cells.filter((c) => c.unit_price_inr_per_1000 !== null).length, lines_total: cells.length, not_quoted: notQuoted,
    open_reviews: count ?? 0, rfx_status: status, provider: td?.provider ?? "none",
  };
}

/** Validity in days: stated days, else the gap from receipt to the stated end date. */
function validityDays(t: TermsRow | null, receivedAt: string): number | null {
  if (!t) return null;
  if (t.validity_days) return t.validity_days;
  if (t.validity_until) return Math.round((Date.parse(t.validity_until) - Date.parse(receivedAt)) / 86_400_000);
  return null;
}
