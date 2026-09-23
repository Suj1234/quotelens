import "server-only";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import type { RfxLine } from "@/types/db";

// TRD §16 GET /api/rfx/{id}/comparison — the grid model (DESIGN §2.6–2.8).
export type CellState = "confirmed" | "inferred" | "reviewed" | "low_confidence" | "ambiguous" | "not_quoted" | "references_prior" | "excluded" | "conflict";
export type Step = { step: string; from?: string | null; to?: string; factor?: number; rate?: number; rate_date?: string; pct?: number; basis?: string; basis_kind?: string; assumption_id?: string; before?: number; after?: number };
export type Loc = { type?: string; sheet?: string; ref?: string; page?: number; line?: number; snippet?: string; source?: string; file_id?: string; bbox?: number[] };

export type GridCell = {
  line_no: number; vendor: string; state: CellState; unit: number | null; landed: number | null; best_guess: number | null;
  original: { value: number | null; unit: string | null; currency: string | null } | null; tip: string;
};
export type GridVendor = {
  id: string; code: string; name: string; cleared: boolean | null; cleared_note: string; priced: number; lines: number;
  freight_included: boolean | null; currency: string | null; validity_days: number | null; validity_short: boolean;
  total_unit: number; total_landed: number;
};
export type GridLine = { id: string; line_no: number; sku: string; description: string; annual_qty: number; delivery_location: string };
export type Grid = { lines: GridLine[]; vendors: GridVendor[]; cells: GridCell[]; validity_requested: number };

export const COUNTED: CellState[] = ["confirmed", "inferred", "reviewed"]; // states that count in totals and "lowest"

const UNIT_LABEL: Record<string, string> = { per_1000_pcs: "per 1000", per_100_pcs: "per 100", per_piece: "per piece", per_box: "per box", per_bundle: "per bundle", per_kg: "per kg", per_tonne: "per tonne", per_set: "per set" };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 4 }));

/** One sentence per conversion step (tooltip, drawer chain). */
export function stepText(s: Step): string {
  switch (s.step) {
    case "line_discount": return `Less ${s.pct}% line discount`;
    case "discount_gross_up": return `÷ ${fmt(1 - (s.pct ?? 0) / 100)}: printed net of a ${s.pct}% discount we won't earn`;
    case "unit": return `${UNIT_LABEL[s.from ?? ""] ?? s.from} → per 1000 pcs: × ${fmt(s.factor ?? 1)} (${s.basis ?? "ratio"})`;
    case "currency": return s.from ? `${s.from} → ${s.to} at ${s.rate}${s.rate_date ? ` (${s.rate_date})` : ""}` : `Currency not stated; assumed ${s.to}`;
    case "buyer_override": return `Buyer set ${s.after !== undefined ? money(s.after) : "a value"}${s.before !== undefined && s.before !== null ? ` (was ${money(s.before)})` : ""}`;
    default: return s.step.replaceAll("_", " ");
  }
}

/** "vendor stated" / "RFx spec" / "assumption · fx_rate" / "buyer entered" (DESIGN §2.9). */
export function basisLabel(s: Step): string {
  if (s.step === "buyer_override") return "buyer entered";
  if (s.step === "currency") return s.from ? "assumption · fx_rate" : "assumption";
  if (s.step === "discount_gross_up") return "assumption · discount";
  if (s.basis_kind === "rfx_spec") return "RFx spec";
  if (s.basis_kind === "system_inferred") return "best guess";
  return "vendor stated";
}

/** Where the number was read, in one line: "Cell G8 · Price Offer", "Page 1: “…”", "Photo: “…”", "Para 5: “…”". */
export function whereText(l: Loc | null | undefined): string {
  if (!l) return "";
  const q = l.snippet ? `“${l.snippet.slice(0, 48)}${l.snippet.length > 48 ? "…" : ""}”` : "";
  if (l.type === "cell") return `Cell ${l.ref ?? "?"}${l.sheet ? ` · ${l.sheet}` : ""}`;
  if (l.type === "pdf") return `Page ${l.page ?? "?"}${q ? `: ${q}` : ""}`;
  if (l.type === "image") return `Photo${q ? `: ${q}` : ""}`;
  return `${l.source === "email" ? "Email line" : "Para"} ${l.line ?? "?"}${q ? `: ${q}` : ""}`;
}

