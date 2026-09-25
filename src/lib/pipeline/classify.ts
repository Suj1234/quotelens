import "server-only";
import { VENDOR_DATA_RULE, vendorData, vendorText } from "@/lib/ai/vendor-data";
import { bool, choice, decide, type Question } from "@/lib/ai/decision";
import { generateText, inlineFile } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { cleanEmail } from "@/lib/preprocess/email";
import { get } from "@/lib/storage";
import type { FileKind, ResponseFile, ResponseRow } from "@/types/db";

const KINDS = ["quotation", "questionnaire", "supporting", "not_relevant"] as const;
const STATE_BUDGET = 6000; // decide() state cap (TRD §10.1)

// TRD §9.4
const P_CAPTION = `Describe this document in under 80 words for a procurement system: what type of document it appears to be (price quotation, filled questionnaire, certificate, company profile, invoice, unrelated), whether it contains a price table or price list, the currency symbols visible, and the company name if visible. Return plain text.`;

export type ClassifySummary = {
  files: Record<string, { name: string; kind: FileKind; p: number; contains_prices: number }>;
  email: { kind: FileKind; p: number; contains_prices: number } | null;
  no_quote_found: boolean;
};

/** TRD §8.1 — one decide() call per response covering every file plus the email body. */
export async function classify(resp: ResponseRow): Promise<ClassifySummary> {
  const { data: files, error } = await db().from("response_files").select("*").eq("response_id", resp.id).order("created_at");
  if (error) throw error;
  await db().from("review_items").delete().eq("response_id", resp.id).eq("type", "not_a_quote");

  // Files we could not read keep file_kind 'unknown' from intake and are not sent to the model.
  const readable = (files as ResponseFile[]).filter((f) => f.derived_text_path || f.derived_image_paths?.length || f.page_count);
  const unreadable = (files as ResponseFile[]).filter((f) => !readable.includes(f));
  const emailText = resp.email_text ? cleanEmail(resp.email_text) : "";

  const docs: { key: string; label: string; content: string; caption?: string; file?: ResponseFile }[] = [];
  await Promise.all(readable.map(async (f, i) => {
    let content: string, caption: string | undefined;
    if (f.derived_text_path) {
      content = (await get("derived", f.derived_text_path)).toString("utf8");
    } else {
      const part = f.derived_image_paths?.length
        ? inlineFile(await get("derived", f.derived_image_paths[0]), "image/png")
        : inlineFile(await get("raw", f.storage_path), "application/pdf");
      caption = await generateText({ tier: "fast", purpose: "classify", rfx_id: resp.rfx_id, response_id: resp.id, parts: [...vendorData(f.original_name, [part]), { text: `${P_CAPTION}\n${VENDOR_DATA_RULE}` }] });
      content = `Caption of the ${f.page_count ? `${f.page_count}-page PDF` : "image"}: ${caption}`;
    }
    docs[i] = { key: `f${i + 1}`, label: `${f.original_name} (${f.mime})`, content, caption, file: f };
  }));
  if (emailText) docs.push({ key: "email", label: "email body sent by the supplier", content: emailText });

  const summary: ClassifySummary = { files: {}, email: null, no_quote_found: false };
  if (docs.length) {
    const per = Math.min(3000, Math.floor(STATE_BUDGET / docs.length) - 120);
    const state = docs.map((d) => `### DOCUMENT ${d.key}: ${d.label}\n${vendorText(d.label, d.content.slice(0, per))}`).join("\n\n");
    const questions: Record<string, Question> = {};
    for (const d of docs) {
      questions[`${d.key}_kind`] = {
        type: "choice", options: [...KINDS],
        instruction: `About DOCUMENT ${d.key} only. quotation = the supplier's prices/offer; questionnaire = answers to the buyer's supplier questionnaire with no prices; supporting = certificate, company profile, brochure or a cover note without prices; not_relevant = unrelated to this RFx.`,
      };
      questions[`${d.key}_prices`] = { type: "boolean", statement: `DOCUMENT ${d.key} contains item prices or a price list.` };
    }
    const r = await decide(state, questions, { purpose: "classify", rfx_id: resp.rfx_id, response_id: resp.id });

    for (const d of docs) {
      const c = choice(r, `${d.key}_kind`);
      const top = c.probabilities[c.answer];
      const kind: FileKind = top < 0.5 ? "unknown" : (c.answer as FileKind); // TRD §10.5
      const prices = bool(r, `${d.key}_prices`);
      if (d.file) {
        const reason = [d.caption, `contains prices p=${prices.toFixed(2)}`].filter(Boolean).join(" · ");
        const { error } = await db().from("response_files").update({
          file_kind: kind, file_kind_probability: round(top), file_kind_provider: r.provider, classify_reason: reason,
        }).eq("id", d.file.id);
        if (error) throw error;
        summary.files[d.file.id] = { name: d.file.original_name, kind, p: round(top), contains_prices: round(prices) };
      } else {
        summary.email = { kind, p: round(top), contains_prices: round(prices) };
      }
    }
  }
  for (const f of unreadable) summary.files[f.id] = { name: f.original_name, kind: "unknown", p: 0, contains_prices: 0 };

  // TRD §8.1 rule: no quotation anywhere → not_a_quote, unless it is a valid questionnaire/supporting-only reply.
  const kinds = [...Object.values(summary.files).map((f) => f.kind), ...(summary.email ? [summary.email.kind] : [])];
  const hasQuote = kinds.includes("quotation") || (summary.email?.contains_prices ?? 0) >= 0.5;
  summary.no_quote_found = !hasQuote;
  const validNonQuote = kinds.length > 0 && kinds.every((k) => k === "questionnaire" || k === "supporting");
  const problems = [
    ...(!hasQuote && !validNonQuote ? [{ title: "No quotation found in this reply", detail: `Files read as: ${kinds.join(", ") || "none"}.` }] : []),
    ...Object.entries(summary.files).filter(([, f]) => f.kind === "unknown").map(([id, f]) => ({
      title: `Couldn't tell what ${f.name} is`, detail: unreadable.find((u) => u.id === id)?.classify_reason ?? `Best guess below 0.50.`, file_id: id,
    })),
  ];
  if (problems.length) {
    const { error } = await db().from("review_items").insert(problems.map((p) => ({
      rfx_id: resp.rfx_id, vendor_id: resp.vendor_id, response_id: resp.id, type: "not_a_quote",
      title: p.title, detail: p.detail, evidence: "file_id" in p ? { file_id: p.file_id } : {},
    })));
    if (error) throw error;
  }
  return summary;
}

const round = (p: number) => Math.round(p * 100) / 100;
