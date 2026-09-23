import "server-only";
import { z } from "zod";
import { generateJSON, inlineFile, type Part } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { currencyCode } from "@/lib/normalise/fx";
import { cleanEmail } from "@/lib/preprocess/email";
import { splitPdf } from "@/lib/preprocess/pdf";
import { get } from "@/lib/storage";
import type { ResponseFile, ResponseRow, RfxLine } from "@/types/db";
import type { ClassifySummary } from "./classify";

// TRD §9.5 P-EXTRACT (verbatim) + one sentence describing our input format so locations use our refs.
const P_EXTRACT = `You are extracting a supplier's price quotation for a procurement comparison. The buyer issued an RFx with these line items (for context only — DO NOT map items to them, DO NOT convert units, DO NOT convert currency):
{rfx_lines_compact}

Extract EVERY quoted item exactly as the supplier wrote it. For each item capture:
- vendor_sku (if any), vendor_description (verbatim), quantity and quantity_unit if given,
- unit_price as a number exactly as written, price_unit_raw verbatim (e.g. "per box", "/1000 pcs", "per kg", "USD per thousand"),
- currency_raw verbatim (symbol or code) or null if not stated,
- pack_size and pack_size_unit if the supplier states pieces per box/bundle for that item,
- discount_pct if a line-level discount is stated, notes for any remark or footnote marker tied to the item,
- location: where in the document the item appears (sheet+cell ref for spreadsheets; page + short verbatim snippet + approximate bounding box [x0,y0,x1,y1] in 0-1 page coordinates for PDFs/images; line number + snippet for text),
- raw_confidence 0-1: your confidence that the numbers were read correctly (lower for blurry/obscured/ambiguous text).
Also extract supplier-level terms into "terms": currency, validity (days or date), freight terms verbatim and whether freight is included, tax terms and whether included, payment terms, any total-level discount with its condition (read footnotes and fine print carefully), any statement that prices reference a previous quote/contract ("same as last year", "as per previous PO") with the verbatim text, other notes, and the location of each.
Rules:
- Never skip an item because it seems irrelevant. Never merge two items.
- If a number is unreadable, still create the item with unit_price null, notes explaining, raw_confidence ≤ 0.3.
- If the document contains no prices at all, return items: [] and explain in terms.other_notes.
- Also report rows_with_prices: how many priced rows or price mentions the document shows in total (count them before listing items).
- Return ONLY JSON matching the schema.
{input_format}`;

const FORMAT = {
  sheet: `Input format: spreadsheet text, one line per row as "[row N] A1=value B1=value", each sheet headed === sheet "Name" ===; "(hidden)" marks hidden rows and "[comment: …]" a cell comment. Use location.type "cell" with sheet and ref (the price cell, e.g. "H14").`,
  doc: `Input format: document text with paragraphs "[p N] …" and table rows "[table t row r] a | b | c". Use location.type "text" with line = the paragraph number N (or the table row) and a short verbatim snippet.`,
  email: `Input format: email text, one line per "[l N] …". Use location.type "text" with line = N and a short verbatim snippet.`,
  pdf: `Input: a PDF. Use location.type "pdf" with page, a short verbatim snippet and bbox.`,
  image: `Input: a photo or image of the document. Use location.type "image" with a short verbatim snippet and bbox.`,
};

const n = z.number().nullable();
const s = z.string().nullable();
const Location = z.object({
  type: z.enum(["cell", "pdf", "image", "text"]),
  sheet: z.string().optional(), ref: z.string().optional(), page: z.number().int().optional(), line: z.number().int().optional(),
  bbox: z.array(z.number().min(0).max(1)).length(4).optional(),
  snippet: z.string(),
});
export const ExtractionResult = z.object({
  rows_with_prices: z.number().int().min(0),
  items: z.array(z.object({
    vendor_sku: s, vendor_description: z.string(), quantity: n, quantity_unit: s,
    unit_price: n, price_unit_raw: s, currency_raw: s, pack_size: n, pack_size_unit: s,
    discount_pct: n, notes: s, location: Location, raw_confidence: z.number().min(0).max(1),
  })),
  terms: z.object({
    currency: s, validity_days: n, validity_until: s, freight_terms_raw: s, freight_included: z.boolean().nullable(),
    tax_terms_raw: s, taxes_included: z.boolean().nullable(), payment_terms_raw: s, payment_days: n,
    total_discount_pct: n, total_discount_condition: s,
    references_prior_pricing: z.boolean(), references_prior_pricing_text: s, other_notes: s,
    location: Location.nullable(),
  }),
});
type Extraction = z.infer<typeof ExtractionResult>;
type Terms = Extraction["terms"];

