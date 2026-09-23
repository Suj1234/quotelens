import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { currencyCode, fxRate } from "@/lib/normalise/fx";
import { applyLineDiscount, grossUp, landed, round2 } from "@/lib/normalise/price";
import { parseUnit, toPer1000Factor, type UnitKey } from "@/lib/normalise/units";
import { longDate, money } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import type { ResponseRow, Rfx, RfxLine } from "@/types/db";
import type { ExtractedItem, MapSummary } from "./map";
import { clearStageReviews, insertReviews, type ReviewInput } from "./reviews";
import { decideTerms, type TermsDecision, type TermsRow } from "./terms";

type State = "confirmed" | "inferred" | "low_confidence" | "ambiguous" | "not_quoted" | "references_prior" | "conflict";
type Step = Record<string, unknown> & { step: string };
type Assumption = { id: string; kind: string; description: string; value: unknown; basis: string; rfx_line_id?: string; line_quote_id?: string };

export type NormaliseSummary = { cells: number; states: Partial<Record<State, number>>; assumptions: number; reviews: number; terms: TermsDecision; freight_included: boolean; kept_buyer_cells: number };

const SRC_WORD: Record<string, string> = { image: "photo", pdf: "PDF", cell: "sheet", text: "text" };
const LOW_READ = 0.6; // raw_confidence below this → low_confidence (TRD §8.4, §11.5)

