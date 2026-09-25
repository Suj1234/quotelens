import "server-only";
import { createHash } from "node:crypto";
import { choice, bool, decide, type Question } from "@/lib/ai/decision";
import { COUNTED } from "@/lib/comparison";
import { db } from "@/lib/db";
import { get } from "@/lib/storage";
import type { ResponseRow } from "@/types/db";
import type { ExtractSummary, Issuer } from "./extract";
import { insertReviews } from "./reviews";

// 0016 "Is this reply really from this vendor?" (DECISIONS 2026-09-25 "Vendor check"). The extractor only reads who the
// document says it is from / to; this decides, over our own vendor list, whether that fits the vendor the reply came from.
// The model never judges trust on its own words ("we are Kohinoor"): it picks among the invited vendors, and code compares.

const BUYER_ORG = "Meridian Foods Pvt Ltd"; // same as the dispatch / co-pilot prompts
const NONE = "None of these";
/** best_guess_note on the cells this card holds back; Keep / Exclude find them by it. */
export const HOLD_NOTE = "Held until you confirm who sent this reply (Review → Replies to sort).";

export type VendorCheck = { reasons: string[]; lines: string[]; p_own: number | null; provider: string | null };

export async function vendorCheck(resp: ResponseRow): Promise<VendorCheck> {
  const [{ data: invited, error: ie }, { data: files, error: fe }, { data: staff }] = await Promise.all([
    db().from("rfx_vendors").select("vendor_id, vendors(name)").eq("rfx_id", resp.rfx_id),
    db().from("response_files").select("id, response_id, original_name, storage_path, sha256, responses!inner(rfx_id, vendor_id)").eq("responses.rfx_id", resp.rfx_id),
    db().from("users").select("name"),
  ]);
  if (ie || fe) throw ie ?? fe;
  const nameOf = new Map((invited ?? []).map((v) => [v.vendor_id as string, (v.vendors as unknown as { name: string }).name]));
  const own = nameOf.get(resp.vendor_id!) ?? "this vendor";
  const reasons: string[] = [];

  // 1. Same file from two vendors: content fingerprint (backfilled for files stored before 0016). Code only.
  for (const f of files ?? []) {
    if (f.sha256) continue;
    f.sha256 = createHash("sha256").update(await get("raw", f.storage_path)).digest("hex");
    await db().from("response_files").update({ sha256: f.sha256 }).eq("id", f.id);
  }
  const vendorOfFile = (f: { responses: unknown }) => (f.responses as { vendor_id: string | null }).vendor_id;
  for (const f of (files ?? []).filter((x) => x.response_id === resp.id)) {
    const twin = (files ?? []).find((o) => o.sha256 === f.sha256 && o.response_id !== resp.id && vendorOfFile(o) && vendorOfFile(o) !== resp.vendor_id);
    if (twin) reasons.push(`The same file (${f.original_name}) also arrived from ${nameOf.get(vendorOfFile(twin)!) ?? "another vendor"}.`);
  }

  // 2. Who the documents say they are from / to (read by the extractor), decided over the invited vendors.
  // An email's addressee is in its headers; its greeting ("Sujit sir good morning") is not a company, so only documents are checked for it.
  const issuers = ((resp.summary.extract as ExtractSummary | undefined)?.issuers ?? [])
    .map((i) => (i.source === "email body" ? { ...i, addressed_to: null } : i)).filter((i) => i.issuer_name || i.addressed_to);
  const lines = issuers.map(describe);
  let p_own: number | null = null, provider: string | null = null;
  if (issuers.length) {
    const options = [...new Set([...nameOf.values()])].concat(NONE);
    const qs: Record<string, Question> = {};
    issuers.forEach((i, k) => {
      if (i.issuer_name) qs[`issuer_${k}`] = { type: "choice", options, instruction: `Which company issued document ${k + 1}? Initials and short forms count (e.g. "SBP" for "Sri Balaji Packaging"); a legal-name variant of a listed company is that company. Choose "${NONE}" when the named company is none of them.` };
      if (i.addressed_to) qs[`to_${k}`] = { type: "boolean", statement: `Document ${k + 1} is addressed to ${BUYER_ORG} (a short form, a person or a plant of ${BUYER_ORG} counts).` };
    });
    const state = [`Buyer: ${BUYER_ORG}; its people include ${(staff ?? []).map((u) => u.name).join(", ")}. The reply was received from the invited vendor "${own}".`,
      ...issuers.map((i, k) => `Document ${k + 1} (${i.source}): ${describe(i)}`)].join("\n");
    const r = await decide(state, qs, { purpose: "vendor_check", rfx_id: resp.rfx_id, response_id: resp.id });
    provider = r.provider;
    issuers.forEach((i, k) => {
      if (i.issuer_name) {
        const c = choice(r, `issuer_${k}`);
        const p = c.probabilities[own] ?? 0;
        p_own = p_own === null ? p : Math.min(p_own, p);
        if (p < 0.3) reasons.push(c.answer === NONE
          ? `${i.source} names "${i.issuer_name}" as the supplier, which isn't a vendor on this RFx.`
          : `${i.source} names "${i.issuer_name}" as the supplier, which looks like ${c.answer}.`);
      }
      if (i.addressed_to && bool(r, `to_${k}`) < 0.3) reasons.push(`${i.source} is addressed to "${i.addressed_to}", not ${BUYER_ORG}.`);
    });
  }
  return { reasons, lines, p_own, provider };
}

