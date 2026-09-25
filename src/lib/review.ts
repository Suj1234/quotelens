import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildEvidence, type Evidence } from "@/lib/evidence";
import { money } from "@/lib/format";
import { round2 } from "@/lib/normalise/price";
import { shortlist } from "@/lib/pipeline/shortlist";
import { releaseCells } from "@/lib/pipeline/vendor-check";
import { audit } from "@/lib/log";
import type { Loc, Step } from "@/lib/comparison";
import type { MapSummary } from "@/lib/pipeline/map";
import { passes } from "@/lib/pipeline/questionnaire";
import { runStage } from "@/lib/pipeline/run";
import type { SessionUser } from "@/lib/auth";
import type { ResponseFile, RfxLine } from "@/types/db";
import { ASKABLE, draftClarification } from "@/lib/clarify";
import { assignVendor } from "@/lib/unmatched";

// TRD §12 + §17.8, DESIGN §2.11 / §3.6.
export type Action = "confirm" | "override" | "exclude" | "map" | "ignore" | "ask-vendor" | "mark-not-quoted" | "dismiss" | "accept-yes" | "treat-no" | "enter-prices" | "set-freight"
  | "set-fx" | "set-gst" | "set-discount" | "answer" | "reassign";
export const ACTIONS: Action[] = ["confirm", "override", "exclude", "map", "ignore", "ask-vendor", "mark-not-quoted", "dismiss", "accept-yes", "treat-no", "enter-prices", "set-freight",
  "set-fx", "set-gst", "set-discount", "answer", "reassign"];

/**
 * P10 B1 — the four buttons, the same on every card, always in this order. Which ones a card shows follows four rules:
 * Accept only when the system suggests something · Change whenever there is something to change · Ask only when the vendor
 * can answer · Exclude only when leaving it out makes sense. `change` names the form behind the one Change button.
 */
export type ChangeForm = "price" | "prices" | "line" | "freight" | "rate" | "gst" | "discount" | "yesno" | "answers" | "vendor";
export type Buttons = { accept: Action | null; change: { form: ChangeForm; actions: Action[] } | null; ask: boolean; exclude: Action | null };
const INFORMATIONAL = ["fx_assumption", "discount_treatment", "freight_treatment", "tax_basis", "validity_short", "missing_line"];
// DESIGN §3.6 order: ambiguous units, low-confidence read, prior pricing, discounts, FX, freight, questionnaire, validity; then the rest.
const ORDER = ["vendor_mismatch", "unknown_vendor", "not_a_quote", "total_mismatch", "ambiguous_unit", "price_check", "low_confidence_read", "prior_pricing", "discount_treatment", "fx_assumption", "freight_treatment", "tax_basis", "questionnaire_ambiguous", "questionnaire_missing", "validity_short", "missing_line", "unmapped_item", "conflict", "unknown_vendor", "not_a_quote"];

export type QueueItem = {
  id: string; type: string; title: string; detail: string | null; status: string;
  vendor: { id: string; code: string; name: string } | null; line_no: number | null;
  probability: number | null; proposed_value: number | null; proposed_note: string | null;
  evidence: Evidence | null; resolution: { value?: number; note?: string; by?: string; at?: string } | null;
  actions: Action[]; buttons: Buttons; candidates?: { line_id: string; line_no: number; description: string; likely?: boolean }[];
  /** P10 B5: for a number we filled in — A vendor-stated · B our spec / official rate · C buyer-entered · D default or AI inference. */
  grade?: "A" | "B" | "C" | "D";
  /** Change forms: the vendors a reply can move to; the unanswered questions; the current rate / GST / discount reading. */
  vendor_options?: { id: string; name: string }[]; missing_questions?: { q_no: number; text: string; answer_type: string }[];
  /** Two answers from one vendor to the same question: both, and where each came from. */
  conflict?: Conflict;
  current?: { rate?: number; gst_pct?: number; discount?: { pct: number; kind: string; min_lines: number | null; min_value_inr: number | null; payment_days: number | null } };
  /** Plain-language bucket the queue groups by, and what stays true if nobody decides. */
  group: string; if_nothing: string | null;
  /** "Not quoted" cards: the lines "Enter prices…" fills. */
  prior_lines?: { line_no: number; description: string }[];
};

// P10 B4: the groups follow bid-leveling's own terms — a number WE filled in (plug), a condition the VENDOR stated
// (qualification), something NOT QUOTED (exclusion) — plus prices, line matching, the questionnaire and whose reply it is.
// The queue orders them (review-queue.tsx GROUPS); the Overview uses the same words.
/** Two answers from one vendor to the same question (P10): both, with where each came from. Older cards: from the title. */
export type Conflict = { earlier: { answer: string | null; from: string | null }; other: { answer: string | null; from: string | null } };
export function conflictOf(r: { type: string; evidence?: Record<string, unknown> | null; title?: string }): Conflict | null {
  if (r.type !== "questionnaire_ambiguous") return null;
  const c = r.evidence?.conflict as Conflict | undefined;
  if (c) return c;
  const m = (r.title ?? "").match(/two answers from this vendor — “([^”]*)” vs “([^”]*)”/);
  return m ? { earlier: { answer: m[1], from: null }, other: { answer: m[2], from: null } } : null;
}
/** A gross-up (rates printed net of a discount we won't earn) vs a discount offer. New cards say so; older ones by their title. */
const grossUp = (r: Pick<Row, "type" | "evidence"> & { title?: string }) => r.type === "discount_treatment" && (r.evidence?.gross_up === true || (!r.evidence?.discount && /net of/i.test(r.title ?? "")));
export function groupOf(r: Pick<Row, "type" | "proposed_state" | "evidence"> & { title?: string }): string {
  if (r.type === "low_confidence_read" && r.proposed_state === "mapped") return "Line matching";
  switch (r.type) {
    case "ambiguous_unit": case "price_check": case "low_confidence_read": case "conflict": case "total_mismatch": return "Prices to check";
    case "prior_pricing": case "missing_line": return "Not quoted";
    case "unmapped_item": return "Line matching";
    case "questionnaire_ambiguous": case "questionnaire_missing": return "Questionnaire";
    case "unknown_vendor": case "not_a_quote": case "vendor_mismatch": return "Replies to sort";
    case "fx_assumption": return "Numbers we filled in";
    case "discount_treatment": return grossUp(r) ? "Numbers we filled in" : "Vendor conditions";
    default: return "Vendor conditions"; // freight extra, GST basis, short validity, MOQ / tooling / spec notes
  }
}
/** P10 B5: how reliable a number we filled in is (only for "Numbers we filled in" cards). */
function gradeOf(r: Pick<Row, "type" | "evidence"> & { title?: string }): QueueItem["grade"] {
  if (r.type === "fx_assumption") return "B"; // the company's dated rate table
  if (grossUp(r)) return "D";                 // the AI judged the rates net and the condition missed
  return undefined;
}

type Row = {
  id: string; type: string; title: string; detail: string | null; status: string; rfx_line_id: string | null; line_quote_id: string | null;
  extracted_item_id: string | null; question_id: string | null; response_id: string | null; vendor_id: string | null;
  proposed_value: number | null; proposed_note: string | null; proposed_state: string | null; probability: number | null;
  evidence: Record<string, unknown>; resolution: QueueItem["resolution"];
};

