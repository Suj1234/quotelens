import "server-only";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { preprocess } from "@/lib/preprocess";
import { assertDraft, getDraft, lineInput, patchDraft, setVendors, type Draft, type Turn } from "@/lib/rfx-draft";
import { createVendor } from "@/lib/vendors";

// TRD §9.1 P-COPILOT, verbatim.
const P_COPILOT = `You are the sourcing co-pilot for a category buyer at Meridian Foods Pvt Ltd (FMCG, India).
Goal: turn the buyer's description into a complete RFx: scope paragraph, line items, questionnaire, commercial terms, vendor list.
Rules:
- Ask at most 3 questions at a time. Ask only what is missing among: category, approximate number of lines, quoting unit, incoterm (delivered vs ex-works), freight included or not, payment terms (days), quote validity (days), contract duration, delivery locations, whether a supplier questionnaire applies, response deadline.
- Never invent line items. If the buyer has a line sheet, ask them to upload or paste it. If they describe lines verbally, draft them and mark each as "draft — please confirm".
- Default terms for Indian FMCG packaging if the buyer says "standard": delivered to plant, freight included, 45-day payment, 60-day validity, 12-month contract, INR, quote per 1000 pieces.
- When the buyer asks for a questionnaire, propose 8-12 questions relevant to the category with answer types yes_no / number / text, and suggest which are disqualifying.
- Output ONLY JSON matching the schema. The "reply" field is what the buyer sees; the "rfx_patch" field contains structured updates to apply.`;

// TRD §9.2 P-LINESHEET, verbatim.
const P_LINESHEET = `You are given a buyer's line-item sheet for a corrugated packaging RFx (text with row/cell references).
Return every line item as structured data. Parse dimensions (L x W x H mm), ply (3 or 5), GSM spec, burst factor, item type (box|sheet|partition|other), monthly quantity, delivery location.
If a field is absent, set null. Do not invent quantities. Preserve the buyer's SKU codes exactly.
Estimate weight_per_piece_g only if the sheet gives it; otherwise null.
Return ONLY JSON: { "lines": [ {...} ] } matching the schema.`;

const n = z.number().nullable().optional();
const LineAdd = z.object({
  sku: z.string().nullable().optional(), description: z.string(), ply: n, length_mm: n, width_mm: n, height_mm: n,
  gsm_spec: z.string().nullable().optional(), burst_factor: n, item_type: z.string().nullable().optional(), weight_per_piece_g: n,
  monthly_qty: z.number().nullable(), delivery_location: z.string().nullable(),
});
const LineSheet = z.object({ lines: z.array(LineAdd) });
// TRD §9.1 CopilotTurn (disqualify_if is written as "no" / "yes" / "lt:200" — the rule format the questionnaire stage reads).
const CopilotTurn = z.object({
  reply: z.string(),
  questions_for_buyer: z.array(z.string()).max(3),
  rfx_patch: z.object({
    title: z.string().optional(), category: z.string().optional(), cover_note: z.string().optional(),
    quote_unit: z.enum(["per_1000_pcs", "per_piece", "per_kg", "per_box"]).optional(),
    incoterm: z.enum(["delivered", "ex_works", "fob"]).optional(), freight_included_requested: z.boolean().optional(),
    payment_terms_days: z.number().optional(), validity_days_requested: z.number().optional(), contract_months: z.number().optional(),
    delivery_locations: z.array(z.string()).optional(), response_deadline: z.string().optional().describe("YYYY-MM-DD"),
    lines_add: z.array(LineAdd.extend({ draft: z.boolean() })).optional(),
    questions_add: z.array(z.object({ text: z.string(), answer_type: z.enum(["yes_no", "number", "text"]), mandatory: z.boolean(), disqualify_if: z.string().optional().describe('"no" or "yes" for yes_no; "lt:<n>" / "gt:<n>" for number') })).optional(),
    vendors_add: z.array(z.object({ name: z.string(), email: z.string().optional() })).optional(),
  }),
});

