import "server-only";
import { VENDOR_DATA_RULE, vendorData } from "@/lib/ai/vendor-data";
import { z } from "zod";
import { bool, choice, decide, type Question } from "@/lib/ai/decision";
import { generateJSON, inlineFile, type Part } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { cleanEmail } from "@/lib/preprocess/email";
import { get } from "@/lib/storage";
import type { ResponseFile, ResponseRow, RfxQuestion } from "@/types/db";
import { clarificationScope, resolveByReply } from "@/lib/clarify";
import { clarificationOnHold } from "./vendor-check";
import { clearStageReviews, insertReviews, type ReviewInput } from "./reviews";

// TRD §9.7 P-QA-EXTRACT + two rules (v2, 2026-09-24; v1 in prompts/archive/): exact-question answers only, and a fixed reading of ranges.
const P_QA = `The buyer asked a supplier these questions:
{questions}
From the supplier's text below, extract the supplier's answer to each question if present: the verbatim answer text, a normalised yes/no (for yes_no), a number (for number), and where it appears (line/page + snippet). If a question is not answered, return found=false.
Do not infer answers from unrelated statements; only from explicit answers or clearly equivalent statements (e.g. "ISO 9001:2015 certified" answers a certification question).
Answer only the question asked: a related figure is not an answer (a regular-order lead time does not answer a sample lead-time question; an MOQ does not answer a capacity question) — return found=false.
If the supplier gives a range, keep it verbatim in answer_raw and set answer_number to the end that is worse for the buyer: the upper end for lead times, minimum order quantities and prices; the lower end for capacities.
Return ONLY JSON matching the schema, one entry per question.
The supplier's documents follow (spreadsheets as "[row N] A1=…", documents as "[p N]", emails as "[l N]"; PDFs and images attached).`;

const TEXT_CAP = 12_000; // TRD §8.5
const YES = "yes", NO = "no", UNCLEAR = "unclear or pending", NONE = "not answered";

const QaResult = z.object({
  answers: z.array(z.object({
    q_no: z.number().int(), found: z.boolean(), answer_raw: z.string().nullable(), answer_bool: z.boolean().nullable(),
    answer_number: z.number().nullable(), answer_text: z.string().nullable(),
    location: z.object({ type: z.string(), page: z.number().optional(), line: z.number().optional(), sheet: z.string().optional(), ref: z.string().optional(), snippet: z.string() }).nullable(),
    confidence: z.number().min(0).max(1),
  })),
});

export type QuestionnaireSummary = { answered: number; ambiguous: number; missing: number; failing: number[]; provider: string | null; sources: string[] };

