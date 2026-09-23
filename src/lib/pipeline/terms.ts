import "server-only";
import { bool, decide } from "@/lib/ai/decision";
import type { ResponseRow, Rfx } from "@/types/db";

export type TermsRow = {
  currency: string | null; validity_days: number | null; validity_until: string | null;
  freight_terms_raw: string | null; freight_included: boolean | null; tax_terms_raw: string | null; taxes_included: boolean | null;
  payment_terms_raw: string | null; payment_days: number | null; total_discount_pct: number | null; total_discount_condition: string | null;
  references_prior_pricing: boolean; references_prior_pricing_text: string | null; other_notes: string | null;
};
export type TermsDecision = {
  provider: string;
  p: { references_prior_pricing: number; freight_excluded: number; taxes_excluded: number; total_discount_conditional: number; rates_net_of_discount: number; buyer_misses_condition: number };
};

/**
 * TRD §10.2 "flags" question set, decided on the terms text — never copied from an extracted boolean
 * (e.g. a cell comment "Revised from 13200" is not prior pricing). Used by normalise (prior pricing, discount, freight) and flags.
 */
export async function decideTerms(resp: ResponseRow, rfx: Rfx, t: TermsRow, itemNotes: string[]): Promise<TermsDecision> {
  const line = (k: string, v: unknown) => (v === null || v === undefined || v === "" ? null : `${k}: ${v}`);
  const state = [
    "SUPPLIER TERMS (as read from the supplier's reply):",
    line("Currency", t.currency), line("Validity", t.validity_days ? `${t.validity_days} days` : t.validity_until),
    line("Freight", t.freight_terms_raw), line("Taxes", t.tax_terms_raw), line("Payment", t.payment_terms_raw),
    line("Discount", t.total_discount_pct !== null ? `${t.total_discount_pct}% ${t.total_discount_condition ?? ""}` : t.total_discount_condition),
    line("Reference to earlier pricing", t.references_prior_pricing_text), line("Other notes", t.other_notes),
    itemNotes.length ? `Remarks on individual items: ${itemNotes.slice(0, 12).map((n) => `"${n.slice(0, 200)}"`).join(" · ")}` : null,
    "",
    `BUYER'S RFx TERMS: pays ${rfx.payment_terms_days} days from invoice; asked for ${rfx.freight_included_requested ? "freight included, delivered to plant" : "freight quoted separately"}; quote unit ${rfx.quote_unit}.`,
  ].filter((x) => x !== null).join("\n");

  const r = await decide(state, {
    references_prior_pricing: { type: "boolean", statement: "For some items the supplier gives no price in this reply and instead refers to an earlier quote, contract or last year's prices (e.g. 'rest same as last year', 'as per previous PO'). A note about how a price that IS stated was revised does not count." },
    freight_excluded: { type: "boolean", statement: "Freight to the buyer's plants is NOT included in the quoted prices (e.g. ex-works, FOB, 'freight extra', 'to buyer's account')." },
    taxes_excluded: { type: "boolean", statement: "Taxes such as GST are NOT included in the quoted prices." },
    total_discount_conditional: { type: "boolean", statement: "The supplier mentions a discount that applies only under a condition (award size, early payment, volume)." },
    rates_net_of_discount: { type: "boolean", statement: "The quoted rates ALREADY have a discount deducted (they are printed net of it), rather than the discount being an extra reduction on top of the quoted rates. Signs of net rates: the supplier says rates are net of the discount, or tells the buyer to divide the quoted rate by (1 − the discount) or otherwise pay more than quoted when the condition isn't met." },
    buyer_misses_condition: { type: "boolean", statement: "Under the buyer's own payment terms stated above, the condition attached to the supplier's discount is NOT met." },
  }, { purpose: "flags", rfx_id: resp.rfx_id, response_id: resp.id });

  const p = Object.fromEntries(["references_prior_pricing", "freight_excluded", "taxes_excluded", "total_discount_conditional", "rates_net_of_discount", "buyer_misses_condition"]
    .map((k) => [k, Math.round(bool(r, k) * 1000) / 1000])) as TermsDecision["p"];
  return { provider: r.provider, p };
}