/** P10 B1: the four buttons for a card, by the four rules (see Buttons). The only place that decides them. */
export function buttonsFor(r: Pick<Row, "type" | "proposed_value" | "line_quote_id" | "proposed_state" | "evidence"> & { title?: string; answer_type?: string | null; vendor_id?: string | null }): Buttons {
  // A reply from an unknown sender: nothing on it can be decided (no grid cell, nobody to ask) until it belongs to a vendor.
  if (r.vendor_id === null && r.type !== "unknown_vendor" && r.type !== "not_a_quote") return { accept: null, change: null, ask: false, exclude: null };
  const suggested = r.proposed_value !== null;
  const ask = ASKABLE.includes(r.type);
  const B = (accept: Action | null, change: Buttons["change"], exclude: Action | null): Buttons => ({ accept, change, ask, exclude });
  const price = { form: "price" as const, actions: ["override" as Action] };
  switch (r.type) {
    case "ambiguous_unit": case "conflict": return B(suggested ? "confirm" : null, price, "exclude");
    case "low_confidence_read":
      return r.proposed_state === "mapped" ? { ...B("confirm", { form: "line", actions: ["map"] }, "exclude"), ask: false } : B(suggested ? "confirm" : null, price, "exclude");
    case "price_check": return B("confirm", price, "exclude");   // P9 D1: Accept = the price is right, the cell keeps its state
    case "total_mismatch": return B("confirm", null, null);      // Accept = the lines are right; Ask the vendor otherwise
    case "prior_pricing": return B("mark-not-quoted", { form: "prices", actions: ["enter-prices"] }, null);
    case "missing_line": return B("confirm", { form: "prices", actions: ["enter-prices"] }, null);
    case "unmapped_item": return { ...B(null, { form: "line", actions: ["map"] }, "ignore"), ask: false };
    case "freight_treatment": return B(suggested ? "confirm" : null, { form: "freight", actions: ["set-freight"] }, null);
    case "fx_assumption": return B("confirm", { form: "rate", actions: ["set-fx"] }, null);
    case "discount_treatment": return B("confirm", { form: "discount", actions: ["set-discount"] }, grossUp(r) ? null : "exclude");
    case "tax_basis": return B("confirm", { form: "gst", actions: ["set-gst"] }, null);
    case "validity_short": case "vendor_condition": return B("confirm", null, null);
    case "questionnaire_ambiguous": {
      // Two answers → Accept keeps the earlier one; Change uses the other or types one. One unclear answer → nothing to accept;
      // Change fits the question: Yes / No for a yes-no question, a typed value for a number or text question.
      if (conflictOf(r)) return B("confirm", { form: "answers", actions: ["answer"] }, null);
      const type = (r.evidence?.answer_type as string | undefined) ?? r.answer_type ?? "yes_no";
      return B(null, type === "yes_no" ? { form: "yesno", actions: ["accept-yes", "treat-no"] } : { form: "answers", actions: ["answer"] }, null);
    }
    case "questionnaire_missing": return B("dismiss", { form: "answers", actions: ["answer"] }, null);   // Accept = leave unanswered
    case "vendor_mismatch": return B("confirm", { form: "vendor", actions: ["reassign"] }, "exclude");
    case "unknown_vendor": return { ...B(null, { form: "vendor", actions: ["reassign"] }, "dismiss"), ask: false };
    case "not_a_quote": return { ...B("dismiss", null, null), ask: false };
    default: return B("confirm", null, null);
  }
}
/** Every action a card allows = its buttons (the route checks this; the UI shows the same four slots). */
export function actionsFor(r: Pick<Row, "type" | "proposed_value" | "line_quote_id" | "proposed_state" | "evidence"> & { title?: string; answer_type?: string | null; vendor_id?: string | null }): Action[] {
  const b = buttonsFor(r);
  return [...new Set([b.accept, ...(b.change?.actions ?? []), b.ask ? "ask-vendor" as const : null, b.exclude].filter((a): a is Action => !!a))];
}

