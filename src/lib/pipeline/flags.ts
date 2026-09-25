import "server-only";
import { db } from "@/lib/db";
import { currencyCode } from "@/lib/normalise/fx";
import type { ResponseRow, Rfx } from "@/types/db";
import type { NormaliseSummary } from "./normalise";
import { clearStageReviews, insertReviews, type ReviewInput } from "./reviews";
import { decideTerms, type TermsRow } from "./terms";
import { COUNTED } from "@/lib/comparison";
import { getSetting } from "@/lib/settings";
import { outlierTitle, priceOutliers } from "@/lib/price-check";
import { holdCells, releaseCells, vendorCheck } from "./vendor-check";

export type Flag = "references_prior_pricing" | "freight_excluded" | "validity_short" | "currency_not_inr" | "total_discount_present" | "partial_quote" | "tax_basis_differs";
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
  // A clarification reply (TRD §8.7) answers specific lines: the vendor's terms and flags stay those of its main reply.
  if (resp.is_clarification) {
    await checkPrices(resp.rfx_id); // the reply changed prices
    const rv = await db().from("rfx_vendors").update({ status: "clarified" }).eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id).in("status", ["clarification_sent", "responded", "invited"]);
    if (rv.error) throw rv.error;
    const { count } = await db().from("review_items").select("id", { count: "exact", head: true }).eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id).in("status", ["open", "asked_vendor"]);
    return { flags: [], lines_priced: cells.filter((c) => c.unit_price_inr_per_1000 !== null).length, lines_total: cells.length, not_quoted: cells.filter((c) => c.state === "not_quoted").length,
      open_reviews: count ?? 0, rfx_status: rfx.status, provider: "none" };
  }
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
    // Only when the vendor wrote something about tax: silence is not a contradiction (migration 0013).
    tax_basis_differs: !!terms?.tax_terms_raw && !!td && ((rfx.tax_basis ?? "excl_gst") === "excl_gst" ? td.p.taxes_excluded < 0.5 : td.p.taxes_excluded >= 0.5),
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
  if (on.tax_basis_differs) reviews.push({ type: "tax_basis", title: rfx.tax_basis === "incl_gst" ? "Prices exclude GST (RFx asked for GST included)" : "Prices include GST (RFx asked for prices excluding GST)", detail: terms?.tax_terms_raw, probability: td ? (rfx.tax_basis === "incl_gst" ? td.p.taxes_excluded : 1 - td.p.taxes_excluded) : null, evidence: { terms: true } });
  if (on.total_discount_present) reviews.push({ type: "discount_treatment", title: "Discount offered", detail: terms?.total_discount_condition, evidence: { terms: true } });
  // P10 C12: anything else the vendor attached to its prices (MOQ, tooling, spec notes) — one card per reply, all of them listed.
  const conds = ((terms as { conditions?: { text: string; kind: string }[] | null } | null)?.conditions ?? []);
  if (conds.length) reviews.push({ type: "vendor_condition", title: conds.length === 1 ? `A condition attached to the prices: “${conds[0].text.slice(0, 70)}”` : `${conds.length} conditions attached to the prices`,
    detail: conds.map((c) => c.text).join(" · "), evidence: { terms: true, conditions: conds } });
  // A reply that priced nothing (stray file) raises no vendor-level cards.
  if (((resp.summary.map as { mapped?: number } | undefined)?.mapped ?? 0) > 0) await insertReviews(resp, "flags", reviews);

  // 0016 vendor check: is this reply really from this vendor? While its card is open, the reply's prices are held back;
  // a buyer's Keep / Exclude is never re-opened (insertReviews), and Exclude is re-applied after a re-run rebuilt the cells.
  const vc = await vendorCheck(resp);
  if (vc.reasons.length) {
    const { count: priced } = await db().from("line_quotes").select("id", { count: "exact", head: true }).eq("response_id", resp.id).in("state", COUNTED).not("unit_price_inr_per_1000", "is", null);
    await insertReviews(resp, "flags", [{ type: "vendor_mismatch", title: `This reply may not be from ${(await db().from("vendors").select("name").eq("id", resp.vendor_id).single()).data?.name ?? "this vendor"}`,
      detail: vc.reasons.join(" "), probability: vc.p_own, proposed_value: priced ?? 0, evidence: { lines: vc.lines, reasons: vc.reasons, provider: vc.provider } }]);
  }
  const { data: card } = await db().from("review_items").select("status, resolution").eq("response_id", resp.id).eq("type", "vendor_mismatch").maybeSingle();
  if (card?.status === "open") console.log(`[stage:flags] vendor check: ${await holdCells(resp.id)} price(s) held — ${vc.reasons.join(" ")}`);
  else if (!card) await releaseCells(resp, "confirmed"); // a re-run of flags alone that no longer finds a problem
  if (card?.status === "excluded") {
    const { error } = await db().from("line_quotes").update({ state: "excluded", unit_price_inr_per_1000: null, landed_price_inr_per_1000: null, review_note: (card.resolution as { note?: string } | null)?.note ?? "Reply excluded" })
      .eq("response_id", resp.id).neq("state", "not_quoted");
    if (error) throw error;
  }
  await checkPrices(resp.rfx_id);

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

