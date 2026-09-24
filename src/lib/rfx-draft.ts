import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { createVendor } from "@/lib/vendors";
import { UNTITLED } from "@/lib/rfx-list";
import type { Rfx, RfxLine, RfxQuestion } from "@/types/db";

// New RFx (TRD §16 POST/GET/PATCH /api/rfx, §17.3; DESIGN §3.3). A draft is editable until it is issued (version 1).

export type DraftVendor = { vendor_id: string; name: string; email: string; short_code: string; city: string | null };
export type Turn = { role: "buyer" | "copilot"; text: string; questions?: string[]; patch?: string; attachments?: string[]; at: string };
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
      code, title: o.title?.trim() || UNTITLED, category: o.category?.trim() || "Uncategorised", buyer_id: user.id, status: "draft", version: 0,
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
  freight_included_requested: z.boolean(), payment_terms_days: z.number().int().min(0).max(365), validity_days_requested: z.number().int().min(1).max(365),
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