/** TRD §8.5 — Q&A from questionnaire files, quotation files and the email body → questionnaire_answers. */
export async function questionnaire(resp: ResponseRow): Promise<QuestionnaireSummary> {
  if (!resp.vendor_id) throw new Error("Response has no vendor yet; assign one first.");
  const [{ data: files, error: fe }, { data: qs, error: qe }, { data: prior, error: pe }] = await Promise.all([
    db().from("response_files").select("*").eq("response_id", resp.id).in("file_kind", ["questionnaire", "quotation"]).order("created_at"),
    db().from("rfx_questions").select("*").eq("rfx_id", resp.rfx_id).order("q_no"),
    db().from("questionnaire_answers").select("question_id, state, response_id, answer_bool, answer_number, answer_raw").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id),
  ]);
  if (fe || qe || pe) throw fe ?? qe ?? pe;
  const questions = qs as RfxQuestion[];
  // A clarification reply may answer questions that were unclear, missing or asked about (latest answer wins); it never touches the rest.
  const scope = resp.is_clarification ? (await clarificationScope(resp)).questionIds : null;
  // A clarification held by the vendor check (normalise raised the card) answers nothing until the buyer keeps it.
  if (resp.is_clarification && await clarificationOnHold(resp.id)) return { answered: 0, ambiguous: 0, missing: 0, failing: [], provider: null, sources: [] };
  if (scope && !scope.size) return { answered: 0, ambiguous: 0, missing: 0, failing: [], provider: null, sources: [] }; // nothing it may answer: no model calls
  await clearStageReviews(resp.id, "questionnaire");

  // Questionnaire files first so the cap never cuts them.
  const ordered = (files as ResponseFile[]).sort((a, b) => Number(b.file_kind === "questionnaire") - Number(a.file_kind === "questionnaire"));
  const parts: Part[] = [];
  const sources: string[] = [];
  let budget = TEXT_CAP;
  for (const f of ordered) {
    if (f.derived_text_path) {
      if (budget <= 0) continue;
      const text = (await get("derived", f.derived_text_path)).toString("utf8").slice(0, budget);
      budget -= text.length;
      parts.push({ text: `### ${f.original_name}` }, ...vendorData(f.original_name, [{ text }]));
    } else if (f.derived_image_paths?.length) {
      parts.push({ text: `### ${f.original_name} (image)` }, ...vendorData(f.original_name, [inlineFile(await get("derived", f.derived_image_paths[0]), "image/png")]));
    } else {
      parts.push({ text: `### ${f.original_name} (PDF)` }, ...vendorData(f.original_name, [inlineFile(await get("raw", f.storage_path), "application/pdf")]));
    }
    sources.push(f.original_name);
  }
  if (resp.email_text && budget > 0) { parts.push({ text: "### email body" }, ...vendorData("email body", [{ text: cleanEmail(resp.email_text).slice(0, budget) }])); sources.push("email body"); }

  const qList = questions.map((q) => `Q${q.q_no} (${q.answer_type}): ${q.text}`).join(" | ");
  const qa = parts.length
    ? await generateJSON({ tier: "fast", purpose: "questionnaire", rfx_id: resp.rfx_id, response_id: resp.id, schema: QaResult, temperature: 0,
        parts: [{ text: `${P_QA.replace("{questions}", qList)}\n${VENDOR_DATA_RULE}` }, ...parts] })
    : { answers: [] };
  const byNo = new Map(qa.answers.map((a) => [a.q_no, a]));

  // One decide() per vendor: yes/no → choice (yes / no / unclear or pending / not answered); number & text → "stated" boolean.
  const found = questions.filter((q) => byNo.get(q.q_no)?.found);
  const dq: Record<string, Question> = {};
  for (const q of found) {
    dq[`q${q.q_no}`] = q.answer_type === "yes_no"
      ? { type: "choice", options: [YES, NO, UNCLEAR, NONE], instruction: `How does the supplier answer Q${q.q_no} ("${q.text}")? ${YES} = confirms, even partly or with a caveat or condition (e.g. "yes, on request", "only X regularly, Y on request", "yes if paid in 45 days"); ${NO} = denies; ${UNCLEAR} = neither confirms nor denies, e.g. still in process, planned, or expected later; ${NONE} = the text doesn't address it.` }
      : { type: "boolean", statement: `The supplier explicitly states ${q.answer_type === "number" ? "a number" : "an answer"} for Q${q.q_no} ("${q.text}"), and it is about exactly that — not a related figure such as a different lead time or quantity.` };
  }
  const state = found.map((q) => {
    const a = byNo.get(q.q_no)!;
    // The supplier's own words lead; the extractor's reading is secondary (it can pick the wrong figure off a photo).
    return `Q${q.q_no} (${q.answer_type}): ${q.text}\n  Supplier's text: "${(a.location?.snippet ?? a.answer_raw ?? "").slice(0, 300)}"${a.location?.snippet && a.answer_raw ? `\n  Extractor's reading (may be wrong; the supplier's text wins): "${a.answer_raw.slice(0, 200)}"` : ""}`;
  }).join("\n");
  const d = found.length ? await decide(state, dq, { purpose: "questionnaire", rfx_id: resp.rfx_id, response_id: resp.id }) : null;

  const reviewed = new Set((prior ?? []).filter((p) => p.state === "reviewed").map((p) => p.question_id));
  // An answer another reply from this vendor gave is never replaced by this one; a different answer raises a card instead.
  const elsewhere = new Map((prior ?? []).filter((p) => p.state !== "missing" && p.response_id !== resp.id && !scope?.has(p.question_id)).map((p) => [p.question_id, p]));
  const rows = questions.filter((q) => !reviewed.has(q.id)).map((q) => {
    const a = byNo.get(q.q_no);
    const base = { rfx_id: resp.rfx_id, question_id: q.id, vendor_id: resp.vendor_id, response_id: resp.id, answer_raw: a?.answer_raw ?? null, location: a?.location ?? null, provider: d?.provider ?? null, reviewed_by: null, reviewed_at: null };
    const missing = { ...base, state: "missing", answer_bool: null, answer_number: null, answer_text: null, probability: null, passes: null };
    if (!a?.found || !d) return missing;
    if (q.answer_type === "yes_no") {
      const c = choice(d, `q${q.q_no}`);
      const [py, pn] = [c.probabilities[YES] ?? 0, c.probabilities[NO] ?? 0];
      if (c.answer === NONE) return { ...missing, answer_raw: a.answer_raw, provider: d.provider };
      const pTrue = py + pn > 0 ? round(py / (py + pn)) : 0.5;
      if (c.answer === UNCLEAR || (pTrue >= 0.4 && pTrue <= 0.6)) {
        return { ...base, state: "ambiguous", answer_bool: null, answer_number: null, answer_text: a.answer_raw, probability: pTrue, passes: null };
      }
      const yes = pTrue > 0.5;
      return { ...base, state: "answered", answer_bool: yes, answer_number: null, answer_text: a.answer_raw, probability: pTrue, passes: passes(q.disqualify_if, { bool: yes }) };
    }
    const stated = bool(d, `q${q.q_no}`);
    const num = q.answer_type === "number" ? a.answer_number : null;
    if (stated < 0.5 || (q.answer_type === "number" && num === null)) return { ...missing, answer_raw: a.answer_raw, provider: d.provider, probability: round(stated) };
    return { ...base, state: "answered", answer_bool: null, answer_number: num, answer_text: a.answer_text ?? a.answer_raw, probability: round(stated), passes: passes(q.disqualify_if, { num }) };
  });
  // A clarification reply writes only real answers to in-scope questions ("not answered here" is not news).
  const write = rows.filter((r) => !elsewhere.has(r.question_id) && (!scope || (scope.has(r.question_id) && r.state !== "missing")));
  const disagree = rows.filter((r) => {
    const o = elsewhere.get(r.question_id);
    return o && r.state === "answered" && (r.answer_bool !== o.answer_bool || (r.answer_number !== null && Number(r.answer_number) !== Number(o.answer_number)));
  });
  if (write.length) {
    const { error } = await db().from("questionnaire_answers").upsert(write, { onConflict: "question_id,vendor_id" });
    if (error) throw error;
  }

  // Where each of two disagreeing answers came from, in words ("the email", "Qtn SBP-0912 Meridian.xlsx"), for the card (P10).
  const priorIds = [...new Set(disagree.map((r) => elsewhere.get(r.question_id)!.response_id).filter(Boolean))] as string[];
  const { data: priorResps } = priorIds.length ? await db().from("responses").select("id, email_text, response_files(original_name, file_kind)").in("id", priorIds) : { data: [] };
  const nameOf = (files: { original_name: string; file_kind?: string | null }[], hasEmail: boolean, loc?: { type?: string } | null) => {
    const docs = files.filter((f) => f.file_kind !== "supporting");
    if (loc?.type === "text" && hasEmail && !docs.length) return "the email";
    if (docs.length === 1 && loc?.type !== "text") return docs[0].original_name;
    return hasEmail && (!docs.length || loc?.type === "text") ? "the email" : docs[0]?.original_name ?? "their reply";
  };
  const thisFiles = (files as { original_name: string; file_kind: string | null }[]).map((f) => ({ original_name: f.original_name, file_kind: f.file_kind }));
  const reviews: ReviewInput[] = [...write.filter((r) => r.state === "ambiguous"), ...disagree].map((r) => {
    const q = questions.find((x) => x.id === r.question_id)!;
    const o = elsewhere.get(q.id);
    const pr = o ? (priorResps ?? []).find((x) => x.id === o.response_id) : undefined;
    return {
      type: "questionnaire_ambiguous", question_id: q.id,
      title: elsewhere.has(q.id) ? `Q${q.q_no}: two answers from this vendor — “${(elsewhere.get(q.id)!.answer_raw ?? "").slice(0, 40)}” vs “${(r.answer_raw ?? "").slice(0, 40)}”` : `Q${q.q_no}: “${(r.answer_raw ?? "").slice(0, 70)}”`,
      detail: elsewhere.has(q.id) ? `${q.text} The earlier answer stands until you decide.` : q.text, probability: r.probability,
      evidence: { location: r.location, snippet: r.location?.snippet ?? r.answer_raw, answer_type: q.answer_type,
        // P10: two answers from one vendor — both kept, each with where it came from; the earlier one stands until the buyer decides.
        ...(o ? { conflict: { earlier: { answer: o.answer_raw, from: pr ? nameOf((pr.response_files ?? []) as { original_name: string; file_kind: string | null }[], !!pr.email_text) : "their earlier reply" },
          other: { answer: r.answer_raw, from: nameOf(thisFiles, !!resp.email_text, r.location as { type?: string } | null) } } } : {}) },
    };
  });
  // Missing mandatory answers make the vendor "not cleared" (view 0004) — say so once, so the buyer can ask the vendor.
  if (scope) await resolveByReply(resp, { lineIds: [], questionIds: write.filter((r) => r.state === "answered").map((r) => r.question_id) });
  const missingMandatory = write.filter((r) => r.state === "missing").map((r) => questions.find((q) => q.id === r.question_id)!).filter((q) => q.mandatory);
  // Once per vendor: a second reply (a stray file, a clarification) doesn't repeat the card another reply already raised (P8).
  const already = missingMandatory.length && resp.vendor_id ? (await db().from("review_items").select("id").eq("rfx_id", resp.rfx_id).eq("vendor_id", resp.vendor_id)
    .eq("type", "questionnaire_missing").eq("status", "open").neq("response_id", resp.id).limit(1)).data?.length : 0;
  if (missingMandatory.length && !already) {
    reviews.push({
      type: "questionnaire_missing", title: `Questionnaire not returned: ${missingMandatory.length} mandatory ${missingMandatory.length === 1 ? "answer" : "answers"} missing`,
      detail: missingMandatory.map((q) => `Q${q.q_no} ${q.text}`).join(" · "), proposed_value: missingMandatory.length, evidence: { sources },
    });
  }
  await insertReviews(resp, "questionnaire", reviews);

  return {
    answered: rows.filter((r) => r.state === "answered").length, ambiguous: rows.filter((r) => r.state === "ambiguous").length,
    missing: rows.filter((r) => r.state === "missing").length,
    failing: rows.filter((r) => r.passes === false).map((r) => questions.find((q) => q.id === r.question_id)!.q_no),
    provider: d?.provider ?? null, sources,
  };
}

/** disqualify_if: "no" | "yes" | "lt:N" | "lte:N" | "gt:N" | "gte:N" → does the answer pass? Null when there is no rule. */
export function passes(rule: string | null, a: { bool?: boolean; num?: number | null }): boolean | null {
  if (!rule) return true;
  if (rule === "no") return a.bool !== false;
  if (rule === "yes") return a.bool !== true;
  const m = rule.match(/^(lt|lte|gt|gte):(-?\d+(?:\.\d+)?)$/);
  if (!m || a.num === null || a.num === undefined) return null;
  const n = Number(m[2]);
  const fails = { lt: a.num < n, lte: a.num <= n, gt: a.num > n, gte: a.num >= n }[m[1] as "lt"];
  return !fails;
}

const round = (p: number) => Math.round(p * 1000) / 1000;
