import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildEvidence, type Evidence } from "@/lib/evidence";
import { money } from "@/lib/format";
import { audit } from "@/lib/log";
import type { Loc, Step } from "@/lib/comparison";
import type { MapSummary } from "@/lib/pipeline/map";
import { passes } from "@/lib/pipeline/questionnaire";
import { runStage } from "@/lib/pipeline/run";
import type { SessionUser } from "@/lib/auth";
import type { ResponseFile } from "@/types/db";

// TRD §12 + §17.8, DESIGN §2.11 / §3.6.
export type Action = "confirm" | "override" | "exclude" | "map" | "ignore" | "ask-vendor" | "mark-not-quoted" | "dismiss" | "accept-yes" | "treat-no";
export const ACTIONS: Action[] = ["confirm", "override", "exclude", "map", "ignore", "ask-vendor", "mark-not-quoted", "dismiss", "accept-yes", "treat-no"];
const INFORMATIONAL = ["fx_assumption", "discount_treatment", "freight_treatment", "validity_short", "missing_line"];
// DESIGN §3.6 order: ambiguous units, low-confidence read, prior pricing, discounts, FX, freight, questionnaire, validity; then the rest.
const ORDER = ["ambiguous_unit", "low_confidence_read", "prior_pricing", "discount_treatment", "fx_assumption", "freight_treatment", "questionnaire_ambiguous", "questionnaire_missing", "validity_short", "missing_line", "unmapped_item", "conflict", "unknown_vendor", "not_a_quote"];

export type QueueItem = {
  id: string; type: string; title: string; detail: string | null; status: string;
  vendor: { id: string; code: string; name: string } | null; line_no: number | null;
  probability: number | null; proposed_value: number | null; proposed_note: string | null;
  evidence: Evidence | null; resolution: { value?: number; note?: string; by?: string; at?: string } | null;
  actions: Action[]; candidates?: { line_id: string; line_no: number; description: string }[];
};

type Row = {
  id: string; type: string; title: string; detail: string | null; status: string; rfx_line_id: string | null; line_quote_id: string | null;
  extracted_item_id: string | null; question_id: string | null; response_id: string | null; vendor_id: string | null;
  proposed_value: number | null; proposed_note: string | null; proposed_state: string | null; probability: number | null;
  evidence: Record<string, unknown>; resolution: QueueItem["resolution"];
};

/** Which buttons a card offers (DESIGN §3.6 "Actions by type"). */
export function actionsFor(r: Pick<Row, "type" | "proposed_value" | "line_quote_id" | "proposed_state">): Action[] {
  switch (r.type) {
    case "ambiguous_unit": return [...(r.proposed_value !== null ? ["confirm" as const] : []), "override", "exclude", "ask-vendor"];
    case "low_confidence_read":
      return r.proposed_state === "mapped" ? ["confirm", "map"] : [...(r.proposed_value !== null ? ["confirm" as const] : []), "override", "exclude", "ask-vendor"];
    case "prior_pricing": return ["ask-vendor", "mark-not-quoted"];
    case "questionnaire_ambiguous": return ["accept-yes", "treat-no", "ask-vendor"];
    case "questionnaire_missing": return ["ask-vendor", "dismiss"];
    case "unmapped_item": return ["map", "ignore"];
    case "conflict": return [...(r.proposed_value !== null ? ["confirm" as const] : []), "override", "dismiss"];
    case "unknown_vendor": case "not_a_quote": return ["dismiss"];
    default: return ["confirm", "dismiss"]; // informational: acknowledge, or dismiss (TRD §12.3)
  }
}