export async function listReview(rfxId: string, f: { vendor?: string; type?: string; status?: string } = {}): Promise<QueueItem[]> {
  let q = db().from("review_items").select("*").eq("rfx_id", rfxId);
  if (f.type) q = q.eq("type", f.type);
  if (f.status === "open") q = q.eq("status", "open");
  else if (f.status === "resolved") q = q.neq("status", "open");
  const [itemsQ, vendorsQ, linesQ] = await Promise.all([q, db().from("vendors").select("id, short_code, name"), db().from("rfx_lines").select("*").eq("rfx_id", rfxId).order("line_no")]);
  for (const x of [itemsQ, vendorsQ, linesQ]) if (x.error) throw x.error;
  const lines = (linesQ.data ?? []) as RfxLine[];
  let rows = itemsQ.data as Row[];
  const vendorOf = (id: string | null) => (vendorsQ.data ?? []).find((v) => v.id === id);
  if (f.vendor) rows = rows.filter((r) => vendorOf(r.vendor_id)?.short_code === f.vendor);
  const lineNo = new Map(lines.map((l) => [l.id, l.line_no]));

  // Everything evidence needs, fetched once.
  const responseIds = [...new Set(rows.map((r) => r.response_id).filter(Boolean))] as string[];
  const itemIds = [...new Set(rows.map((r) => r.extracted_item_id).filter(Boolean))] as string[];
  const [filesQ, respQ, termsQ, itemsLocQ, cellsQ, answersQ, questionsQ, invitedQ, ledgerQ, rvQ] = await Promise.all([
    responseIds.length ? db().from("response_files").select("*").in("response_id", responseIds) : Promise.resolve({ data: [] }),
    responseIds.length ? db().from("responses").select("id, email_text").in("id", responseIds) : Promise.resolve({ data: [] }),
    responseIds.length ? db().from("response_terms").select("*").in("response_id", responseIds) : Promise.resolve({ data: [] }),
    itemIds.length ? db().from("extracted_items").select("id, file_id, location, price_unit_raw, vendor_sku, vendor_description, notes").in("id", itemIds) : Promise.resolve({ data: [] }),
    db().from("line_quotes").select("vendor_id, state, extracted_item_id, rfx_line_id").eq("rfx_id", rfxId).in("state", ["references_prior", "not_quoted"]),
    db().from("questionnaire_answers").select("question_id, vendor_id, answer_raw, location, state").eq("rfx_id", rfxId),
    db().from("rfx_questions").select("id, q_no, text, answer_type, disqualify_if, mandatory").eq("rfx_id", rfxId),
    db().from("rfx_vendors").select("vendor_id, vendors(name)").eq("rfx_id", rfxId),
    db().from("assumptions").select("vendor_id, kind, value, basis, created_at").eq("rfx_id", rfxId).in("kind", ["fx_rate", "discount_treatment"]).is("superseded_by", null).order("created_at", { ascending: false }),
    db().from("rfx_vendors").select("vendor_id, gst_adjust_pct").eq("rfx_id", rfxId),
  ]);
  const files = (filesQ.data ?? []) as ResponseFile[];
  const gapCells = (cellsQ.data ?? []) as { vendor_id: string; state: string; extracted_item_id: string | null; rfx_line_id: string }[];
  const priorCells = gapCells.filter((c) => c.state === "references_prior");
  const priorItems = priorCells.filter((c): c is typeof c & { extracted_item_id: string } => !!c.extracted_item_id);
  const extraIds = priorItems.map((c) => c.extracted_item_id).filter((id) => !itemIds.includes(id));
  const extraLoc = extraIds.length ? (await db().from("extracted_items").select("id, file_id, location, price_unit_raw").in("id", extraIds)).data ?? [] : [];
  type ItemRow = { id: string; file_id: string | null; location: Loc; price_unit_raw: string | null; vendor_sku?: string | null; vendor_description?: string; notes?: string | null };
  const locOf = new Map([...(itemsLocQ.data ?? []), ...extraLoc].map((i) => [i.id as string, i as ItemRow]));
  const email = (rid: string | null) => (respQ.data ?? []).find((r) => r.id === rid)?.email_text ?? null;
  const quoteFile = (rid: string | null) => files.find((f) => f.response_id === rid && f.file_kind === "quotation") ?? null;

  // ponytail: one evidence build per card (downloads derived text each time); memoise per file if the queue grows past a few dozen.
  const items = await Promise.all(rows.map(async (r): Promise<QueueItem> => {
    const v = vendorOf(r.vendor_id);
    let evidence: Evidence | null = null;
    const itemId = r.extracted_item_id ?? (r.type === "prior_pricing" ? priorItems.find((c) => c.vendor_id === r.vendor_id)?.extracted_item_id : undefined);
    const it = itemId ? locOf.get(itemId) : undefined;
    if (it) {
      evidence = await buildEvidence(it.location, files.find((f) => f.id === it.file_id) ?? null, email(r.response_id), it.id, r.type === "ambiguous_unit" ? it.price_unit_raw : null);
    } else if (r.type === "vendor_mismatch") {
      const lines = (r.evidence.lines as string[] | undefined) ?? [];
      const f = quoteFile(r.response_id);
      evidence = lines.length ? { kind: "text", text: lines.join("\n"), caption: `Terms read from ${f?.original_name ?? "the email body"}`, open_url: undefined } : null;
    } else if (r.question_id) {
      const c = conflictOf(r);
      if (c) {
        // Both answers side by side, each with where it came from (the card is about the difference).
        evidence = { kind: "text", text: `Earlier${c.earlier.from ? ` (${c.earlier.from})` : ""}: ${c.earlier.answer ?? "—"}\nThen${c.other.from ? ` (${c.other.from})` : ""}: ${c.other.answer ?? "—"}`, caption: "Terms read from both replies" };
      } else {
        const a = (answersQ.data ?? []).find((x) => x.question_id === r.question_id && x.vendor_id === r.vendor_id);
        const loc = (r.evidence?.location ?? a?.location) as Loc | null;
        // Name the source the answer really came from: a sheet / PDF / photo → that file; plain text → the email when there is one.
        const own = files.filter((f) => f.response_id === r.response_id && f.file_kind !== "supporting");
        const fromFile = loc?.type === "text" && email(r.response_id) ? null : own.find((f) => loc?.sheet ? /\.xlsx?$|\.csv$/i.test(f.original_name) : loc?.type === "pdf" ? /\.pdf$/i.test(f.original_name) : true) ?? null;
        const snippet = (r.evidence?.snippet as string | undefined) ?? loc?.snippet ?? a?.answer_raw ?? r.detail ?? "";
        evidence = { kind: "text", text: snippet, mark: a?.answer_raw ?? undefined, caption: `Questionnaire answer · ${fromFile?.original_name ?? "email body"}` };
      }
    } else if (r.response_id) {
      const t = (termsQ.data ?? []).find((x) => x.response_id === r.response_id);
      const text = r.type === "fx_assumption" ? r.detail
        : r.type === "freight_treatment" ? t?.freight_terms_raw
        : r.type === "tax_basis" ? t?.tax_terms_raw
        : r.type === "validity_short" ? (t?.validity_days ? `Validity: ${t.validity_days} days` : t?.validity_until)
        : r.type === "discount_treatment" ? [t?.total_discount_pct && `${t.total_discount_pct}%`, t?.total_discount_condition].filter(Boolean).join(" ")
        : r.type === "missing_line" ? t?.other_notes
        : r.type === "prior_pricing" ? t?.references_prior_pricing_text ?? r.title.match(/“([^”]+)”/)?.[1] ?? r.detail // the vendor's words, not our note
        : r.type === "vendor_condition" ? ((r.evidence.conditions as { text: string }[] | undefined) ?? []).map((c) => c.text).join("\n") || r.detail
        : r.type === "total_mismatch" ? `Stated total: ${Number(r.evidence.stated).toLocaleString("en-IN")}\nSum of the lines: ${Number(r.evidence.sum).toLocaleString("en-IN")}`
        : r.detail;
      const qf = quoteFile(r.response_id);
      if (text) evidence = { kind: "text", text, caption: r.type === "fx_assumption" ? "Settings → FX rates" : `Terms read from ${qf?.original_name ?? "the email body"}` };
    }
    const name = v?.name ?? "The vendor";
    // "Enter prices…": the lines this card is about — "same as last year" lines, or the lines the vendor didn't quote.
    const gapState = r.type === "missing_line" ? "not_quoted" : "references_prior";
    const priced = gapCells.filter((c) => c.vendor_id === r.vendor_id && c.state === gapState).map((c) => lines.find((l) => l.id === c.rfx_line_id)).filter((l): l is RfxLine => !!l).sort((a, b) => a.line_no - b.line_no);
    const newest = (kind: string) => { const rows = (ledgerQ.data ?? []).filter((a) => a.vendor_id === r.vendor_id && a.kind === kind); return rows.find((a) => a.basis === "buyer_entered") ?? rows[0]; };
    const disc = r.type === "discount_treatment" ? (newest("discount_treatment")?.value as { pct?: number; kind?: string; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null } | undefined) : undefined;
    const qRow = r.question_id ? (questionsQ.data ?? []).find((q) => q.id === r.question_id) : undefined;
    const tax = r.type === "tax_basis" ? (termsQ.data ?? []).find((x) => x.response_id === r.response_id)?.tax_terms_raw as string | undefined : undefined;
    const disq = !!(questionsQ.data ?? []).find((q) => q.id === r.question_id)?.disqualify_if;
    // Likely lines first for "Move to line…": the same deterministic scorer the map stage shortlists with.
    const likely = it?.vendor_description ? shortlist({ vendor_sku: it.vendor_sku ?? null, vendor_description: it.vendor_description, notes: it.notes, location: it.location }, lines, 3).map((c) => c.line_no) : [];
    return {
      id: r.id, type: r.type, title: displayTitle(r, qRow?.answer_type), detail: r.detail, status: r.status, group: groupOf(r),
      if_nothing: ifNothing(r, name, lineNo.get(r.rfx_line_id ?? "") ?? null, priced.length, disq),
      ...(r.type === "prior_pricing" || r.type === "missing_line" ? { prior_lines: priced.map((l) => ({ line_no: l.line_no, description: l.description })) } : {}),
      buttons: buttonsFor({ ...r, answer_type: qRow?.answer_type }), grade: gradeOf(r),
      ...(r.type === "questionnaire_ambiguous" && qRow ? { missing_questions: [{ q_no: qRow.q_no, text: qRow.text, answer_type: qRow.answer_type }], ...(conflictOf(r) ? { conflict: conflictOf(r)! } : {}) } : {}),
      ...(r.type === "vendor_mismatch" || r.type === "unknown_vendor" ? { vendor_options: (invitedQ.data ?? []).filter((x) => x.vendor_id !== r.vendor_id).map((x) => ({ id: x.vendor_id as string, name: (x.vendors as unknown as { name: string }).name })).sort((a, b) => a.name.localeCompare(b.name)) } : {}),
      ...(r.type === "questionnaire_missing" ? { missing_questions: (answersQ.data ?? []).filter((a) => a.vendor_id === r.vendor_id && a.state === "missing").map((a) => (questionsQ.data ?? []).find((q) => q.id === a.question_id)).filter((q): q is NonNullable<typeof q> => !!q && q.mandatory).map((q) => ({ q_no: q.q_no, text: q.text, answer_type: q.answer_type })).sort((a, b) => a.q_no - b.q_no) } : {}),
      ...(r.type === "fx_assumption" ? { current: { rate: Number((newest("fx_rate")?.value as { rate?: number } | undefined)?.rate ?? 0) || undefined } } : {}),
      ...(r.type === "tax_basis" ? { current: { gst_pct: Number((rvQ.data ?? []).find((x) => x.vendor_id === r.vendor_id)?.gst_adjust_pct ?? 0) || Number(tax?.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? 18) } } : {}),
      ...(disc?.pct ? { current: { discount: { pct: Number(disc.pct), kind: disc.kind ?? (grossUp(r) ? "gross_up" : "unclear"), min_lines: disc.min_lines ?? null, min_value_inr: disc.min_value_inr ?? null, payment_days: disc.payment_days ?? null } } } : {}),
      vendor: v ? { id: v.id, code: v.short_code, name: v.name } : null, line_no: r.rfx_line_id ? lineNo.get(r.rfx_line_id) ?? null : null,
      probability: r.probability === null ? null : Number(r.probability), proposed_value: r.proposed_value === null ? null : Number(r.proposed_value),
      proposed_note: r.proposed_note, evidence, resolution: r.resolution, actions: actionsFor({ ...r, answer_type: qRow?.answer_type }),
      ...(r.type === "unmapped_item" || r.proposed_state === "mapped" ? { candidates: [...lines].sort((a, b) => Number(likely.includes(b.line_no)) - Number(likely.includes(a.line_no)) || (likely.indexOf(a.line_no) - likely.indexOf(b.line_no)) || a.line_no - b.line_no)
        .map((l) => ({ line_id: l.id, line_no: l.line_no, description: l.description, likely: likely.includes(l.line_no) })) } : {}),
    };
  }));
  const rank = (t: string) => (ORDER.indexOf(t) + 1 || 99);
  return items.sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || rank(a.type) - rank(b.type)
    || (a.vendor?.name ?? "").localeCompare(b.vendor?.name ?? "") || (a.line_no ?? 0) - (b.line_no ?? 0));
}