const TERMS = ["quote_unit", "incoterm", "freight_included_requested", "payment_terms_days", "validity_days_requested", "contract_months", "delivery_locations", "response_deadline", "currency"] as const;
const UNIT = { per_1000_pcs: "per 1000 pcs", per_piece: "per piece", per_kg: "per kg", per_box: "per box" } as Record<string, string>;

export type Attachment = { name: string; text: string };

/** Text of an attached line sheet through the same preprocessors as vendor files (xlsx / csv / txt). */
export async function attachmentText(name: string, buf: Buffer): Promise<Attachment> {
  if (!/\.(xlsx|xls|csv|txt)$/i.test(name)) throw new AppError("BAD_INPUT", `${name}: attach an xlsx, csv or txt file.`, undefined, 400);
  const p = await preprocess(name, buf);
  if (p.mode !== "text") throw new AppError("BAD_INPUT", `${name} couldn't be read as a sheet.`, undefined, 400);
  return { name, text: p.text };
}

function draftSummary(d: Draft) {
  const r = d.rfx;
  return {
    code: r.code, title: r.title, category: r.category, cover_note: r.cover_note, terms_set: r.terms_set,
    terms: { currency: r.currency, quote_unit: r.quote_unit, incoterm: r.incoterm, freight_included_requested: r.freight_included_requested, payment_terms_days: r.payment_terms_days, validity_days_requested: r.validity_days_requested, contract_months: r.contract_months, delivery_locations: r.delivery_locations, response_deadline: r.response_deadline },
    lines: { count: d.lines.length, first: d.lines.slice(0, 3).map((l) => l.description) },
    questionnaire: d.questions.map((q) => `Q${q.q_no} ${q.text}`),
    vendors: d.vendors.map((v) => v.name),
  };
}

