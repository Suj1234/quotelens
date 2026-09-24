import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { createVendor } from "@/lib/vendors";
import { UNTITLED } from "@/lib/rfx-list";
import { todayIST } from "@/lib/format";
import type { Rfx, RfxLine, RfxQuestion } from "@/types/db";

// New RFx (TRD §16 POST/GET/PATCH /api/rfx, §17.3; DESIGN §3.3). A draft is editable until it is issued (version 1).

/** The one category this workspace sources (P9 B8/B12; the brief: "you'll pick the category"). */
export const CATEGORY = "Corrugated packaging";
/** The co-pilot's first message (shown on an empty conversation; given to the model as its own opening turn). */
export const openingLine = (buyer: string) =>
  `Hi ${buyer}. Let's set up a new RFx for ${CATEGORY.toLowerCase()}. What should we call it, and what is it for — roughly how many items, which plants, and how long a contract? If you have last year's line sheet, attach it and I'll take the line items from it.`;

export type DraftVendor = { vendor_id: string; name: string; email: string; short_code: string; city: string | null };
// `questions` only on transcripts from before P9; `patch` = "Label · detail" lines built from the actions that succeeded;
// role "event" = the buyer changed the draft by hand (P9: the co-pilot must know, e.g. before re-importing a sheet).
export type Turn = { role: "buyer" | "copilot" | "event"; text: string; questions?: string[]; patch?: string; attachments?: string[]; at: string };
export type Draft = {
  rfx: Rfx & { terms_set: boolean };
  lines: RfxLine[]; questions: RfxQuestion[]; vendors: DraftVendor[];
  addressBook: DraftVendor[];
};

export async function getDraft(id: string): Promise<Draft> {
  const [r, l, q, v, book] = await Promise.all([
    db().from("rfx").select("*").eq("id", id).maybeSingle(),
    db().from("rfx_lines").select("*").eq("rfx_id", id).order("line_no"),
    db().from("rfx_questions").select("*").eq("rfx_id", id).order("q_no"),
    db().from("rfx_vendors").select("vendors(id, name, email, short_code, city)").eq("rfx_id", id),
    db().from("vendors").select("id, name, email, short_code, city").order("name"),
  ]);
  for (const x of [r, l, q, v, book]) if (x.error) throw x.error;
  if (!r.data) throw new AppError("NOT_FOUND", "RFx not found", undefined, 404);
  const asV = (x: { id: string; name: string; email: string; short_code: string; city: string | null }): DraftVendor => ({ vendor_id: x.id, name: x.name, email: x.email, short_code: x.short_code, city: x.city });
  return {
    rfx: r.data as Draft["rfx"], lines: l.data as RfxLine[], questions: q.data as RfxQuestion[],
    vendors: (v.data ?? []).map((x) => asV(x.vendors as unknown as Parameters<typeof asV>[0])).sort((a, b) => a.name.localeCompare(b.name)),
    addressBook: (book.data ?? []).map(asV),
  };
}

/** Next code in the MER-#### series (codes are unique; one retry covers a race). */
async function nextCode(): Promise<string> {
  const { data } = await db().from("rfx").select("code").like("code", "MER-%");
  const max = Math.max(0, ...(data ?? []).map((r) => Number(r.code.slice(4)) || 0));
  return `MER-${String(max + 1).padStart(4, "0")}`;
}

export async function createDraft(o: { title?: string; category?: string }, user: { id: string }): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = await nextCode();
    const { data, error } = await db().from("rfx").insert({
      code, title: o.title?.trim() || UNTITLED, category: o.category?.trim() || CATEGORY, buyer_id: user.id, status: "draft", version: 0,
    }).select("id").single();
    if (!error) {
      await audit({ rfx_id: data.id, actor: user.id, event: "rfx.created", entity_type: "rfx", entity_id: data.id, payload: { code } });
      return data.id as string;
    }
    if (error.code !== "23505") throw error; // unique violation → another draft took the code; try the next one
  }
  throw new AppError("CONFLICT", "Couldn't allocate an RFx code; try again.", undefined, 409);
}

