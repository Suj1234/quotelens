import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildEvidence, type Evidence } from "@/lib/evidence";
import { basisLabel, stepText, type CellState, type Loc, type Step } from "@/lib/comparison";
import type { MapSummary } from "@/lib/pipeline/map";
import type { ResponseFile } from "@/types/db";

// TRD §16 GET /api/rfx/{id}/cell/{line}/{vendor} → provenance drawer payload (TRD §17.10, DESIGN §2.9).
export type CellDetail = {
  line: { no: number; description: string; sku: string }; vendor: { code: string; name: string };
  state: CellState; unit: number | null; landed: number | null; best_guess: number | null; note: string | null;
  original: { value: number | null; unit: string | null; currency: string | null } | null;
  evidence: Evidence | null;
  mapping: { p: number; provider_label: string; options: { line_no: number; description: string; p: number }[] } | null;
  chain: { text: string; basis: string; assumption: string | null; href?: string }[];
  reviews: { id: string; type: string; title: string; status: string; note: string | null }[];
  reviewed: { by: string; at: string; note: string | null } | null;
};

export const providerLabel = (p: string | null) => (p === "jev-openrouter" ? "measured (Jev)" : "LLM-estimated (Gemini)");

export async function getCellDetail(rfxId: string, lineNo: number, vendorCode: string): Promise<CellDetail> {
  const [{ data: line }, { data: vendor }] = await Promise.all([
    db().from("rfx_lines").select("id, line_no, description, sku").eq("rfx_id", rfxId).eq("line_no", lineNo).maybeSingle(),
    db().from("vendors").select("id, name, short_code").eq("short_code", vendorCode).maybeSingle(),
  ]);
  if (!line || !vendor) throw new AppError("NOT_FOUND", "No such line or vendor", undefined, 404);
  const { data: cell, error } = await db().from("line_quotes").select("*, extracted_items(*), responses(id, email_text, summary), users:reviewed_by(name)")
    .eq("rfx_line_id", line.id).eq("vendor_id", vendor.id).maybeSingle();
  if (error) throw error;
  if (!cell) throw new AppError("NOT_FOUND", "No cell for this line and vendor yet", undefined, 404);

  const item = cell.extracted_items as { id: string; file_id: string | null; location: Loc } | null;
  const resp = cell.responses as { id: string; email_text: string | null; summary: Record<string, unknown> } | null;
  const [fileQ, lineQ, assumpQ, reviewQ] = await Promise.all([
    item?.file_id ? db().from("response_files").select("*").eq("id", item.file_id).maybeSingle() : Promise.resolve({ data: null }),
    db().from("rfx_lines").select("line_no, description").eq("rfx_id", rfxId),
    db().from("assumptions").select("id, kind, description").eq("rfx_id", rfxId).eq("vendor_id", vendor.id).is("superseded_by", null),
    db().from("review_items").select("id, type, title, status, resolution").eq("rfx_id", rfxId).eq("vendor_id", vendor.id).eq("rfx_line_id", line.id).order("created_at"),
  ]);
  const evidence = item ? await buildEvidence(item.location, (fileQ.data as ResponseFile | null) ?? null, resp?.email_text ?? null, item.id) : null;

  const entry = (resp?.summary.map as MapSummary | undefined)?.mapping.find((m) => m.item_id === item?.id && m.line_no === lineNo);
  const desc = (n: number) => (lineQ.data ?? []).find((l) => l.line_no === n)?.description ?? "";
  const mapping = entry ? {
    p: entry.p, provider_label: providerLabel(entry.provider),
    options: [{ line_no: lineNo, description: desc(lineNo), p: entry.p }, ...entry.alternatives.slice(0, 2).map((a) => ({ line_no: a.line_no, description: desc(a.line_no), p: a.p }))],
  } : null;

  const assumptions = new Map((assumpQ.data ?? []).map((a) => [a.id, a.description as string]));
  const chain = ((cell.conversion_chain ?? []) as Step[]).map((s) => ({ text: stepText(s), basis: basisLabel(s), assumption: s.assumption_id ? assumptions.get(s.assumption_id) ?? null : null,
    ...(s.step === "clarification" && s.response_id ? { href: `/rfx/${rfxId}/responses/${s.response_id}` } : {}) }));
  const reviewer = cell.users as { name: string } | null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    line: { no: line.line_no, description: line.description, sku: line.sku }, vendor: { code: vendor.short_code, name: vendor.name },
    state: cell.state, unit: n(cell.unit_price_inr_per_1000), landed: n(cell.landed_price_inr_per_1000), best_guess: n(cell.best_guess_value), note: cell.best_guess_note,
    original: cell.original_value !== null || cell.original_unit ? { value: n(cell.original_value), unit: cell.original_unit, currency: cell.original_currency } : null,
    evidence, mapping, chain,
    reviews: (reviewQ.data ?? []).map((r) => ({ id: r.id, type: r.type, title: r.title, status: r.status, note: (r.resolution as { note?: string } | null)?.note ?? null })),
    reviewed: cell.reviewed_at ? { by: reviewer?.name ?? "buyer", at: cell.reviewed_at, note: cell.review_note }
      : cell.state === "reviewed" && cell.review_note ? { by: `${vendor.name} (clarification reply)`, at: cell.updated_at, note: cell.review_note } : null,
  };
}