export async function getComparison(rfxId: string): Promise<Grid> {
  const [rfxQ, linesQ, statusQ, cellsQ, respQ, qaQ] = await Promise.all([
    db().from("rfx").select("validity_days_requested").eq("id", rfxId).single(),
    db().from("rfx_lines").select("id, line_no, sku, description, annual_qty, delivery_location").eq("rfx_id", rfxId).order("line_no"),
    db().from("v_vendor_status").select("*").eq("rfx_id", rfxId),
    db().from("line_quotes").select("rfx_line_id, vendor_id, response_id, state, unit_price_inr_per_1000, landed_price_inr_per_1000, best_guess_value, best_guess_note, original_value, original_unit, original_currency, conversion_chain, extracted_items(location)").eq("rfx_id", rfxId),
    db().from("responses").select("id, vendor_id, received_at, response_terms(currency, validity_days, validity_until, freight_included)").eq("rfx_id", rfxId).order("received_at", { ascending: false }),
    db().from("questionnaire_answers").select("vendor_id, state, passes, answer_raw, rfx_questions(q_no, disqualify_if, mandatory)").eq("rfx_id", rfxId),
  ]);
  for (const q of [rfxQ, linesQ, statusQ, cellsQ, respQ, qaQ]) if (q.error) throw q.error;
  const lines = (linesQ.data as Pick<RfxLine, "id" | "line_no" | "sku" | "description" | "annual_qty" | "delivery_location">[]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const requested = rfxQ.data!.validity_days_requested as number;

  type Row = { vendor_id: string; vendor: string; vendor_code: string; cleared_questionnaire: boolean | null; lines_total: number; freight_included: boolean | null };
  const statuses = (statusQ.data as Row[]).sort((a, b) => a.vendor.localeCompare(b.vendor));
  const codeOf = new Map(statuses.map((s) => [s.vendor_id, s.vendor_code]));

  const cells: GridCell[] = (cellsQ.data ?? []).flatMap((c) => {
    const line = lineById.get(c.rfx_line_id), code = codeOf.get(c.vendor_id);
    if (!line || !code) return [];
    const chain = (c.conversion_chain ?? []) as Step[];
    const loc = (c.extracted_items as unknown as { location: Loc } | null)?.location;
    const state = c.state as CellState;
    const tip = chain.length ? stepText(chain[0]).slice(0, 80)
      : state === "not_quoted" ? "Vendor did not quote this line"
      : state === "references_prior" ? `“${(c.best_guess_note ?? "same as before").slice(0, 60)}”`
      : whereText(loc);
    return [{
      line_no: line.line_no, vendor: code, state, unit: num(c.unit_price_inr_per_1000), landed: num(c.landed_price_inr_per_1000), best_guess: num(c.best_guess_value),
      original: c.original_value !== null || c.original_unit ? { value: num(c.original_value), unit: c.original_unit, currency: c.original_currency } : null,
      tip,
    }];
  });

  const qa = (qaQ.data ?? []) as unknown as { vendor_id: string; state: string; passes: boolean | null; answer_raw: string | null; rfx_questions: { q_no: number; disqualify_if: string | null; mandatory: boolean } }[];
  const vendors: GridVendor[] = statuses.map((s) => {
    const mine = cells.filter((c) => c.vendor === s.vendor_code && COUNTED.includes(c.state));
    // Header terms come from the reply that supplied most of this vendor's cells, not simply the latest reply (a stray file mustn't relabel the vendor).
    const owners = (cellsQ.data ?? []).filter((c) => c.vendor_id === s.vendor_id && c.response_id).map((c) => c.response_id as string);
    const main = owners.sort((a, b) => owners.filter((x) => x === b).length - owners.filter((x) => x === a).length)[0];
    const resp = (respQ.data ?? []).find((r) => r.id === main) ?? (respQ.data ?? []).find((r) => r.vendor_id === s.vendor_id);
    const terms = resp?.response_terms as unknown as { currency: string | null; validity_days: number | null; validity_until: string | null; freight_included: boolean | null }[] | undefined;
    const t = terms?.[0];
    const answers = qa.filter((a) => a.vendor_id === s.vendor_id && a.rfx_questions.disqualify_if);
    const failing = answers.filter((a) => a.passes === false).map((a) => `Q${a.rfx_questions.q_no}: ${a.answer_raw ?? "no"}`);
    const pending = answers.filter((a) => a.state === "ambiguous").map((a) => `Q${a.rfx_questions.q_no} unclear`);
    const missing = answers.filter((a) => a.state === "missing" && a.rfx_questions.mandatory).map((a) => `Q${a.rfx_questions.q_no} not answered`);
    const annual = (c: GridCell, v: number | null) => (v ?? 0) * (lines.find((l) => l.line_no === c.line_no)!.annual_qty) / 1000;
    return {
      id: s.vendor_id, code: s.vendor_code, name: s.vendor, cleared: s.cleared_questionnaire,
      cleared_note: s.cleared_questionnaire === true ? "Cleared the questionnaire" : [...failing, ...missing, ...pending].join(" · ") || "Questionnaire not read yet",
      priced: mine.length, lines: s.lines_total, freight_included: t?.freight_included ?? s.freight_included, currency: t?.currency ?? null,
      validity_days: t?.validity_days ?? null, validity_short: !!t?.validity_days && t.validity_days < requested,
      total_unit: mine.reduce((a, c) => a + annual(c, c.unit), 0), total_landed: mine.reduce((a, c) => a + annual(c, c.landed), 0),
    };
  });
  return { lines, vendors, cells, validity_requested: requested };
}