/** TRD §8.4 + §11 — mapping → line_quotes (one per line × vendor), assumptions ledger, review items. */
export async function normalise(resp: ResponseRow): Promise<NormaliseSummary> {
  const mapping = (resp.summary.map as MapSummary | undefined)?.mapping;
  if (!mapping) throw new Error("Run the map stage first (no mapping on this response).");
  if (!resp.vendor_id) throw new Error("Response has no vendor yet; assign one before normalising.");
  const vendorId = resp.vendor_id;

  const [rfxQ, linesQ, itemsQ, termsQ, rvQ, existingQ, fx, th, discountDefault, freightDefault] = await Promise.all([
    db().from("rfx").select("*").eq("id", resp.rfx_id).single<Rfx>(),
    db().from("rfx_lines").select("*").eq("rfx_id", resp.rfx_id).order("line_no"),
    db().from("extracted_items").select("*").eq("response_id", resp.id),
    db().from("response_terms").select("*").eq("response_id", resp.id).maybeSingle(),
    db().from("rfx_vendors").select("freight_assumption_inr_per_1000").eq("rfx_id", resp.rfx_id).eq("vendor_id", vendorId).maybeSingle(),
    db().from("line_quotes").select("id, rfx_line_id, state, reviewed_by, response_id, unit_price_inr_per_1000, best_guess_value").eq("rfx_id", resp.rfx_id).eq("vendor_id", vendorId),
    getSetting("fx_rates"), getSetting("thresholds"), getSetting("discount_default"), getSetting("freight_default_inr_per_1000"),
  ]);
  for (const q of [rfxQ, linesQ, itemsQ, termsQ, rvQ, existingQ]) if (q.error) throw q.error;
  const rfx = rfxQ.data!;
  const lines = linesQ.data as RfxLine[];
  const items = new Map((itemsQ.data as ExtractedItem[]).map((i) => [i.id, i]));
  const terms = (termsQ.data ?? emptyTerms()) as TermsRow;
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const notes = [...new Set([...items.values()].map((i) => i.notes).filter((n): n is string => !!n))];
  const td = await decideTerms(resp, rfx, terms, notes);
  const refPrior = td.p.references_prior_pricing >= 0.5;
  const freightIncluded = td.p.freight_excluded < 0.5;
  const freightPer1000 = rvQ.data?.freight_assumption_inr_per_1000 ?? freightDefault;
  const grossUpPct = terms.total_discount_pct && td.p.rates_net_of_discount >= 0.5 && td.p.buyer_misses_condition >= 0.5 ? terms.total_discount_pct : null;

  // Idempotency: this stage owns the system's assumptions for this vendor, its open review items, and every cell
  // of this vendor except the ones a buyer already decided (reviewed / excluded) — those are never overwritten.
  await clearStageReviews(resp.id, "normalise");
  // System ledger rows carry the reply they came from (value.response_id): a re-run replaces only its own (untagged = pre-P3 rows).
  const del = await db().from("assumptions").delete().eq("rfx_id", resp.rfx_id).eq("vendor_id", vendorId).eq("made_by", "system")
    .or(`value->>response_id.eq.${resp.id},value->>response_id.is.null`);
  if (del.error) throw del.error;
  type Existing = { id: string; state: string; reviewed_by: string | null; response_id: string | null; unit_price_inr_per_1000: number | null; best_guess_value: number | null };
  const existing = new Map((existingQ.data ?? []).map((c) => [c.rfx_line_id as string, c as Existing]));
  // Cells another reply from this vendor wrote: this reply never overwrites them (clarification replies: TRD §8.7, P6).
  const others = new Map([...existing].filter(([, c]) => c.response_id && c.response_id !== resp.id && c.state !== "not_quoted"));
  // Any buyer decision (reviewed, excluded, or "treat as not quoted") survives a re-run.
  const buyerOwned = new Set([...existing].filter(([, c]) => c.reviewed_by || c.state === "reviewed" || c.state === "excluded").map(([l]) => l));

  const assumptions: Assumption[] = [];
  const reviews: ReviewInput[] = [];
  const once = new Map<string, string>(); // vendor-level assumption key → id
  const vendorAssumption = (key: string, a: Omit<Assumption, "id">) => {
    if (!once.has(key)) { const id = randomUUID(); once.set(key, id); assumptions.push({ id, ...a }); }
    return once.get(key)!;
  };
  const cellId = (lineId: string) => existing.get(lineId)?.id ?? randomUUID();

  // Pack sizes the vendor stated elsewhere, by (ply, item_type) of the mapped line — the TRD §11.2 "system_inferred" guess.
  const winners = mapping.filter((m) => !m.conflict_with);
  const peerPacks = (line: RfxLine, unit: UnitKey) => {
    const packs = winners.flatMap((m) => {
      const it = items.get(m.item_id), l = lineById.get(m.line_id);
      if (!it || !l || l.id === line.id || parseUnit(it.price_unit_raw).unit !== unit) return [];
      const pack = it.pack_size ?? parseUnit(it.price_unit_raw).pack;
      return pack ? [{ pack, same: l.ply === line.ply && l.item_type === line.item_type, type: l.item_type === line.item_type }] : [];
    });
    return mode(packs.filter((p) => p.same).map((p) => p.pack)) ?? mode(packs.filter((p) => p.type).map((p) => p.pack));
  };

  type Cell = Record<string, unknown> & { id: string; rfx_line_id: string; state: State };
  const cells: Cell[] = [];
  const conflictLines = new Set(mapping.filter((m) => m.conflict_with).map((m) => m.line_id));

  for (const m of winners) {
    const it = items.get(m.item_id);
    const line = lineById.get(m.line_id);
    if (!it || !line || buyerOwned.has(line.id)) continue;
    const id = cellId(line.id);
    const ev = { file_id: it.file_id, location: it.location, snippet: it.location.snippet ?? null };
    const base = {
      id, rfx_id: resp.rfx_id, rfx_line_id: line.id, vendor_id: vendorId, response_id: resp.id, extracted_item_id: it.id,
      original_value: it.unit_price, original_unit: it.price_unit_raw, original_currency: it.currency_raw ?? terms.currency,
      mapping_probability: m.p, mapping_provider: m.provider,
    };

    if (it.unit_price === null) {
      if ((it.raw_confidence ?? 1) < LOW_READ) {
        cells.push({ ...base, state: "low_confidence", best_guess_note: it.notes ?? "Price could not be read." });
        reviews.push({ type: "low_confidence_read", rfx_line_id: line.id, line_quote_id: id, extracted_item_id: it.id, title: `Line ${line.line_no}: price unreadable in the ${SRC_WORD[String(it.location.type)] ?? "source"}`, detail: it.notes, probability: it.raw_confidence, proposed_state: "reviewed", evidence: ev });
      } else if (refPrior) {
        cells.push({ ...base, state: "references_prior", best_guess_note: it.notes ?? terms.references_prior_pricing_text });
      } else {
        cells.push({ ...base, state: "not_quoted", best_guess_note: it.notes });
      }
      continue;
    }

    // Conversion chain (TRD §6.12): every step recorded; any non-vendor-stated basis makes the cell "inferred".
    const chain: Step[] = [];
    let v = it.unit_price;
    let inferred = m.p < th.act;
    let ambiguous: string | null = null;
    let bestGuessNote: string | null = null;

    if (it.discount_pct) { v = applyLineDiscount(v, it.discount_pct); chain.push({ step: "line_discount", pct: it.discount_pct, basis: "vendor_stated" }); }
    if (grossUpPct) {
      const aid = vendorAssumption("discount", { kind: "discount_treatment", basis: "system_inferred", value: { pct: grossUpPct, treatment: "gross_up" },
        description: `Rates printed net of a ${grossUpPct}% discount (${terms.total_discount_condition ?? "conditional"}); buyer pays at ${rfx.payment_terms_days} days so the condition is not met → payable = printed ÷ ${round4(1 - grossUpPct / 100)}.` });
      v = grossUp(v, grossUpPct);
      chain.push({ step: "discount_gross_up", pct: grossUpPct, basis: "system_inferred", assumption_id: aid });
      inferred = true;
    }

    const { unit, pack: packInUnit } = parseUnit(it.price_unit_raw);
    let factor: number | null = null;
    if (unit === "per_box" || unit === "per_bundle") {
      const stated = it.pack_size ?? packInUnit;
      const spec = Number(line.spec_attributes?.pack_size) || null;
      if (stated) {
        factor = 1000 / stated;
        chain.push({ step: "unit", from: unit, to: "per_1000_pcs", factor, basis: `pack size ${stated} stated by the vendor`, basis_kind: "vendor_stated" });
      } else if (spec) {
        factor = 1000 / spec;
        const aid = randomUUID();
        assumptions.push({ id: aid, kind: "pack_size", basis: "rfx_spec", rfx_line_id: line.id, line_quote_id: id, value: { pack: spec }, description: `Line ${line.line_no}: pack of ${spec} taken from our line spec (vendor didn't state it).` });
        chain.push({ step: "unit", from: unit, to: "per_1000_pcs", factor, basis: `pack size ${spec} from RFx spec`, basis_kind: "rfx_spec", assumption_id: aid });
        inferred = true;
      } else {
        const guess = peerPacks(line, unit);
        ambiguous = `Priced ${unit.replace("per_", "per ")} but the ${unit === "per_box" ? "box" : "bundle"} size isn't stated for this item.`;
        if (guess) {
          factor = 1000 / guess;
          bestGuessNote = `Best guess ${guess}/${unit === "per_box" ? "box" : "bundle"} from the vendor's other ${line.ply}-ply items — not applied`;
          chain.push({ step: "unit", from: unit, to: "per_1000_pcs", factor, basis: `pack size ${guess} inferred from the vendor's other items`, basis_kind: "system_inferred", p: 0.6 });
        }
      }
    } else if (unit === "per_kg" || unit === "per_tonne") {
      factor = toPer1000Factor(unit, { weight_g: line.weight_per_piece_g });
      if (factor) {
        const aid = randomUUID();
        assumptions.push({ id: aid, kind: "weight_per_piece", basis: "rfx_spec", rfx_line_id: line.id, line_quote_id: id, value: { weight_g: line.weight_per_piece_g },
          description: `Line ${line.line_no}: ${unit === "per_kg" ? "₹/kg" : "₹/tonne"} × ${line.weight_per_piece_g} g per piece from our spec (not the vendor's).` });
        chain.push({ step: "unit", from: unit, to: "per_1000_pcs", factor, basis: `weight ${line.weight_per_piece_g} g/pc from RFx spec`, basis_kind: "rfx_spec", assumption_id: aid });
        inferred = true;
      } else ambiguous = `Priced ${unit.replace("per_", "per ")} but line ${line.line_no} has no weight per piece.`;
    } else {
      factor = toPer1000Factor(unit, {});
      if (factor === null) ambiguous = `Unit "${it.price_unit_raw ?? "not stated"}" can't be converted to ${rfx.quote_unit.replaceAll("_", " ")}.`;
      else if (factor !== 1) chain.push({ step: "unit", from: unit, to: "per_1000_pcs", factor, basis: "fixed ratio", basis_kind: "vendor_stated" });
    }
    if (factor !== null) v *= factor;

    const cur = currencyCode(it.currency_raw) ?? currencyCode(terms.currency);
    const curCode = cur ?? rfx.currency;
    if (!cur) {
      const aid = vendorAssumption("currency-missing", { kind: "other", basis: "system_inferred", value: { assumed: rfx.currency }, description: `Currency not stated; assumed ${rfx.currency}.` });
      chain.push({ step: "currency", from: null, to: rfx.currency, rate: 1, basis: "assumed", assumption_id: aid });
      inferred = true;
    } else if (curCode !== rfx.currency) {
      const rate = fxRate(fx, curCode);
      if (!rate) ambiguous ??= `No ${curCode}→${rfx.currency} rate in Settings.`;
      else {
        const aid = vendorAssumption(`fx-${curCode}`, { kind: "fx_rate", basis: "settings_default", value: rate, description: `${curCode}→${rfx.currency} at ${rate.rate} (${rate.source}, ${rate.date}).` });
        v *= rate.rate;
        chain.push({ step: "currency", from: curCode, to: rfx.currency, rate: rate.rate, rate_date: rate.date, assumption_id: aid });
        inferred = true;
      }
    }

    const value = round2(v);
    const landedV = round2(landed(value, { freight_included: freightIncluded, freight_per_1000: freightPer1000 }));
    if (ambiguous) {
      cells.push({ ...base, state: "ambiguous", conversion_chain: chain, best_guess_value: factor !== null ? value : null, best_guess_note: [ambiguous, bestGuessNote].filter(Boolean).join(" ") });
      reviews.push({ type: "ambiguous_unit", rfx_line_id: line.id, line_quote_id: id, extracted_item_id: it.id, title: (unit === "per_box" || unit === "per_bundle") && !it.pack_size ? `Item ${line.line_no}: price ${unit.replace("per_", "per ")}, ${unit === "per_box" ? "box" : "bundle"} size not stated` : `Line ${line.line_no}: ${ambiguous}`,
        detail: ambiguous, proposed_value: factor !== null ? value : null, proposed_note: bestGuessNote, probability: bestGuessNote ? 0.6 : null, proposed_state: "reviewed", evidence: ev });
    } else if ((it.raw_confidence ?? 1) < LOW_READ) {
      cells.push({ ...base, state: "low_confidence", conversion_chain: chain, best_guess_value: value, best_guess_note: it.notes ?? "Low read confidence." });
      reviews.push({ type: "low_confidence_read", rfx_line_id: line.id, line_quote_id: id, extracted_item_id: it.id, title: `Line ${line.line_no}: price read with low confidence in the ${SRC_WORD[String(it.location.type)] ?? "source"}`, detail: it.notes, probability: it.raw_confidence, proposed_value: value, evidence: ev });
    } else if (conflictLines.has(line.id)) {
      cells.push({ ...base, state: "conflict", conversion_chain: chain, best_guess_value: value, best_guess_note: "Another item from this vendor also maps to this line." });
    } else {
      cells.push({ ...base, state: inferred ? "inferred" : "confirmed", conversion_chain: chain, unit_price_inr_per_1000: value, landed_price_inr_per_1000: landedV });
    }
  }

  // A second price for a line another reply already priced → conflict card; the earlier cell stays until the buyer decides.
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i], o = others.get(c.rfx_line_id);
    if (!o) continue;
    cells.splice(i, 1);
    const mine = (c.unit_price_inr_per_1000 ?? c.best_guess_value ?? null) as number | null;
    const theirs = o.unit_price_inr_per_1000 ?? o.best_guess_value;
    reviews.push({ type: "conflict", rfx_line_id: c.rfx_line_id, line_quote_id: o.id, extracted_item_id: c.extracted_item_id as string, proposed_value: mine,
      title: `Line ${lineById.get(c.rfx_line_id)!.line_no}: two prices from this vendor`,
      detail: `Earlier reply: ${theirs != null ? `${money(Number(theirs))} per 1000` : o.state.replaceAll("_", " ")}. This reply: ${mine != null ? `${money(mine)} per 1000` : c.state.replaceAll("_", " ")}. Confirm uses this reply's price.` });
  }

  // Lines with no item: references_prior when the vendor pointed at earlier pricing (TRD §11.6), else not_quoted.
  const covered = new Set(cells.map((c) => c.rfx_line_id));
  for (const line of lines) {
    if (covered.has(line.id) || buyerOwned.has(line.id) || others.has(line.id)) continue;
    cells.push({
      id: cellId(line.id), rfx_id: resp.rfx_id, rfx_line_id: line.id, vendor_id: vendorId, response_id: resp.id, extracted_item_id: null,
      state: refPrior ? "references_prior" : "not_quoted", best_guess_note: refPrior ? terms.references_prior_pricing_text : null,
    });
  }

  // Vendor-level ledger entries and informational review items (TRD §8.4, §11.4, §11.7) — only when this reply priced something
  // (a stray file for a known vendor must not raise freight/discount cards or ledger rows).
  const wrote = cells.some((c) => c.extracted_item_id);
  if (wrote && terms.total_discount_pct && !grossUpPct) {
    vendorAssumption("discount", { kind: "discount_treatment", basis: "settings_default", value: { pct: terms.total_discount_pct, condition: terms.total_discount_condition, treatment: discountDefault },
      description: `${terms.total_discount_pct}% total discount available (${terms.total_discount_condition ?? "no condition stated"}); not applied (${discountDefault}) — toggle to allocate pro rata.` });
  }
  if (wrote && terms.total_discount_pct) {
    reviews.push({ type: "discount_treatment", title: grossUpPct ? `Printed rates are net of a ${grossUpPct}% discount we won't earn` : `${terms.total_discount_pct}% discount on total${terms.total_discount_condition ? ` ${terms.total_discount_condition}` : ""}`,
      detail: grossUpPct ? `Grossed up to the payable rate (÷ ${round4(1 - grossUpPct / 100)}). Condition: ${terms.total_discount_condition ?? "—"}.` : `Not applied by default. Condition: ${terms.total_discount_condition ?? "—"}.`,
      proposed_value: terms.total_discount_pct, evidence: { terms: true } });
  }
  const refPriorLines = cells.filter((c) => c.state === "references_prior");
  if (refPriorLines.length) {
    vendorAssumption("prior", { kind: "prior_pricing", basis: "vendor_stated", value: { lines: refPriorLines.length, text: terms.references_prior_pricing_text },
      description: `${refPriorLines.length} lines reference earlier pricing not on file ("${terms.references_prior_pricing_text ?? "same as before"}"); no value used.` });
    // One vendor-level card (DESIGN §3.6); its actions apply to every affected line.
    const nos = refPriorLines.map((c) => lineById.get(c.rfx_line_id)!.line_no).sort((a, b) => a - b);
    const span = nos.length > 1 && nos[nos.length - 1] - nos[0] === nos.length - 1 ? `Items ${nos[0]}–${nos[nos.length - 1]}` : `Items ${nos.join(", ")}`;
    // Quote the vendor's shortest wording (the terms text can be the whole sentence; an item note is often just the phrase).
    const phrase = [terms.references_prior_pricing_text, ...refPriorLines.map((c) => c.best_guess_note as string | null)]
      .filter((t): t is string => !!t).sort((a, b) => a.length - b.length)[0] ?? "same as before";
    reviews.push({ type: "prior_pricing", title: `${span}: “${phrase.slice(0, 60)}” — prior pricing not on file`,
      detail: `${nos.length} lines cannot be priced without a number from the vendor.`, probability: td.p.references_prior_pricing, proposed_value: nos.length, evidence: { terms: true, lines: nos } });
  }
  if (wrote && !freightIncluded) {
    vendorAssumption("freight", { kind: "freight_treatment", basis: rvQ.data?.freight_assumption_inr_per_1000 ? "buyer_entered" : "settings_default", value: { inr_per_1000: freightPer1000 },
      description: `Freight not included ("${terms.freight_terms_raw ?? "not stated"}"); landed price adds ₹${freightPer1000} per 1000 pcs.` });
    reviews.push({ type: "freight_treatment", title: `${(terms.freight_terms_raw ?? "Freight not stated").slice(0, 70)} — freight excluded`, detail: `"${terms.freight_terms_raw ?? "not stated"}" → landed price adds ₹${freightPer1000} per 1000.`, proposed_value: freightPer1000, probability: td.p.freight_excluded, evidence: { terms: true } });
  }
  for (const a of assumptions.filter((a) => a.kind === "fx_rate")) {
    const r = a.value as { rate: number; date: string };
    reviews.push({ type: "fx_assumption", title: `${a.description.split("→")[0]} → INR at ${r.rate}${r.date ? ` (${longDate(r.date)})` : ""}`, detail: `${a.description} Acknowledge once for this vendor.`, evidence: { assumption_id: a.id } });
  }

  // Write: cells first (per-line assumptions and review items point at them; chains hold assumption ids as plain values).
  const now = new Date().toISOString();
  const rows = cells.map((c) => ({
    unit_price_inr_per_1000: null, landed_price_inr_per_1000: null, original_value: null, original_unit: null, original_currency: null,
    mapping_probability: null, mapping_provider: null, conversion_chain: [], best_guess_value: null, best_guess_note: null,
    reviewed_by: null, reviewed_at: null, review_note: null, ...c, updated_at: now,
  }));
  if (rows.length) {
    const { error } = await db().from("line_quotes").upsert(rows, { onConflict: "rfx_line_id,vendor_id" });
    if (error) throw error;
  }
  if (assumptions.length) {
    const { error } = await db().from("assumptions").insert(assumptions.map((a) => ({ ...a, value: { ...(a.value as object), response_id: resp.id }, rfx_id: resp.rfx_id, vendor_id: vendorId, made_by: "system" })));
    if (error) throw error;
  }
  const nReviews = await insertReviews(resp, "normalise", reviews);

  const states: Partial<Record<State, number>> = {};
  for (const c of cells) states[c.state] = (states[c.state] ?? 0) + 1;
  return { cells: cells.length, states, assumptions: assumptions.length, reviews: nReviews, terms: td, freight_included: freightIncluded, kept_buyer_cells: buyerOwned.size };
}

function mode(xs: number[]): number | null {
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const emptyTerms = (): TermsRow => ({
  currency: null, validity_days: null, validity_until: null, freight_terms_raw: null, freight_included: null, tax_terms_raw: null, taxes_included: null,
  payment_terms_raw: null, payment_days: null, total_discount_pct: null, total_discount_condition: null, references_prior_pricing: false,
  references_prior_pricing_text: null, other_notes: null,
});