const num = z.number().nullable().optional();
export const LineInput = z.object({
  sku: z.string().trim().max(60).nullable().optional(), description: z.string().trim().min(1, "Every line needs a description.").max(300),
  ply: z.number().int().nullable().optional(), length_mm: num, width_mm: num, height_mm: num, gsm_spec: z.string().max(80).nullable().optional(),
  burst_factor: z.number().int().nullable().optional(), item_type: z.string().max(30).nullable().optional(), weight_per_piece_g: num,
  monthly_qty: z.number().int().min(0).nullable().optional(), annual_qty: z.number().int().min(0).nullable().optional(),
  delivery_location: z.string().trim().max(60).nullable().optional(), draft: z.boolean().optional(),
});
export const QuestionInput = z.object({
  text: z.string().trim().min(1, "A question can't be empty.").max(500), answer_type: z.enum(["yes_no", "number", "text"]),
  mandatory: z.boolean(), disqualify_if: z.string().trim().max(40).nullable().optional(),
});
export const HeaderInput = z.object({
  title: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(100), cover_note: z.string().max(4000).nullable(),
  currency: z.string().length(3), quote_unit: z.enum(["per_1000_pcs", "per_piece", "per_kg", "per_box"]), incoterm: z.enum(["delivered", "ex_works", "fob"]),
  freight_included_requested: z.boolean(), tax_basis: z.enum(["excl_gst", "incl_gst"]), payment_terms_days: z.number().int().min(0).max(365), validity_days_requested: z.number().int().min(1).max(365),
  contract_months: z.number().int().min(1).max(60), response_deadline: z.iso.date().nullable(), delivery_locations: z.array(z.string().trim().min(1)).max(20),
}).partial();
export const PatchBody = z.object({
  header: HeaderInput.optional(), terms_set: z.boolean().optional(),
  lines: z.array(LineInput).max(500).optional(),
  questions: z.array(QuestionInput).max(50).optional(),
  vendors: z.object({ vendor_ids: z.array(z.uuid()).max(50), new: z.array(z.object({ name: z.string(), email: z.string() })).max(20).optional() }).optional(),
});
export type PatchBody = z.infer<typeof PatchBody>;

/** Edits are allowed only while the RFx is a draft (TRD §16 PATCH "draft only"). */
export async function assertDraft(id: string) {
  const { data } = await db().from("rfx").select("id, code, status, version").eq("id", id).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "RFx not found", undefined, 404);
  if (data.status !== "draft" || data.version !== 0) throw new AppError("FROZEN", `${data.code} is issued (v${data.version} frozen); its lines, terms, questionnaire and vendors can't change.`, undefined, 409);
  return data as { id: string; code: string; status: string; version: number };
}

/** A stored line (or a parsed/drafted one) as PATCH input; whole-number columns are rounded. */
type Num = number | null | undefined;
type LineLike = {
  description: string; sku?: string | null; ply?: Num; length_mm?: Num; width_mm?: Num; height_mm?: Num; gsm_spec?: string | null; burst_factor?: Num;
  item_type?: string | null; weight_per_piece_g?: Num; monthly_qty?: Num; annual_qty?: Num; delivery_location?: string | null; draft?: boolean; spec_attributes?: unknown;
};
export function lineInput(l: LineLike): z.infer<typeof LineInput> {
  const int = (v: Num) => (v === null || v === undefined ? null : Math.round(v));
  return {
    sku: l.sku ?? null, description: l.description, ply: int(l.ply), length_mm: l.length_mm ?? null, width_mm: l.width_mm ?? null, height_mm: l.height_mm ?? null,
    gsm_spec: l.gsm_spec ?? null, burst_factor: int(l.burst_factor), item_type: l.item_type ?? null, weight_per_piece_g: l.weight_per_piece_g ?? null,
    monthly_qty: int(l.monthly_qty), annual_qty: int(l.annual_qty), delivery_location: l.delivery_location ?? null,
    draft: l.draft ?? !!(l.spec_attributes as { draft?: boolean } | undefined)?.draft,
  };
}

const lineRow = (rfxId: string, l: z.infer<typeof LineInput>, i: number, fallbackLoc: string) => ({
  rfx_id: rfxId, line_no: i + 1, sku: l.sku?.trim() || `LINE-${i + 1}`, description: l.description,
  ply: l.ply ?? null, length_mm: l.length_mm ?? null, width_mm: l.width_mm ?? null, height_mm: l.height_mm ?? null,
  gsm_spec: l.gsm_spec ?? null, burst_factor: l.burst_factor ?? null, item_type: l.item_type ?? null, weight_per_piece_g: l.weight_per_piece_g ?? null,
  monthly_qty: l.monthly_qty ?? 0, annual_qty: l.annual_qty ?? (l.monthly_qty ?? 0) * 12, // TRD §17.3 annual = monthly × 12, editable
  delivery_location: l.delivery_location?.trim() || fallbackLoc, spec_attributes: l.draft ? { draft: true } : {},
});

