import "server-only";
import { db } from "@/lib/db";
import { inrShort, longDate } from "@/lib/format";

// P10 D5: everything a vendor attached to its prices, in one list — shown as chips in the Comparison header and the Overview
// vendor row, and in full on hover. Read from the vendor's main reply (v_vendor_terms) and the ledger; amber = differs from
// what the RFx asked or changes what the price means.
export type Condition = { label: string; text: string; tone: "amber" | "grey"; chip?: string };

const discountChip = (v: { pct: number; kind?: string; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null }) =>
  `${v.pct}% ${v.kind === "all_lines" ? "if all lines" : v.kind === "min_lines" ? `if ≥ ${v.min_lines} lines` : v.kind === "min_value" ? `if ≥ ${inrShort(v.min_value_inr ?? 0)}`
    : v.kind === "payment_days" ? `if paid ≤ ${v.payment_days}d` : v.kind === "none" ? "off total" : "conditional"}`;

/** vendor_id → conditions, for every vendor invited to the RFx. */
export async function vendorConditions(rfxId: string): Promise<Map<string, Condition[]>> {
  const [rfxQ, termsQ, rvQ, ledgerQ, extraQ] = await Promise.all([
    db().from("rfx").select("validity_days_requested, payment_terms_days, freight_included_requested, tax_basis, currency").eq("id", rfxId).single(),
    db().from("v_vendor_terms").select("*").eq("rfx_id", rfxId),
    db().from("rfx_vendors").select("vendor_id, freight_assumption_inr_per_1000, vendors(short_code)").eq("rfx_id", rfxId),
    db().from("assumptions").select("vendor_id, kind, value, basis, created_at").eq("rfx_id", rfxId).in("kind", ["discount_treatment", "fx_rate"]).is("superseded_by", null).order("created_at", { ascending: false }),
    db().from("responses").select("vendor_id, response_terms(conditions)").eq("rfx_id", rfxId).not("vendor_id", "is", null),
  ]);
  for (const q of [rfxQ, termsQ, rvQ, ledgerQ]) if (q.error) throw q.error;
  const rfx = rfxQ.data!;
  const idOf = new Map((rvQ.data ?? []).map((r) => [(r.vendors as unknown as { short_code: string }).short_code, r.vendor_id as string]));
  const out = new Map<string, Condition[]>();
  for (const t of termsQ.data ?? []) {
    const vid = idOf.get(t.vendor_code);
    if (!vid) continue;
    const c: Condition[] = [];
    const rv = (rvQ.data ?? []).find((r) => r.vendor_id === vid);
    const mine = (k: string) => { const rows = (ledgerQ.data ?? []).filter((a) => a.vendor_id === vid && a.kind === k); return rows.find((a) => a.basis === "buyer_entered") ?? rows[0]; };
    if (t.validity_days || t.validity_until) {
      const short = !!t.validity_days && t.validity_days < rfx.validity_days_requested;
      c.push({ label: "Validity", tone: short ? "amber" : "grey", chip: short ? `Valid ${t.validity_days}d` : undefined,
        text: `${t.validity_days ? `${t.validity_days} days` : ""}${t.validity_until ? `${t.validity_days ? ", " : ""}until ${longDate(t.validity_until)}` : ""}${short ? ` (RFx asked ${rfx.validity_days_requested})` : ""}` });
    }
    const d = mine("discount_treatment")?.value as { pct?: number; condition?: string | null; treatment?: string; kind?: string; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null } | undefined;
    if (t.total_discount_pct && d?.treatment !== "ignored") {
      const grossUp = d?.treatment === "gross_up";
      c.push({ label: "Discount", tone: "amber", chip: grossUp ? `Net of ${t.total_discount_pct}%` : discountChip({ pct: Number(t.total_discount_pct), ...d }),
        text: grossUp ? `Rates are printed net of ${t.total_discount_pct}% (“${t.total_discount_condition ?? ""}”); we don't meet it, so prices are shown grossed up.`
          : `${t.total_discount_pct}% off the total — “${t.total_discount_condition ?? "no condition stated"}”. Not in line prices; applied in award options where the condition is met.` });
    }
    if (t.freight_included === false || t.freight_terms_raw) {
      const extra = t.freight_included === false;
      const amt = rv?.freight_assumption_inr_per_1000;
      c.push({ label: "Freight", tone: extra ? "amber" : "grey", chip: extra ? (amt != null ? `Freight +₹${amt}` : "Freight extra") : undefined,
        text: `${t.freight_terms_raw ?? (extra ? "not included" : "included")}${extra ? (amt != null ? ` — landed price adds ₹${amt} per 1000 (set by the buyer)` : " — amount not stated; landed prices leave it out") : ""}` });
    }
    if (t.tax_terms_raw) {
      const differs = t.taxes_included !== null && t.taxes_included !== (rfx.tax_basis === "incl_gst");
      c.push({ label: "GST", tone: differs ? "amber" : "grey", chip: differs ? (t.taxes_included ? "GST incl." : "GST extra") : undefined, text: `${t.tax_terms_raw}${differs ? ` (RFx asked prices ${rfx.tax_basis === "incl_gst" ? "including" : "excluding"} GST)` : ""}` });
    }
    if (t.payment_terms_raw || t.payment_days) {
      const differs = t.payment_days !== null && t.payment_days !== rfx.payment_terms_days;
      c.push({ label: "Payment", tone: differs ? "amber" : "grey", text: `${t.payment_terms_raw ?? `${t.payment_days} days`}${differs ? ` (RFx asked ${rfx.payment_terms_days} days)` : ""}` });
    }
    if (t.currency && t.currency !== rfx.currency) {
      const fx = mine("fx_rate")?.value as { rate?: number; date?: string } | undefined;
      c.push({ label: "Currency", tone: "amber", chip: t.currency, text: `Quoted in ${t.currency}${fx?.rate ? `; converted at ${fx.rate}${fx.date ? ` (${longDate(fx.date)})` : ""}` : ""}` });
    }
    if (t.references_prior_pricing) c.push({ label: "Earlier pricing", tone: "amber", chip: "Refers to last year", text: `“${t.references_prior_pricing_text ?? "same as before"}”` });
    // P10 C12: anything else the vendor attached to its prices (MOQ, tooling, spec notes), as the extractor listed it.
    const extra = (extraQ.data ?? []).filter((r) => r.vendor_id === vid).flatMap((r) => ((r.response_terms as unknown as { conditions: { text: string; kind: string }[] | null }[] | null)?.[0]?.conditions ?? []));
    for (const x of extra) c.push({ label: x.kind === "moq" ? "Minimum order" : x.kind === "tooling" ? "Tooling / charges" : x.kind === "spec" ? "Spec note" : x.kind === "delivery" ? "Delivery" : "Other", tone: "amber", text: x.text });
    if (t.other_notes && !extra.length) c.push({ label: "Notes", tone: "grey", text: t.other_notes });
    out.set(vid, c);
  }
  return out;
}