/** Stored titles lead with the vendor's words for two card types; the card shows a plain statement (their words are in the source). */
function displayTitle(r: Pick<Row, "type" | "title" | "evidence">, answerType?: string | null): string {
  if (r.type === "freight_treatment") return "Freight not included in the price";
  if (r.type === "prior_pricing") { const span = r.title.match(/^(Items? [\d–-]+):/)?.[1]; return `${span ?? "Some lines"}: no price, the vendor refers to earlier pricing`; }
  if (r.type === "questionnaire_ambiguous") {
    const q = r.title.match(/^Q\d+/)?.[0] ?? "Answer";
    const c = conflictOf(r);
    const part = (x: Conflict["earlier"]) => `“${(x.answer ?? "").slice(0, 50)}”${x.from ? ` (${x.from})` : ""}`;
    if (c) return `${q}: two different answers — ${part(c.earlier)} vs ${part(c.other)}`;
    const type = (r.evidence?.answer_type as string | undefined) ?? answerType;
    return `${q}: ${type === "number" ? "the number isn't clear" : type === "text" ? "the answer isn't clear" : "the answer isn't a clear yes or no"}`;
  }
  return r.title;
}

/** What stays true if the buyer never decides this card (shown under the title). */
export function ifNothing(r: Pick<Row, "type" | "proposed_state" | "proposed_value">, vendor: string, line: number | null, priorLines: number, disqualifying: boolean): string | null {
  const ln = line ? `Line ${line}` : "This line";
  switch (r.type) {
    case "ambiguous_unit": case "low_confidence_read": case "conflict":
      return r.proposed_state === "mapped" ? `The item stays on ${line ? `line ${line}` : "the line it was matched to"}.` : `${ln} isn't counted in totals.`;
    case "price_check": return "The price stays as read and counts in totals.";
    case "prior_pricing": return priorLines === 1 ? "This line counts as not quoted." : `These ${priorLines || ""} lines count as not quoted.`.replace("  ", " ");
    case "missing_line": return "Nothing changes: those lines stay not quoted.";
    case "unmapped_item": return "This item stays out of the grid.";
    case "freight_treatment": return r.proposed_value !== null ? `Landed prices for ${vendor} include ₹${r.proposed_value} per 1000 for freight.` : `Landed prices for ${vendor} leave freight out — the amount isn't stated.`;
    case "discount_treatment": {
      // P10: no Settings switch any more — say what happens to THIS discount.
      const x = r as { evidence?: Record<string, unknown> | null; title?: string };
      if (grossUp({ type: r.type, evidence: x.evidence ?? {}, title: x.title })) return `${vendor}'s prices stay grossed up to the rate we'd actually pay${r.proposed_value ? ` (+${r.proposed_value}%)` : ""}.`;
      const d = x.evidence?.discount as { kind?: string; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null } | undefined;
      const when = d?.kind === "all_lines" ? `${vendor} is awarded all the lines` : d?.kind === "min_lines" ? `${vendor} is awarded at least ${d.min_lines} lines`
        : d?.kind === "min_value" ? `${vendor}'s award is at least ₹${Number(d.min_value_inr).toLocaleString("en-IN")}` : d?.kind === "payment_days" ? `we pay within ${d.payment_days} days`
        : d?.kind === "none" ? `${vendor} wins any line` : null;
      return when ? `The ${r.proposed_value ?? ""}% comes off only in award options where ${when}; line prices stay as quoted.`.replace("The %", "The discount")
        : "The discount isn't applied anywhere until its condition is clear; line prices stay as quoted.";
    }
    case "fx_assumption": return "Prices stay converted at this rate.";
    case "tax_basis": return "Prices are compared as the vendor wrote them.";
    case "validity_short": return "The prices may expire before you award.";
    case "questionnaire_ambiguous": {
      const c = conflictOf(r as { type: string; evidence?: Record<string, unknown> | null; title?: string });
      if (c) return `${vendor}'s earlier answer (“${(c.earlier.answer ?? "").slice(0, 60)}”) stands.`;
      return disqualifying ? `${vendor} isn't counted as cleared, so their lines can't win.` : "The answer stays unclear; it doesn't block the vendor.";
    }
    case "questionnaire_missing": return `${vendor} stays not cleared while mandatory answers are missing.`;
    case "unknown_vendor": return "The reply isn't priced until it belongs to a vendor.";
    case "not_a_quote": return "Nothing is read from it.";
    case "vendor_condition": return `${vendor}'s prices stand, but this condition comes with them.`;
    case "total_mismatch": return "The line prices count as read; the vendor's total is ignored.";
    case "vendor_mismatch": return `${r.proposed_value ? `Its ${r.proposed_value} ${r.proposed_value === 1 ? "price stays" : "prices stay"}` : "It stays"} out of the grid and every total.`;
    default: return null;
  }
}