const describe = (i: Issuer) => [i.issuer_name && `From: ${i.issuer_name}`, i.issuer_ref && `Their ref: ${i.issuer_ref}`, i.addressed_to && `To: ${i.addressed_to}`].filter(Boolean).join(" · ");

/** Hold this reply's counted prices while the card is open: they show as "?" in the grid and stay out of every total. */
export async function holdCells(responseId: string) {
  const { data, error } = await db().from("line_quotes").select("id, unit_price_inr_per_1000").eq("response_id", responseId).in("state", COUNTED).not("unit_price_inr_per_1000", "is", null);
  if (error) throw error;
  for (const c of data ?? []) {
    const { error: e } = await db().from("line_quotes").update({ state: "conflict", best_guess_value: c.unit_price_inr_per_1000, best_guess_note: HOLD_NOTE, unit_price_inr_per_1000: null, landed_price_inr_per_1000: null }).eq("id", c.id);
    if (e) throw e;
  }
  return (data ?? []).length;
}

/** Give held prices back (Keep, or a re-run that no longer finds a problem): price and landed price as before the hold. */
export async function releaseCells(resp: { id: string; rfx_id: string; vendor_id: string | null }, state: "reviewed" | "confirmed", note?: string) {
  const [{ data, error }, { data: fr }] = await Promise.all([
    db().from("line_quotes").select("id, best_guess_value").eq("response_id", resp.id).eq("state", "conflict").eq("best_guess_note", HOLD_NOTE),
    db().from("assumptions").select("value").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id!).eq("kind", "freight_treatment").is("superseded_by", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw error;
  const freight = Number((fr?.value as { inr_per_1000?: number } | null)?.inr_per_1000 ?? 0);
  for (const c of data ?? []) {
    const v = Number(c.best_guess_value);
    const { error: e } = await db().from("line_quotes").update({ state, unit_price_inr_per_1000: v, landed_price_inr_per_1000: Math.round((v + freight) * 100) / 100, best_guess_value: null, best_guess_note: null, ...(note ? { review_note: note } : {}) }).eq("id", c.id);
    if (e) throw e;
  }
  return (data ?? []).length;
}

/** Raise the "may not be from this vendor" card for a check that found a problem (never re-opens a decided one). Shared by flags and normalise. */
export async function raiseVendorMismatch(resp: ResponseRow, vc: VendorCheck, stage: string) {
  if (!vc.reasons.length) return;
  const [{ count: priced }, { data: v }] = await Promise.all([
    db().from("line_quotes").select("id", { count: "exact", head: true }).eq("response_id", resp.id).in("state", COUNTED).not("unit_price_inr_per_1000", "is", null),
    db().from("vendors").select("name").eq("id", resp.vendor_id!).single(),
  ]);
  await insertReviews(resp, stage, [{ type: "vendor_mismatch", title: `This reply may not be from ${v?.name ?? "this vendor"}`,
    detail: vc.reasons.join(" "), probability: vc.p_own, proposed_value: priced ?? 0, evidence: { lines: vc.lines, reasons: vc.reasons, provider: vc.provider } }]);
}

/** The reply's vendor-check card is open (waiting for the buyer) or the buyer excluded the reply. */
export async function clarificationOnHold(responseId: string): Promise<boolean> {
  const { data: card } = await db().from("review_items").select("status").eq("response_id", responseId).eq("type", "vendor_mismatch").maybeSingle();
  return !!card && card.status !== "confirmed" && card.status !== "overridden";
}

/**
 * A clarification reply replaces the vendor's prices and closes its cards, so it is checked before it may change anything
 * (first replies are checked in flags and held after the fact). true = don't apply it: the card is open, or the reply was excluded.
 */
export async function clarificationHeld(resp: ResponseRow): Promise<boolean> {
  await raiseVendorMismatch(resp, await vendorCheck(resp), "normalise");
  if (!(await clarificationOnHold(resp.id))) return false;
  await holdCells(resp.id); // prices this reply wrote before the check existed stay out of every total while the card is open
  return true;
}