export async function listReview(rfxId: string, f: { vendor?: string; type?: string; status?: string } = {}): Promise<QueueItem[]> {
  let q = db().from("review_items").select("*").eq("rfx_id", rfxId);
  if (f.type) q = q.eq("type", f.type);
  if (f.status === "open") q = q.eq("status", "open");
  else if (f.status === "resolved") q = q.neq("status", "open");
  const [itemsQ, vendorsQ, linesQ] = await Promise.all([q, db().from("vendors").select("id, short_code, name"), db().from("rfx_lines").select("id, line_no, description").eq("rfx_id", rfxId).order("line_no")]);
  for (const x of [itemsQ, vendorsQ, linesQ]) if (x.error) throw x.error;
  let rows = itemsQ.data as Row[];
  const vendorOf = (id: string | null) => (vendorsQ.data ?? []).find((v) => v.id === id);
  if (f.vendor) rows = rows.filter((r) => vendorOf(r.vendor_id)?.short_code === f.vendor);
  const lineNo = new Map((linesQ.data ?? []).map((l) => [l.id, l.line_no as number]));

  // Everything evidence needs, fetched once.
  const responseIds = [...new Set(rows.map((r) => r.response_id).filter(Boolean))] as string[];
  const itemIds = [...new Set(rows.map((r) => r.extracted_item_id).filter(Boolean))] as string[];
  const [filesQ, respQ, termsQ, itemsLocQ, cellsQ, answersQ] = await Promise.all([
    responseIds.length ? db().from("response_files").select("*").in("response_id", responseIds) : Promise.resolve({ data: [] }),
    responseIds.length ? db().from("responses").select("id, email_text").in("id", responseIds) : Promise.resolve({ data: [] }),
    responseIds.length ? db().from("response_terms").select("*").in("response_id", responseIds) : Promise.resolve({ data: [] }),
    itemIds.length ? db().from("extracted_items").select("id, file_id, location, price_unit_raw").in("id", itemIds) : Promise.resolve({ data: [] }),
    db().from("line_quotes").select("vendor_id, state, extracted_item_id").eq("rfx_id", rfxId).eq("state", "references_prior").not("extracted_item_id", "is", null),
    db().from("questionnaire_answers").select("question_id, vendor_id, answer_raw, location").eq("rfx_id", rfxId),
  ]);
  const files = (filesQ.data ?? []) as ResponseFile[];
  const priorItems = (cellsQ.data ?? []) as { vendor_id: string; extracted_item_id: string }[];
  const extraIds = priorItems.map((c) => c.extracted_item_id).filter((id) => !itemIds.includes(id));
  const extraLoc = extraIds.length ? (await db().from("extracted_items").select("id, file_id, location, price_unit_raw").in("id", extraIds)).data ?? [] : [];
  const locOf = new Map([...(itemsLocQ.data ?? []), ...extraLoc].map((i) => [i.id as string, i as { id: string; file_id: string | null; location: Loc; price_unit_raw: string | null }]));
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
    } else if (r.question_id) {
      const a = (answersQ.data ?? []).find((x) => x.question_id === r.question_id && x.vendor_id === r.vendor_id);
      const loc = a?.location as Loc | null;
      evidence = { kind: "text", text: loc?.snippet ?? a?.answer_raw ?? r.detail ?? "", mark: a?.answer_raw ?? undefined, caption: `Questionnaire answer${quoteFile(r.response_id) ? ` · ${quoteFile(r.response_id)!.original_name}` : ""}` };
    } else if (r.response_id) {
      const t = (termsQ.data ?? []).find((x) => x.response_id === r.response_id);
      const text = r.type === "fx_assumption" ? r.detail
        : r.type === "freight_treatment" ? t?.freight_terms_raw
        : r.type === "validity_short" ? (t?.validity_days ? `Validity: ${t.validity_days} days` : t?.validity_until)
        : r.type === "discount_treatment" ? [t?.total_discount_pct && `${t.total_discount_pct}%`, t?.total_discount_condition].filter(Boolean).join(" ")
        : r.type === "missing_line" ? t?.other_notes : r.detail;
      const qf = quoteFile(r.response_id);
      if (text) evidence = { kind: "text", text, caption: r.type === "fx_assumption" ? "Settings → FX rates" : `Terms read from ${qf?.original_name ?? "the email body"}` };
    }
    return {
      id: r.id, type: r.type, title: r.title, detail: r.detail, status: r.status,
      vendor: v ? { id: v.id, code: v.short_code, name: v.name } : null, line_no: r.rfx_line_id ? lineNo.get(r.rfx_line_id) ?? null : null,
      probability: r.probability === null ? null : Number(r.probability), proposed_value: r.proposed_value === null ? null : Number(r.proposed_value),
      proposed_note: r.proposed_note, evidence, resolution: r.resolution, actions: actionsFor(r),
      ...(r.type === "unmapped_item" || r.proposed_state === "mapped" ? { candidates: (linesQ.data ?? []).map((l) => ({ line_id: l.id, line_no: l.line_no, description: l.description })) } : {}),
    };
  }));
  const rank = (t: string) => (ORDER.indexOf(t) + 1 || 99);
  return items.sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || rank(a.type) - rank(b.type)
    || (a.vendor?.name ?? "").localeCompare(b.vendor?.name ?? "") || (a.line_no ?? 0) - (b.line_no ?? 0));
}