export type ActBody = { value?: number; reason?: string; line_id?: string; prices?: Record<string, number>;
  /** set-discount: what the discount depends on */ kind?: string; min_lines?: number | null; min_value_inr?: number | null; payment_days?: number | null;
  /** answer: q_no → the vendor's answer as the buyer heard it */ answers?: Record<string, string>; /** reassign */ vendor_id?: string };
export type ActResult = { status: string; draft?: Awaited<ReturnType<typeof draftClarification>> };

/** TRD §12.3 — one action on one review item; every call leaves an audit event. */
export async function act(itemId: string, action: Action, body: ActBody, user: SessionUser): Promise<ActResult> {
  if (!ACTIONS.includes(action)) throw new AppError("BAD_ACTION", `Unknown action ${action}`, undefined, 400);
  const { data: r, error } = await db().from("review_items").select("*").eq("id", itemId).maybeSingle<Row & { rfx_id: string }>();
  if (error) throw error;
  if (!r) throw new AppError("NOT_FOUND", "Review item not found", undefined, 404);
  // "asked_vendor" is waiting, not decided: the buyer can still decide without waiting for the reply.
  if (r.status !== "open" && r.status !== "asked_vendor") throw new AppError("ALREADY_DECIDED", "This item was already decided.", undefined, 409);
  const answerType = r.question_id ? (await db().from("rfx_questions").select("answer_type").eq("id", r.question_id).maybeSingle()).data?.answer_type ?? null : null;
  if (!actionsFor({ ...r, answer_type: answerType }).includes(action)) throw new AppError("BAD_ACTION", `“${action}” doesn't apply to a ${r.type.replaceAll("_", " ")} item.`, undefined, 400);
  const at = new Date().toISOString();
  const by = { reviewed_by: user.id, reviewed_at: at };
  let status = "confirmed";
  let resolution: Record<string, unknown> = { by: user.name, at };
  let draft: ActResult["draft"];

  const cell = async () => {
    const id = r.line_quote_id ?? (r.rfx_line_id && r.vendor_id
      ? (await db().from("line_quotes").select("id").eq("rfx_line_id", r.rfx_line_id).eq("vendor_id", r.vendor_id).maybeSingle()).data?.id : null);
    if (!id) throw new AppError("NO_CELL", "There is no grid cell behind this item.", undefined, 409);
    const { data } = await db().from("line_quotes").select("*").eq("id", id).single();
    return data as { id: string; rfx_line_id: string; vendor_id: string; state: string; unit_price_inr_per_1000: number | null; best_guess_value: number | null; conversion_chain: Step[] };
  };
  const ledger = (kind: string, description: string, value: unknown, extra: Record<string, unknown> = {}) =>
    db().from("assumptions").insert({ rfx_id: r.rfx_id, vendor_id: r.vendor_id, rfx_line_id: r.rfx_line_id, kind, description, value, basis: "buyer_entered", made_by: user.id, ...extra }).then(({ error: e }) => { if (e) throw e; });
  const patchCell = async (id: string, fields: Record<string, unknown>) => {
    const { error: e } = await db().from("line_quotes").update({ ...fields, ...by, updated_at: at }).eq("id", id);
    if (e) throw e;
  };
  // P10 B2: a per-vendor correction (rate, GST, discount) rescales that vendor's prices; landed keeps its freight gap.
  const rescale = async (factorOf: (c: { conversion_chain: Step[] }) => number | null, step: Step) => {
    const { data: cells } = await db().from("line_quotes").select("id, unit_price_inr_per_1000, landed_price_inr_per_1000, best_guess_value, conversion_chain").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!);
    let n = 0;
    for (const c of cells ?? []) {
      const chain = (c.conversion_chain as Step[] | null) ?? [];
      const f = factorOf({ conversion_chain: chain });
      if (f === null || (c.unit_price_inr_per_1000 === null && c.best_guess_value === null)) continue;
      const u0 = c.unit_price_inr_per_1000 === null ? null : Number(c.unit_price_inr_per_1000);
      const gap = u0 !== null && c.landed_price_inr_per_1000 !== null ? Number(c.landed_price_inr_per_1000) - u0 : 0;
      const u = u0 === null ? null : round2(u0 * f);
      const { error: e } = await db().from("line_quotes").update({ unit_price_inr_per_1000: u, landed_price_inr_per_1000: u === null ? null : round2(u + gap),
        best_guess_value: c.best_guess_value === null ? null : round2(Number(c.best_guess_value) * f), conversion_chain: [...chain, step], updated_at: at }).eq("id", c.id);
      if (e) throw e;
      n++;
    }
    return n;
  };
  /** Replace this vendor's active ledger row of a kind with the buyer's (normalise re-runs keep buyer rows). */
  const supersede = async (kind: string, description: string, value: Record<string, unknown>) => {
    const { data: old } = await db().from("assumptions").select("id").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("kind", kind).is("superseded_by", null);
    const { data: row, error: e } = await db().from("assumptions").insert({ rfx_id: r.rfx_id, vendor_id: r.vendor_id, kind, basis: "buyer_entered", made_by: user.id, description, value }).select("id").single();
    if (e) throw e;
    if (old?.length) await db().from("assumptions").update({ superseded_by: row.id }).in("id", old.map((a) => a.id));
  };
  const currentDiscount = async () => {
    const { data } = await db().from("assumptions").select("value, basis").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("kind", "discount_treatment").is("superseded_by", null).order("created_at", { ascending: false });
    return ((data ?? []).find((a) => a.basis === "buyer_entered") ?? data?.[0])?.value as { pct?: number; condition?: string | null; treatment?: string } | undefined;
  };
  const lineLabel = async () => r.rfx_line_id ? `Line ${(await db().from("rfx_lines").select("line_no").eq("id", r.rfx_line_id).single()).data?.line_no}` : "Vendor";

  switch (action) {
    case "confirm": {
      if (r.type === "vendor_mismatch") {
        const n = await releaseCells({ id: r.response_id!, rfx_id: r.rfx_id, vendor_id: r.vendor_id }, "reviewed", "Buyer confirmed the reply is from this vendor");
        await ledger("other", `Reply kept as this vendor's after the vendor check (${n} prices released) — ${r.detail ?? ""}`.trim(), { released: n });
        resolution = { ...resolution, note: `Kept as this vendor's reply · ${n} prices count` };
        break;
      }
      if (["ambiguous_unit", "low_confidence_read", "conflict"].includes(r.type) && r.proposed_state !== "mapped") {
        const c = await cell();
        const value = Number(r.proposed_value ?? c.best_guess_value);
        if (!Number.isFinite(value)) throw new AppError("NO_VALUE", "Nothing to confirm: enter a value with Override.", undefined, 400);
        await patchCell(c.id, { state: "reviewed", unit_price_inr_per_1000: value, landed_price_inr_per_1000: value + await freightFor(r.rfx_id, c.vendor_id), review_note: "Confirmed the system's value" });
        await ledger("other", `${await lineLabel()}: buyer confirmed the system's value ${money(value)} per 1000 (was ${c.state.replaceAll("_", " ")}).`, { before: { state: c.state, value: c.unit_price_inr_per_1000 }, after: { state: "reviewed", value } }, { line_quote_id: c.id });
        resolution = { ...resolution, value };
      } else if (r.proposed_state === "mapped") {
        const c = await cell();
        if (["confirmed", "inferred"].includes(c.state)) await patchCell(c.id, { state: "reviewed", review_note: "Mapping confirmed" });
      }
      break; // informational items: acknowledging just closes them (TRD §12.3)
    }
    case "override": {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value <= 0 || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Enter a value (₹ per 1000 pcs) and a reason.", undefined, 400);
      const c = await cell();
      const before = c.unit_price_inr_per_1000 ?? c.best_guess_value;
      await patchCell(c.id, { state: "reviewed", unit_price_inr_per_1000: value, landed_price_inr_per_1000: value + await freightFor(r.rfx_id, c.vendor_id), review_note: body.reason.trim(),
        conversion_chain: [...(c.conversion_chain ?? []), { step: "buyer_override", before, after: value, basis_kind: "buyer_entered" }] });
      await ledger("value_override", `${await lineLabel()}: buyer set ${money(value)} per 1000${before !== null ? ` (was ${money(Number(before))})` : ""} — ${body.reason.trim()}`, { before, after: value }, { line_quote_id: c.id });
      status = "overridden"; resolution = { ...resolution, value, note: body.reason.trim() };
      break;
    }
    case "exclude": {
      if (!body.reason?.trim()) throw new AppError("BAD_INPUT", "Say why this cell is excluded.", undefined, 400);
      if (r.type === "discount_treatment") { // leave the discount out of every award option
        const d = await currentDiscount();
        await supersede("discount_treatment", `${d?.pct ?? r.proposed_value}% total discount ignored by the buyer — ${body.reason.trim()}`, { ...d, treatment: "ignored" });
        status = "excluded"; resolution = { ...resolution, note: `Discount ignored — ${body.reason.trim()}` };
        break;
      }
      if (r.type === "vendor_mismatch") { // the whole reply: every cell it wrote
        const { data: ex, error: xe } = await db().from("line_quotes").update({ state: "excluded", unit_price_inr_per_1000: null, landed_price_inr_per_1000: null, best_guess_value: null, best_guess_note: null, review_note: body.reason.trim(), ...by })
          .eq("response_id", r.response_id!).neq("state", "not_quoted").select("id");
        if (xe) throw xe;
        await ledger("exclusion", `Whole reply excluded after the vendor check (${ex?.length ?? 0} lines) — ${body.reason.trim()}`, { reason: body.reason.trim(), lines: ex?.length ?? 0 });
        // P10: what that reply wrote goes with it — its other open cards close, its questionnaire answers are withdrawn.
        await db().from("review_items").update({ status: "dismissed", resolution: { by: user.name, at, note: "Closed with the excluded reply" }, updated_at: at })
          .eq("response_id", r.response_id!).in("status", ["open", "asked_vendor"]).neq("id", r.id);
        await db().from("questionnaire_answers").update({ state: "missing", answer_raw: null, answer_bool: null, answer_number: null, answer_text: null, passes: null, probability: null })
          .eq("response_id", r.response_id!).neq("state", "reviewed");
        status = "excluded"; resolution = { ...resolution, note: body.reason.trim() };
        break;
      }
      const c = await cell();
      await patchCell(c.id, { state: "excluded", unit_price_inr_per_1000: null, landed_price_inr_per_1000: null, review_note: body.reason.trim() });
      await ledger("exclusion", `${await lineLabel()}: excluded — ${body.reason.trim()}`, { reason: body.reason.trim() }, { line_quote_id: c.id });
      status = "excluded"; resolution = { ...resolution, note: body.reason.trim() };
      break;
    }
    case "accept-yes": case "treat-no": {
      const yes = action === "accept-yes";
      const { data: q } = await db().from("rfx_questions").select("q_no, disqualify_if").eq("id", r.question_id!).single();
      const { data: before } = await db().from("questionnaire_answers").select("state, answer_raw, passes").eq("question_id", r.question_id!).eq("vendor_id", r.vendor_id!).maybeSingle();
      const { error: e } = await db().from("questionnaire_answers").update({ state: "reviewed", answer_bool: yes, passes: passes(q?.disqualify_if ?? null, { bool: yes }), ...by })
        .eq("question_id", r.question_id!).eq("vendor_id", r.vendor_id!);
      if (e) throw e;
      // PRD #18: every decision that can change the outcome is in the ledger, with before/after.
      await ledger("other", `Q${q?.q_no}: buyer ${yes ? "accepted as Yes" : "treated as No"} (“${(before?.answer_raw ?? "").slice(0, 80)}”)${q?.disqualify_if ? ` — ${passes(q.disqualify_if, { bool: yes }) ? "passes" : "fails"} the disqualifying rule` : ""}.`,
        { question: q?.q_no, before: { state: before?.state, passes: before?.passes ?? null }, after: { answer: yes, passes: passes(q?.disqualify_if ?? null, { bool: yes }) } });
      status = yes ? "confirmed" : "overridden"; resolution = { ...resolution, value: yes ? 1 : 0, note: yes ? "Accepted as Yes" : "Treated as No" };
      break;
    }
    case "mark-not-quoted": {
      const { data: cells } = await db().from("line_quotes").select("id").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("state", "references_prior");
      for (const c of cells ?? []) await patchCell(c.id, { state: "not_quoted", review_note: "Prior pricing treated as not quoted" });
      await ledger("prior_pricing", `${cells?.length ?? 0} lines referring to earlier pricing treated as not quoted.`, { lines: cells?.length ?? 0 });
      status = "overridden"; resolution = { ...resolution, note: "Treated as not quoted" };
      break;
    }
    case "map": {
      if (!body.line_id || !r.extracted_item_id || !r.response_id) throw new AppError("BAD_INPUT", "Pick the RFx line this item belongs to.", undefined, 400);
      const [{ data: resp }, { data: line }] = await Promise.all([
        db().from("responses").select("summary").eq("id", r.response_id).single(),
        db().from("rfx_lines").select("id, line_no").eq("id", body.line_id).eq("rfx_id", r.rfx_id).single(),
      ]);
      if (!line) throw new AppError("BAD_INPUT", "That line isn't in this RFx.", undefined, 400);
      const summary = resp!.summary as { map?: MapSummary };
      const mapping = (summary.map?.mapping ?? []).filter((m) => m.item_id !== r.extracted_item_id)
        .concat({ item_id: r.extracted_item_id, line_id: line.id, line_no: line.line_no, p: 1, provider: "buyer", alternatives: [] });
      const { error: e } = await db().from("responses").update({ summary: { ...summary, map: { ...summary.map, mapping } } }).eq("id", r.response_id);
      if (e) throw e;
      await db().from("unmatched_items").update({ status: "mapped", mapped_line_id: line.id }).eq("extracted_item_id", r.extracted_item_id);
      await ledger("mapping_override", `Item mapped by the buyer to line ${line.line_no}.`, { line_no: line.line_no }, { rfx_line_id: line.id });
      const ev = await runStage(r.response_id, "normalise", user.id); // rebuilds this vendor's cells; buyer-decided cells stay
      if (ev.status === "error") throw new AppError("STAGE_ERROR", `Mapped, but re-normalising failed: ${ev.error}`, undefined, 500);
      resolution = { ...resolution, note: `Mapped to line ${line.line_no}` };
      break;
    }
    case "ignore": {
      if (r.extracted_item_id) await db().from("unmatched_items").update({ status: "ignored" }).eq("extracted_item_id", r.extracted_item_id);
      status = "dismissed"; resolution = { ...resolution, note: "Ignored" };
      break;
    }
    case "ask-vendor": {
      // TRD §12.3: a P-CLARIFY draft covering all this vendor's open askable cards; sending is POST /api/clarify/send.
      const { data: open } = await db().from("review_items").select("id").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("status", "open").in("type", ASKABLE);
      draft = await draftClarification(r.rfx_id, r.vendor_id!, [...new Set([r.id, ...(open ?? []).map((o) => o.id)])], user);
      return { status: r.status, draft };
    }
    case "dismiss": status = "dismissed"; break;
    case "enter-prices": {
      // "Not quoted": the buyer types the prices they hold (last year's PO, a phone call); blank lines stay not quoted.
      if (!body.reason?.trim()) throw new AppError("BAD_INPUT", "Say where the prices come from (goes in the ledger).", undefined, 400);
      const { data: cells } = await db().from("line_quotes").select("id, conversion_chain, rfx_line_id, rfx_lines(line_no)").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("state", r.type === "missing_line" ? "not_quoted" : "references_prior");
      const rows = (cells ?? []).map((c) => ({ ...c, line_no: (c.rfx_lines as unknown as { line_no: number }).line_no, v: Number(body.prices?.[String((c.rfx_lines as unknown as { line_no: number }).line_no)]) }));
      const given = rows.filter((c) => Number.isFinite(c.v) && c.v > 0);
      if (!given.length) throw new AppError("BAD_INPUT", "Enter at least one price (₹ per 1000 pcs).", undefined, 400);
      const freight = await freightFor(r.rfx_id, r.vendor_id!);
      for (const c of rows) {
        if (given.includes(c)) {
          await patchCell(c.id, { state: "reviewed", unit_price_inr_per_1000: c.v, landed_price_inr_per_1000: round2(c.v + freight), review_note: body.reason.trim(),
            conversion_chain: [...((c.conversion_chain as Step[] | null) ?? []), { step: "buyer_override", after: c.v, basis_kind: "buyer_entered" }] });
          await ledger("value_override", `Line ${c.line_no}: buyer entered ${money(c.v)} per 1000 — ${body.reason.trim()}`, { after: c.v }, { rfx_line_id: c.rfx_line_id, line_quote_id: c.id });
        } else await patchCell(c.id, { state: "not_quoted", review_note: "Left blank when the buyer entered prices" });
      }
      status = "overridden"; resolution = { ...resolution, note: `${given.length} of ${rows.length} prices entered — ${body.reason.trim()}` };
      break;
    }
    case "set-freight": {
      // Freight for this vendor only: stored on rfx_vendors (a re-run of normalise reads it) and in the ledger; landed prices recomputed.
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 0 || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Enter the freight (₹ per 1000 pcs, 0 if it's included) and a reason.", undefined, 400);
      const { error: e1 } = await db().from("rfx_vendors").update({ freight_assumption_inr_per_1000: value }).eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!);
      if (e1) throw e1;
      const { data: old } = await db().from("assumptions").select("id").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("kind", "freight_treatment").is("superseded_by", null);
      const { data: row, error: e2 } = await db().from("assumptions").insert({ rfx_id: r.rfx_id, vendor_id: r.vendor_id, kind: "freight_treatment", basis: "buyer_entered", made_by: user.id,
        description: `Freight set by the buyer: ₹${value} per 1000 pcs — ${body.reason.trim()}`, value: { inr_per_1000: value } }).select("id").single();
      if (e2) throw e2;
      if (old?.length) await db().from("assumptions").update({ superseded_by: row.id }).in("id", old.map((a) => a.id));
      const { data: cells } = await db().from("line_quotes").select("id, unit_price_inr_per_1000").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).not("unit_price_inr_per_1000", "is", null);
      for (const c of cells ?? []) {
        const { error: e3 } = await db().from("line_quotes").update({ landed_price_inr_per_1000: round2(Number(c.unit_price_inr_per_1000) + value), updated_at: at }).eq("id", c.id);
        if (e3) throw e3;
      }
      status = "overridden"; resolution = { ...resolution, value, note: `Freight ₹${value} per 1000 — ${body.reason.trim()}` };
      break;
    }
    case "set-fx": {
      // This vendor's rate instead of the company table: stored for re-runs, prices converted again from the rate each cell used.
      const rate = Number(body.value);
      if (!(rate > 0) || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Enter the rate (₹ per unit of the vendor's currency) and a reason.", undefined, 400);
      const used = (ch: Step[]) => [...ch].reverse().find((s) => (s.step === "buyer_fx" || s.step === "currency") && s.rate && s.rate !== 1)?.rate ?? null;
      const n = await rescale((c) => { const u = used(c.conversion_chain); return u ? rate / u : null; }, { step: "buyer_fx", rate, basis_kind: "buyer_entered" });
      const { error: e } = await db().from("rfx_vendors").update({ fx_rate_override: rate }).eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!);
      if (e) throw e;
      await supersede("fx_rate", `Rate set by the buyer: ${rate} — ${body.reason.trim()}`, { rate, date: at.slice(0, 10), source: "set by the buyer" });
      status = "overridden"; resolution = { ...resolution, value: rate, note: `Rate ${rate} for this vendor (${n} prices) — ${body.reason.trim()}` };
      break;
    }
    case "set-gst": {
      // Restate this vendor's prices on the RFx's GST basis: +18 adds GST, −18 takes it out, 0 compares as written.
      const pct = Number(body.value);
      if (!Number.isFinite(pct) || pct <= -100 || pct > 100 || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Enter the GST % to add (or a negative % to take out) and a reason.", undefined, 400);
      const { data: rv } = await db().from("rfx_vendors").select("gst_adjust_pct").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).single();
      const old = Number(rv?.gst_adjust_pct ?? 0);
      const n = await rescale(() => (1 + pct / 100) / (1 + old / 100), { step: "gst_adjust", pct, basis_kind: "buyer_entered" });
      const { error: e } = await db().from("rfx_vendors").update({ gst_adjust_pct: pct || null }).eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!);
      if (e) throw e;
      await supersede("tax_treatment", pct ? `Prices ${pct > 0 ? `+${pct}% GST added` : `${pct}% GST taken out`} to match the RFx — ${body.reason.trim()}` : `Prices compared as written — ${body.reason.trim()}`, { gst_adjust_pct: pct });
      status = "overridden"; resolution = { ...resolution, value: pct, note: `${pct ? `${pct > 0 ? "+" : ""}${pct}% GST` : "As written"} (${n} prices) — ${body.reason.trim()}` };
      break;
    }
    case "set-discount": {
      const pct = Number(body.value);
      if (!Number.isFinite(pct) || pct < 0 || pct >= 100 || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Enter the discount % and a reason.", undefined, 400);
      const d = await currentDiscount();
      if (d?.treatment === "gross_up") {
        // Rates printed net of a discount we won't earn: change the % the prices are grossed up by (0 = take the gross-up off).
        const oldPct = Number(d.pct ?? r.proposed_value ?? 0);
        const n = await rescale((c) => (c.conversion_chain.some((s) => s.step === "discount_gross_up") ? (1 - oldPct / 100) / (1 - pct / 100) : null), { step: "discount_gross_up", pct, basis_kind: "buyer_entered" });
        await supersede("discount_treatment", pct ? `Rates grossed up by ${pct}% (set by the buyer) — ${body.reason.trim()}` : `Gross-up removed by the buyer — ${body.reason.trim()}`, { ...d, pct, treatment: "gross_up" });
        resolution = { ...resolution, value: pct, note: `Gross-up ${pct}% (${n} prices) — ${body.reason.trim()}` };
      } else {
        const KINDS = ["all_lines", "min_lines", "min_value", "payment_days", "none"];
        if (!KINDS.includes(body.kind ?? "")) throw new AppError("BAD_INPUT", "Say what the discount depends on.", undefined, 400);
        await supersede("discount_treatment", `${pct}% total discount — condition set by the buyer (${body.kind}) — ${body.reason.trim()}`,
          { pct, condition: d?.condition ?? null, treatment: "per_award", kind: body.kind, min_lines: body.min_lines ?? null, min_value_inr: body.min_value_inr ?? null, payment_days: body.payment_days ?? null });
        resolution = { ...resolution, value: pct, note: `${pct}% · ${body.kind!.replaceAll("_", " ")} — ${body.reason.trim()}` };
      }
      status = "overridden";
      break;
    }
    case "answer": {
      // The vendor's answers as the buyer heard them (a phone call, a later email): written as reviewed, scored like any answer.
      const given = Object.entries(body.answers ?? {}).filter(([, v]) => String(v ?? "").trim());
      if (!given.length || !body.reason?.trim()) throw new AppError("BAD_INPUT", "Type at least one answer and where it comes from.", undefined, 400);
      const { data: qs } = await db().from("rfx_questions").select("id, q_no, answer_type, disqualify_if").eq("rfx_id", r.rfx_id);
      for (const [no, raw] of given) {
        const q = (qs ?? []).find((x) => String(x.q_no) === no);
        if (!q) continue;
        const txt = String(raw).trim();
        const bool = q.answer_type === "yes_no" ? /^y/i.test(txt) : undefined;
        const num = q.answer_type === "number" ? Number(txt.replace(/[^\d.]/g, "")) : undefined;
        const { error: e } = await db().from("questionnaire_answers").update({ state: "reviewed", answer_raw: txt, answer_bool: bool ?? null, answer_number: Number.isFinite(num) ? num : null,
          answer_text: q.answer_type === "text" ? txt : null, passes: passes(q.disqualify_if, { bool, num: Number.isFinite(num) ? num : null }), ...by }).eq("question_id", q.id).eq("vendor_id", r.vendor_id!);
        if (e) throw e;
      }
      await ledger("other", `Questionnaire answers entered by the buyer (${given.map(([n, v]) => `Q${n}: ${v}`).join("; ")}) — ${body.reason.trim()}`, { answers: body.answers });
      status = "overridden"; resolution = { ...resolution, note: `${given.length} answer${given.length === 1 ? "" : "s"} entered — ${body.reason.trim()}` };
      break;
    }
    case "reassign": {
      // The reply belongs to another vendor: its cells under this vendor go, the reply moves, and the pipeline runs again for its real vendor.
      if (!body.vendor_id || !r.response_id) throw new AppError("BAD_INPUT", "Pick the vendor this reply belongs to.", undefined, 400);
      const { data: v } = await db().from("vendors").select("name").eq("id", body.vendor_id).maybeSingle();
      if (!v) throw new AppError("BAD_INPUT", "That vendor doesn't exist.", undefined, 400);
      status = r.type === "vendor_mismatch" ? "overridden" : "confirmed"; resolution = { ...resolution, note: `Reply moved to ${v.name}` };
      // Decided first, so the re-run's flags stage (which clears its open cards) keeps this decision.
      await db().from("review_items").update({ status, resolution, updated_at: at }).eq("id", r.id);
      if (r.type === "vendor_mismatch") {
        // Everything the reply wrote under the wrong vendor goes (cells, its other open cards, its answers); the re-run writes it again under the right one.
        const { error: e } = await db().from("line_quotes").delete().eq("response_id", r.response_id); if (e) throw e;
        await db().from("review_items").delete().eq("response_id", r.response_id).in("status", ["open", "asked_vendor"]).neq("id", r.id);
        await db().from("questionnaire_answers").delete().eq("response_id", r.response_id).neq("state", "reviewed");
      }
      await ledger("other", `Reply moved to ${v.name} by the buyer.`, { from_vendor: r.vendor_id, to_vendor: body.vendor_id });
      await assignVendor(r.response_id, { vendor_id: body.vendor_id }, user);
      break;
    }
  }

  const { error: ue } = await db().from("review_items").update({ status, resolution, updated_at: at }).eq("id", r.id);
  if (ue) throw ue;
  await audit({ rfx_id: r.rfx_id, actor: user.id, event: `review.${action}`, entity_type: "review_item", entity_id: r.id, payload: { type: r.type, status, ...pick(action, body) } });
  return { status, draft };
}

/** Freight the landed price adds for this vendor: the ledger's freight_treatment amount, 0 when freight is included. */
async function freightFor(rfxId: string, vendorId: string): Promise<number> {
  const { data } = await db().from("assumptions").select("value").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("kind", "freight_treatment").is("superseded_by", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return Number((data?.value as { inr_per_1000?: number } | null)?.inr_per_1000 ?? 0);
}

/** Only the fields an action uses go into the audit trail. */
const pick = (a: Action, b: ActBody) => ["override", "set-freight", "set-fx", "set-gst"].includes(a) ? { value: b.value, reason: b.reason } : a === "exclude" ? { reason: b.reason } : a === "map" ? { line_id: b.line_id }
  : a === "enter-prices" ? { prices: b.prices, reason: b.reason } : a === "set-discount" ? { value: b.value, kind: b.kind, min_lines: b.min_lines, min_value_inr: b.min_value_inr, payment_days: b.payment_days, reason: b.reason }
  : a === "answer" ? { answers: b.answers, reason: b.reason } : a === "reassign" ? { vendor_id: b.vendor_id } : {};

export const isInformational = (type: string) => INFORMATIONAL.includes(type);