/** Lines, questions and vendors are replaced as a set (TRD §16 PATCH); numbering follows the order given. */
export async function patchDraft(id: string, body: PatchBody, user: { id: string }) {
  const r = await assertDraft(id);
  const changed: string[] = [];
  const asked: Record<string, unknown> = { ...(body.header ?? {}), ...(body.terms_set !== undefined ? { terms_set: body.terms_set } : {}) };
  // Only fields that actually change are written and audited ("Save draft" sends the whole header).
  const { data: cur } = await db().from("rfx").select("*").eq("id", id).single();
  const header = Object.fromEntries(Object.entries(asked).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify((cur as Record<string, unknown>)[k] ?? null)));
  // A new deadline must be after today (India) — from the co-pilot or a hand edit alike.
  if (typeof header.response_deadline === "string" && header.response_deadline <= todayIST())
    throw new AppError("BAD_INPUT", `The response deadline must be after today (${todayIST()}); ${header.response_deadline} isn't.`, undefined, 400);
  if (Object.keys(header).length) {
    const { error } = await db().from("rfx").update({ ...header, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    changed.push(...Object.keys(header));
  }
  if (body.lines) {
    const { data: rfx } = await db().from("rfx").select("delivery_locations").eq("id", id).single();
    const loc = (rfx?.delivery_locations as string[] | undefined)?.[0] ?? "—";
    const del = await db().from("rfx_lines").delete().eq("rfx_id", id);
    if (del.error) throw del.error;
    if (body.lines.length) {
      const ins = await db().from("rfx_lines").insert(body.lines.map((l, i) => lineRow(id, l, i, loc)));
      if (ins.error) throw ins.error;
    }
    changed.push(`lines (${body.lines.length})`);
  }
  if (body.questions) {
    const del = await db().from("rfx_questions").delete().eq("rfx_id", id);
    if (del.error) throw del.error;
    if (body.questions.length) {
      const ins = await db().from("rfx_questions").insert(body.questions.map((q, i) => ({ rfx_id: id, q_no: i + 1, text: q.text, answer_type: q.answer_type, mandatory: q.mandatory, disqualify_if: q.disqualify_if?.trim() || null })));
      if (ins.error) throw ins.error;
    }
    changed.push(`questions (${body.questions.length})`);
  }
  if (body.vendors) {
    const ids = [...body.vendors.vendor_ids];
    for (const n of body.vendors.new ?? []) ids.push((await createVendor(n.name, n.email)).id);
    await setVendors(id, r.code, ids);
    changed.push(`vendors (${ids.length})`);
  }
  if (changed.length) await audit({ rfx_id: id, actor: user.id, event: "rfx.edited", entity_type: "rfx", entity_id: id, payload: { changed } });
  return getDraft(id);
}

/** Invitation list = exactly these vendors (not yet invited: invited_at stays null until issue). */
export async function setVendors(rfxId: string, code: string, vendorIds: string[]) {
  const unique = [...new Set(vendorIds)];
  const { data: cur } = await db().from("rfx_vendors").select("vendor_id").eq("rfx_id", rfxId);
  const gone = (cur ?? []).map((c) => c.vendor_id as string).filter((v) => !unique.includes(v));
  if (gone.length) { const d = await db().from("rfx_vendors").delete().eq("rfx_id", rfxId).in("vendor_id", gone); if (d.error) throw d.error; }
  if (!unique.length) return;
  const { data: vs } = await db().from("vendors").select("id, short_code").in("id", unique);
  if ((vs ?? []).length !== unique.length) throw new AppError("BAD_INPUT", "One of those vendors doesn't exist.", undefined, 400);
  const up = await db().from("rfx_vendors").upsert((vs ?? []).map((v) => ({ rfx_id: rfxId, vendor_id: v.id, status: "invited", reply_tag: `rfx-${code.toLowerCase()}-${v.short_code}` })), { onConflict: "rfx_id,vendor_id", ignoreDuplicates: true });
  if (up.error) throw up.error;
}

const HEADER_LABEL: Record<string, string> = {
  title: "title", cover_note: "scope", currency: "currency", quote_unit: "quote unit", incoterm: "delivery basis", freight_included_requested: "freight",
  tax_basis: "GST basis", payment_terms_days: "payment days", validity_days_requested: "validity days", contract_months: "contract months",
  response_deadline: "deadline", delivery_locations: "plants",
};
const LINE_LABEL: Record<string, string> = {
  sku: "SKU", description: "description", ply: "ply", length_mm: "L", width_mm: "W", height_mm: "H", gsm_spec: "GSM", burst_factor: "BF",
  item_type: "type", weight_per_piece_g: "weight", monthly_qty: "monthly qty", annual_qty: "annual qty", delivery_location: "deliver to",
};
const field = (o: object, k: string) => (o as unknown as Record<string, unknown>)[k];
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

/** A hand edit in plain words ("Lines: removed line 14 (…); line 3 monthly qty 6000 → 5000"), or null when nothing changed. */
export function describeEdit(before: Draft, after: Draft): string | null {
  const parts: string[] = [];
  if (!before.rfx.terms_set && after.rfx.terms_set) {
    const r = after.rfx;
    parts.push(`Terms confirmed: ${r.currency} · ${({ per_1000_pcs: "Per 1000 pcs", per_piece: "Per piece", per_kg: "Per kg", per_box: "Per box" } as Record<string, string>)[r.quote_unit] ?? r.quote_unit} · ${({ delivered: "Delivered to plant", ex_works: "Ex-works", fob: "FOB" } as Record<string, string>)[r.incoterm] ?? r.incoterm}${r.freight_included_requested ? ", freight included" : ", freight extra"} · ${r.tax_basis === "incl_gst" ? "Incl. GST" : "Excl. GST"} · ${r.payment_terms_days}-day payment · ${r.validity_days_requested}-day validity · ${r.contract_months} months`);
  }
  const hdr = Object.keys(HEADER_LABEL).filter((k) => JSON.stringify(field(before.rfx, k) ?? null) !== JSON.stringify(field(after.rfx, k) ?? null));
  if (hdr.length) parts.push(`Terms: ${hdr.map((k) => k === "cover_note" ? "scope rewritten" : `${HEADER_LABEL[k]} ${show(field(before.rfx, k))} → ${show(field(after.rfx, k))}`).join("; ")}`);

  const key = (l: RfxLine) => l.sku || l.description;
  const was = new Map(before.lines.map((l) => [key(l), l])), now = new Map(after.lines.map((l) => [key(l), l]));
  const removed = before.lines.filter((l) => !now.has(key(l))).map((l) => `removed line ${l.line_no} (${l.description})`);
  const added = after.lines.filter((l) => !was.has(key(l))).map((l) => `added line ${l.line_no} (${l.description})`);
  const changed = after.lines.flatMap((l) => {
    const b = was.get(key(l));
    if (!b) return [];
    const f = Object.keys(LINE_LABEL).filter((k) => JSON.stringify(field(b, k) ?? null) !== JSON.stringify(field(l, k) ?? null));
    return f.length ? [`line ${l.line_no} ${f.map((k) => `${LINE_LABEL[k]} ${show(field(b, k))} → ${show(field(l, k))}`).join(", ")}`] : [];
  });
  const lineBits = [...removed, ...added, ...changed];
  if (lineBits.length) parts.push(`Lines: ${lineBits.slice(0, 8).join("; ")}${lineBits.length > 8 ? `; and ${lineBits.length - 8} more` : ""} (now ${after.lines.length})`);

  const qText = (q: RfxQuestion) => `${q.text}|${q.answer_type}|${q.mandatory}|${q.disqualify_if ?? ""}`;
  const qb = new Set(before.questions.map(qText)), qa = new Set(after.questions.map(qText));
  const qRemoved = before.questions.filter((q) => !qa.has(qText(q))).length, qAdded = after.questions.filter((q) => !qb.has(qText(q))).length;
  if (qRemoved || qAdded) parts.push(`Questionnaire: ${[qRemoved && `${qRemoved} removed or changed`, qAdded && `${qAdded} added or changed`].filter(Boolean).join(", ")} (now ${after.questions.length})`);

  const vb = before.vendors.map((v) => v.name), va = after.vendors.map((v) => v.name);
  const vBits = [...vb.filter((n) => !va.includes(n)).map((n) => `removed ${n}`), ...va.filter((n) => !vb.includes(n)).map((n) => `added ${n}`)];
  if (vBits.length) parts.push(`Vendors: ${vBits.join("; ")}`);
  return parts.length ? parts.join("\n") : null;
}

/** PATCH from the New RFx screen: apply, then record the hand edit in the co-pilot transcript so the agent knows about it. */
export async function patchDraftByHand(id: string, body: PatchBody, user: { id: string; name: string }) {
  const before = await getDraft(id);
  const after = await patchDraft(id, body, user);
  const text = describeEdit(before, after);
  if (!text) return after;
  const turn: Turn = { role: "event", text: `${user.name.split(" ")[0]} edited the draft by hand — ${text}`, at: new Date().toISOString() };
  const { error } = await db().from("rfx").update({ copilot_transcript: [...((after.rfx.copilot_transcript ?? []) as Turn[]), turn] }).eq("id", id);
  if (error) throw error;
  return getDraft(id);
}