/** TRD §16 POST /api/rfx/{id}/copilot: parse attached sheets (P-LINESHEET), one P-COPILOT turn, apply the patch, keep the transcript. */
export async function copilotTurn(rfxId: string, message: string, attachments: Attachment[], user: { id: string; name: string }) {
  await assertDraft(rfxId);
  const draft = await getDraft(rfxId);
  const transcript = (draft.rfx.copilot_transcript ?? []) as Turn[];
  const now = () => new Date().toISOString();

  // Line sheets first: the co-pilot never writes lines itself from a sheet — the parser does, as the buyer's rows.
  const parsed: { name: string; lines: z.infer<typeof LineAdd>[] }[] = [];
  for (const a of attachments) {
    const out = await generateJSON({ tier: "strong", purpose: "copilot_linesheet", rfx_id: rfxId, schema: LineSheet, temperature: 0.1, thinking: "LOW", parts: [{ text: P_LINESHEET }, { text: `File: ${a.name}\n${a.text.slice(0, 60_000)}` }] });
    parsed.push({ name: a.name, lines: out.lines.filter((l) => l.description?.trim()) });
  }

  const context = [
    `Current draft (JSON): ${JSON.stringify(draftSummary(draft))}`,
    `Address book (existing vendors): ${JSON.stringify(draft.addressBook.map((v) => ({ name: v.name, email: v.email, city: v.city })))}`,
    `Conversation so far: ${JSON.stringify(transcript.slice(-10).map((t) => ({ [t.role]: t.text })))}`,
    parsed.length ? `The attached line sheet was parsed separately into the Lines tab: ${parsed.map((p) => `${p.name}: ${p.lines.length} lines`).join("; ")}. Do not add these lines again in rfx_patch.` : "",
    `Buyer: ${message || "(sent an attachment)"}`,
  ].filter(Boolean).join("\n\n");
  const turn = await generateJSON({ tier: "strong", purpose: "copilot", rfx_id: rfxId, schema: CopilotTurn, temperature: 0.7, thinking: "LOW", system: P_COPILOT, parts: [{ text: context }] });

  // Apply the patch (TRD §16 "CopilotTurn applied"). Notes are plain text "Label · detail" lines (the UI bolds the label; no HTML from the model).
  const p = turn.rfx_patch;
  const notes: string[] = [];
  const header: Record<string, unknown> = {};
  for (const k of ["title", "category", "cover_note", ...TERMS] as const) if ((p as Record<string, unknown>)[k] !== undefined) header[k] = (p as Record<string, unknown>)[k];
  if (header.response_deadline && !/^\d{4}-\d{2}-\d{2}$/.test(String(header.response_deadline))) delete header.response_deadline;
  const termsTouched = TERMS.some((k) => header[k] !== undefined);
  let lines: ReturnType<typeof lineInput>[] | undefined;
  if (parsed.length) {
    lines = parsed.flatMap((x) => x.lines).map((l) => lineInput({ ...l, draft: false }));
    notes.push(`Lines · ${lines.length} parsed from ${parsed.map((x) => x.name).join(", ")}`);
  } else if (p.lines_add?.length) {
    lines = [...draft.lines.map((l) => lineInput(l)), ...p.lines_add.map((l) => lineInput({ ...l, draft: true }))];
    notes.push(`Lines · ${p.lines_add.length} drafted from your description — please confirm each`);
  }
  const questions = [...draft.questions.map((q) => ({ text: q.text, answer_type: q.answer_type, mandatory: q.mandatory, disqualify_if: q.disqualify_if })),
    ...(p.questions_add ?? []).map((q) => ({ ...q, disqualify_if: q.disqualify_if?.trim().toLowerCase() || null }))];
  if (p.questions_add?.length) notes.push(`Questionnaire · ${p.questions_add.length} questions · ${p.questions_add.filter((q) => q.disqualify_if).length} disqualifying`);

  await patchDraft(rfxId, {
    header: Object.keys(header).length ? header : undefined,
    terms_set: termsTouched ? true : undefined,
    lines,
    questions: p.questions_add?.length ? questions : undefined,
  }, user);
  if (termsTouched) {
    const r = { ...draft.rfx, ...header } as Draft["rfx"];
    notes.push(`Terms · ${r.currency} · ${UNIT[r.quote_unit] ?? r.quote_unit} · ${r.incoterm.replace("_", "-")}${r.freight_included_requested ? ", freight included" : ", freight extra"} · ${r.payment_terms_days}-day payment · ${r.validity_days_requested}-day validity · ${r.contract_months} months · ${r.delivery_locations.join(", ")}`);
  }

  // Vendors: address-book names match existing suppliers; a new name needs an email (never invented).
  if (p.vendors_add?.length) {
    const ids = draft.vendors.map((v) => v.vendor_id);
    const added: string[] = [], skipped: string[] = [];
    for (const va of p.vendors_add) {
      const hit = draft.addressBook.find((b) => b.name.toLowerCase() === va.name.toLowerCase() || (va.email && b.email.toLowerCase() === va.email.toLowerCase()))
        ?? draft.addressBook.find((b) => b.name.toLowerCase().includes(va.name.toLowerCase()) || va.name.toLowerCase().includes(b.name.toLowerCase().split(" ")[0]));
      if (hit) { if (!ids.includes(hit.vendor_id)) { ids.push(hit.vendor_id); added.push(hit.name); } continue; }
      if (va.email) { ids.push((await createVendor(va.name, va.email)).id); added.push(va.name); } else skipped.push(va.name);
    }
    await setVendors(rfxId, draft.rfx.code, ids);
    if (added.length) notes.push(`Vendors · ${added.join(" · ")}`);
    if (skipped.length) notes.push(`Not added (no email in the address book): ${skipped.join(", ")}`);
  }

  const reply = turn.reply.trim();
  const next: Turn[] = [...transcript,
    { role: "buyer", text: message, attachments: attachments.map((a) => a.name), at: now() },
    { role: "copilot", text: reply, questions: turn.questions_for_buyer.slice(0, 3), patch: notes.join("\n") || undefined, at: now() },
  ];
  const up = await db().from("rfx").update({ copilot_transcript: next, updated_at: now() }).eq("id", rfxId);
  if (up.error) throw up.error;
  if (notes.length) await audit({ rfx_id: rfxId, actor: user.id, event: "copilot.applied", entity_type: "rfx", entity_id: rfxId, payload: { header: Object.keys(header), lines: lines?.length ?? 0, questions: p.questions_add?.length ?? 0, vendors: p.vendors_add?.map((v) => v.name) ?? [] } });
  return getDraft(rfxId);
}