/**
 * P9 D1: every counted price on the RFx against the other vendors' median for its line and the ₹/kg band (settings.price_check).
 * Runs RFx-wide because a later reply changes the median for earlier ones. Open "check unit" cards are rebuilt from the data;
 * a card the buyer already decided is never re-opened. The cell keeps its state.
 */
export async function checkPrices(rfxId: string) {
  const [global, templates, rfxQ, cellsQ, linesQ, cardsQ] = await Promise.all([
    getSetting("price_check"), getSetting("category_templates"), db().from("rfx").select("category").eq("id", rfxId).single(),
    db().from("line_quotes").select("id, rfx_line_id, vendor_id, response_id, extracted_item_id, unit_price_inr_per_1000").eq("rfx_id", rfxId).in("state", COUNTED).not("unit_price_inr_per_1000", "is", null),
    db().from("rfx_lines").select("id, line_no, weight_per_piece_g").eq("rfx_id", rfxId),
    db().from("review_items").select("id, line_quote_id, status").eq("rfx_id", rfxId).eq("type", "price_check"),
  ]);
  for (const q of [cellsQ, linesQ, cardsQ]) if (q.error) throw q.error;
  // P10 S4: ratio from Settings, ₹/kg band from this RFx's category template (none → no ₹/kg check).
  const band = templates[rfxQ.data?.category ?? ""]?.price_band ?? null;
  const s = { median_ratio: global.median_ratio, rs_per_kg_min: band?.rs_per_kg_min ?? null, rs_per_kg_max: band?.rs_per_kg_max ?? null };
  const line = new Map((linesQ.data ?? []).map((l) => [l.id, l]));
  const cells = cellsQ.data ?? [];
  const outs = priceOutliers(cells.map((c) => ({
    line_quote_id: c.id, line_no: line.get(c.rfx_line_id)?.line_no ?? 0, vendor: c.vendor_id, price: Number(c.unit_price_inr_per_1000),
    weight_g: line.get(c.rfx_line_id)?.weight_per_piece_g === null || line.get(c.rfx_line_id)?.weight_per_piece_g === undefined ? null : Number(line.get(c.rfx_line_id)!.weight_per_piece_g),
  })), s);
  const decided = new Set((cardsQ.data ?? []).filter((c) => c.status !== "open").map((c) => c.line_quote_id));
  const open = (cardsQ.data ?? []).filter((c) => c.status === "open").map((c) => c.id);
  if (open.length) { const { error } = await db().from("review_items").delete().in("id", open); if (error) throw error; }
  const rows = outs.filter((o) => !decided.has(o.line_quote_id)).map((o) => {
    const c = cells.find((x) => x.id === o.line_quote_id)!;
    return { rfx_id: rfxId, vendor_id: c.vendor_id, response_id: c.response_id, rfx_line_id: c.rfx_line_id, line_quote_id: c.id, extracted_item_id: c.extracted_item_id,
      type: "price_check", title: outlierTitle(o, s), detail: "The price may be in a different unit (per piece, per box, per bundle) or mistyped. The cell keeps its state until you decide.",
      proposed_value: o.price, evidence: { stage: "price_check", price: o.price, median: o.median, ratio: o.ratio, rs_per_kg: o.rs_per_kg, reasons: o.reasons } };
  });
  if (rows.length) { const { error } = await db().from("review_items").insert(rows); if (error) throw error; }
  if (rows.length || open.length) console.log(`[stage:flags] price check: ${rows.length} card(s) (${open.length} replaced)`);
  return rows.length;
}