const TEXT_CHUNK = 60_000; // TRD §8.2

export type ExtractSummary = { items: number; items_with_price: number; currencies: string[]; has_footnotes: boolean; sources: string[] };

/** TRD §8.2 — quotation files (and the email body when it carries prices) → extracted_items + response_terms. */
export async function extract(resp: ResponseRow): Promise<ExtractSummary> {
  const [{ data: files, error: fe }, { data: lines, error: le }] = await Promise.all([
    db().from("response_files").select("*").eq("response_id", resp.id).eq("file_kind", "quotation").order("created_at"),
    db().from("rfx_lines").select("*").eq("rfx_id", resp.rfx_id).order("line_no"),
  ]);
  if (fe || le) throw fe ?? le;
  const compact = (lines as RfxLine[]).map((l) =>
    `L${l.line_no} ${l.sku} ${l.description}${l.burst_factor ? ` BF${l.burst_factor}` : ""}`).join(" | ");
  const email = (resp.summary.classify as ClassifySummary | undefined)?.email;
  const useEmail = !!resp.email_text && !!email && (email.kind === "quotation" || email.contains_prices >= 0.5);

  type Source = { name: string; file: ResponseFile | null; chunks: { parts: Part[]; format: string }[] };
  const sources: Source[] = [];
  for (const f of files as ResponseFile[]) {
    if (f.derived_text_path) {
      const text = (await get("derived", f.derived_text_path)).toString("utf8");
      const format = text.startsWith("=== sheet") ? FORMAT.sheet : text.startsWith("[l ") ? FORMAT.email : FORMAT.doc;
      sources.push({ name: f.original_name, file: f, chunks: chunkText(text).map((t) => ({ parts: [{ text: t }], format })) });
    } else if (f.derived_image_paths?.length) {
      sources.push({ name: f.original_name, file: f, chunks: [{ parts: [inlineFile(await get("derived", f.derived_image_paths[0]), "image/png")], format: FORMAT.image }] });
    } else {
      const pdfs = await splitPdf(await get("raw", f.storage_path));
      sources.push({ name: f.original_name, file: f, chunks: pdfs.map((b) => ({ parts: [inlineFile(b, "application/pdf")], format: FORMAT.pdf })) });
    }
  }
  if (useEmail) sources.push({ name: "email body", file: null, chunks: [{ parts: [{ text: cleanEmail(resp.email_text!) }], format: FORMAT.email }] });

  // Sources run in parallel; chunks of one source run in order (TRD §7: large PDFs sequentially).
  const results = await Promise.all(sources.map(async (src) => {
    const out: Extraction[] = [];
    for (const c of src.chunks) {
      const ask = (extra = "") => generateJSON({
        tier: "strong", purpose: "extract", rfx_id: resp.rfx_id, response_id: resp.id, schema: ExtractionResult, temperature: 0.1,
        parts: [...c.parts, { text: P_EXTRACT.replace("{rfx_lines_compact}", compact).replace("{input_format}", c.format) + extra }],
      });
      let r = await ask();
      // Self-check: the model occasionally collapses a table (esp. photos) into one item. If it returned clearly fewer items
      // than the priced rows it says it sees, retry once with the mismatch spelled out and keep the fuller result.
      if (isShort(r)) {
        console.warn(`[stage:extract] ${src.name}: ${r.items.length} items for ${r.rows_with_prices} priced rows — retrying once`);
        const again = await ask(`\nYour previous answer listed ${r.items.length} items but you counted ${r.rows_with_prices} priced rows. List EVERY priced row as its own item.`);
        if (again.items.length > r.items.length) r = again;
      }
      out.push(r);
    }
    return { src, out };
  }));

  await clearExtraction(resp.id);

  const rows = results.flatMap(({ src, out }) => out.flatMap((r) => r.items.map((it) => ({ it, src }))))
    .map(({ it, src }, i) => ({
      response_id: resp.id, file_id: src.file?.id ?? null, item_index: i + 1,
      vendor_sku: it.vendor_sku, vendor_description: it.vendor_description, quantity: it.quantity, quantity_unit: it.quantity_unit,
      unit_price: it.unit_price, price_unit_raw: it.price_unit_raw, currency_raw: it.currency_raw,
      pack_size: it.pack_size, pack_size_unit: it.pack_size_unit, discount_pct: it.discount_pct, notes: it.notes,
      location: { ...it.location, ...(src.file ? { file_id: src.file.id } : { source: "email" }) },
      raw_confidence: it.raw_confidence,
    }));
  if (rows.length) {
    const { error } = await db().from("extracted_items").insert(rows);
    if (error) throw error;
  }

  // Terms precedence: quotation file > email text; disagreements noted (TRD §8.2).
  const fileTerms = results.filter((r) => r.src.file).flatMap((r) => r.out.map((o) => o.terms));
  const emailTerms = results.filter((r) => !r.src.file).flatMap((r) => r.out.map((o) => o.terms));
  const terms = mergeTerms([...fileTerms, ...emailTerms]);
  const { error: te } = await db().from("response_terms").insert({
    response_id: resp.id, ...terms,
    currency: currencyCode(terms.currency) ?? terms.currency,
    validity_until: /^\d{4}-\d{2}-\d{2}$/.test(terms.validity_until ?? "") ? terms.validity_until : null,
    validity_days: terms.validity_days === null ? null : Math.round(terms.validity_days),
    payment_days: terms.payment_days === null ? null : Math.round(terms.payment_days),
  });
  if (te) throw te;

  const currencies = [...new Set(rows.map((r) => currencyCode(r.currency_raw) ?? r.currency_raw).filter((c): c is string => !!c))];
  return {
    items: rows.length,
    items_with_price: rows.filter((r) => r.unit_price !== null).length,
    currencies,
    has_footnotes: !!(terms.total_discount_condition || rows.some((r) => r.notes)),
    sources: sources.map((s) => s.name),
  };
}