export type ActBody = { value?: number; reason?: string; line_id?: string; mode?: "draft" | "mark_sent" };
export type ActResult = { status: string; draft?: { to: string; reply_to: string; subject: string; body: string } };

/** TRD §12.3 — one action on one review item; every call leaves an audit event. */
export async function act(itemId: string, action: Action, body: ActBody, user: SessionUser): Promise<ActResult> {
  if (!ACTIONS.includes(action)) throw new AppError("BAD_ACTION", `Unknown action ${action}`, undefined, 400);
  const { data: r, error } = await db().from("review_items").select("*").eq("id", itemId).maybeSingle<Row & { rfx_id: string }>();
  if (error) throw error;
  if (!r) throw new AppError("NOT_FOUND", "Review item not found", undefined, 404);
  if (r.status !== "open") throw new AppError("ALREADY_DECIDED", "This item was already decided.", undefined, 409);
  if (!actionsFor(r).includes(action)) throw new AppError("BAD_ACTION", `“${action}” doesn't apply to a ${r.type.replaceAll("_", " ")} item.`, undefined, 400);
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
  const lineLabel = async () => r.rfx_line_id ? `Line ${(await db().from("rfx_lines").select("line_no").eq("id", r.rfx_line_id).single()).data?.line_no}` : "Vendor";

  switch (action) {
    case "confirm": {
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
      draft = await clarificationDraft(r);
      if (body.mode !== "mark_sent") return { status: r.status, draft }; // draft only; sending arrives with email (P6)
      await db().from("rfx_vendors").update({ status: "clarification_sent" }).eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!);
      status = "asked_vendor"; resolution = { ...resolution, note: "Asked the vendor" };
      break;
    }
    case "dismiss": status = "dismissed"; break;
  }

  const { error: ue } = await db().from("review_items").update({ status, resolution, updated_at: at }).eq("id", r.id);
  if (ue) throw ue;
  await audit({ rfx_id: r.rfx_id, actor: user.id, event: `review.${action}`, entity_type: "review_item", entity_id: r.id, payload: { type: r.type, status, ...pick(action, body) } });
  return { status, draft };
}

/** Freight the landed price adds for this vendor: the ledger's freight_treatment amount, 0 when freight is included. */
async function freightFor(rfxId: string, vendorId: string): Promise<number> {
  const { data } = await db().from("assumptions").select("value").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("kind", "freight_treatment").is("superseded_by", null).maybeSingle();
  return Number((data?.value as { inr_per_1000?: number } | null)?.inr_per_1000 ?? 0);
}

// ponytail: template draft; P6-T3 replaces it with P-CLARIFY and real sending.
async function clarificationDraft(r: Row & { rfx_id: string }) {
  const [{ data: rfx }, { data: v }, { data: rv }] = await Promise.all([
    db().from("rfx").select("code, title").eq("id", r.rfx_id).single(),
    db().from("vendors").select("name, contact_name, email").eq("id", r.vendor_id!).single(),
    db().from("rfx_vendors").select("reply_tag").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).single(),
  ]);
  const { data: open } = await db().from("review_items").select("title").eq("rfx_id", r.rfx_id).eq("vendor_id", r.vendor_id!).eq("status", "open").in("type", ["ambiguous_unit", "low_confidence_read", "prior_pricing", "questionnaire_ambiguous", "questionnaire_missing", "missing_line"]);
  const points = [...new Set([r.title, ...(open ?? []).map((o) => o.title)])];
  return {
    to: v?.email ?? "", reply_to: `${rv?.reply_tag ?? "rfx"}-clar-1`,
    subject: `Clarification — RFx ${rfx?.code}: ${points.length === 1 ? r.title : `${points.length} points on your quotation`}`,
    body: `Dear ${v?.contact_name ?? v?.name ?? "Sir/Madam"},\n\nThank you for your quotation for ${rfx?.title}. Before we can compare it, please clarify:\n\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nA short reply to this email is enough.\n\nRegards,\nSujit Menon\nCategory Buyer — Packaging, Meridian Foods`,
  };
}

/** Only the fields an action uses go into the audit trail. */
const pick = (a: Action, b: ActBody) => a === "override" ? { value: b.value, reason: b.reason } : a === "exclude" ? { reason: b.reason } : a === "map" ? { line_id: b.line_id } : a === "ask-vendor" ? { mode: b.mode } : {};

export const isInformational = (type: string) => INFORMATIONAL.includes(type);