/** Fewer items than priced rows the model itself counted (by 3+ and a third or more). Exported for the unit test. */
export const isShort = (r: { rows_with_prices: number; items: unknown[] }) => r.rows_with_prices - r.items.length >= 3 && r.items.length < r.rows_with_prices * 0.67;

/** Idempotency: this stage owns extracted_items and response_terms for the response. */
async function clearExtraction(responseId: string) {
  const { data: old } = await db().from("extracted_items").select("id").eq("response_id", responseId);
  const ids = (old ?? []).map((r) => r.id);
  if (ids.length) {
    // Later stages point at items; unlink before deleting (they rebuild on their own re-run).
    await db().from("line_quotes").update({ extracted_item_id: null }).in("extracted_item_id", ids);
    await db().from("review_items").update({ extracted_item_id: null }).in("extracted_item_id", ids);
    const { error } = await db().from("extracted_items").delete().eq("response_id", responseId);
    if (error) throw error;
  }
  const { error } = await db().from("response_terms").delete().eq("response_id", responseId);
  if (error) throw error;
}

/** First source wins each field; a later source that disagrees is recorded in other_notes. */
export function mergeTerms(all: Terms[]): Terms {
  if (!all.length) return { ...EMPTY_TERMS, other_notes: "No quotation terms found." };
  const out: Terms = { ...all[0] };
  const notes = all.map((t) => t.other_notes).filter(Boolean) as string[];
  for (const t of all.slice(1)) {
    for (const k of Object.keys(t) as (keyof Terms)[]) {
      if (k === "other_notes" || k === "location" || k === "references_prior_pricing") continue;
      const a = out[k], b = t[k];
      if (a === null || a === undefined) (out as Record<string, unknown>)[k] = b;
      else if (b !== null && b !== undefined && String(a) !== String(b)) notes.push(`Another source states ${k} = ${b}`);
    }
    out.references_prior_pricing ||= t.references_prior_pricing;
    out.references_prior_pricing_text ??= t.references_prior_pricing_text;
  }
  out.other_notes = [...new Set(notes)].join(" · ") || null;
  return out;
}

const EMPTY_TERMS: Terms = {
  currency: null, validity_days: null, validity_until: null, freight_terms_raw: null, freight_included: null, tax_terms_raw: null,
  taxes_included: null, payment_terms_raw: null, payment_days: null, total_discount_pct: null, total_discount_condition: null,
  references_prior_pricing: false, references_prior_pricing_text: null, other_notes: null, location: null,
};

/** > 60,000 chars → row chunks that each repeat the first 12 lines (headers). */
// ponytail: fixed 12-line header guess; detect the real header row if long sheets start losing column context.
export function chunkText(text: string, max = TEXT_CHUNK): string[] {
  if (text.length <= max) return [text];
  const lines = text.split("\n");
  const head = lines.slice(0, 12).join("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const line of lines.slice(12)) {
    if (head.length + cur.join("\n").length + line.length > max && cur.length) { chunks.push(`${head}\n${cur.join("\n")}`); cur = []; }
    cur.push(line);
  }
  if (cur.length) chunks.push(`${head}\n${cur.join("\n")}`);
  return chunks;
}
