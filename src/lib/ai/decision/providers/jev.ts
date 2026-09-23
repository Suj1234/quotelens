import "server-only";
import { AppError } from "@/lib/errors";
import { logModelCall } from "@/lib/log";
import type { Answer, DecideCtx, DecisionResult, Question } from "../index";
import { normalise } from "./gemini";

// TRD §10.3. Shape verified 2026-09-24 (DECISIONS.md): POST {model, state, questions:{id:{type, instructions, criteria?}}}
// → {id, model, provider, answers:{id:{type, noul | choice+probabilities+confidence | score+legend+probabilities}}, usage}.
// OpenRouter's SDK guide documents /api/v1/systemone, its blog /api/alpha/decisions; try both, in that order.
const ENDPOINTS = ["https://openrouter.ai/api/v1/systemone", "https://openrouter.ai/api/alpha/decisions"];
const TIMEOUT_MS = 8000;

export const jevModel = () => process.env.OPENROUTER_JEV_MODEL || "typesafe/jev-1.13";

type JevQ = { type: "noul" | "choice" | "score"; instructions: string; criteria?: Record<string, string> | string[] };
type JevA = { type?: string; noul?: number; choice?: string; score?: number; probabilities?: Record<string, number>; confidence?: number };

/** Our Question → TypeSafe primitive. Choice options become keys o0..oN so long option text never has to round-trip. */
export function toJev(q: Question): JevQ {
  if (q.type === "boolean") return { type: "noul", instructions: q.statement };
  if (q.type === "choice") {
    return { type: "choice", instructions: q.instruction ?? "Pick the option that fits the state.", criteria: Object.fromEntries(q.options.map((o, i) => [`o${i}`, o])) };
  }
  return { type: "score", instructions: q.instruction ?? "Score the state.", criteria: levels(q) };
}

/** TypeSafe answer → ours. Throws on anything unexpected so decide() falls back to Gemini. */
export function fromJev(q: Question, a: JevA | undefined): Answer {
  if (!a) throw new Error("answer missing");
  if (q.type === "boolean") {
    if (typeof a.noul !== "number") throw new Error("noul missing");
    return { type: "boolean", probability: Math.min(1, Math.max(0, a.noul)) };
  }
  if (q.type === "choice") {
    if (!a.probabilities) throw new Error("choice probabilities missing");
    const ps = normalise(q.options.map((_, i) => a.probabilities![`o${i}`] ?? 0));
    const order = ps.map((p, i) => [p, i] as const).sort((x, y) => y[0] - x[0]);
    return {
      type: "choice", answer: q.options[order[0][1]],
      probabilities: Object.fromEntries(q.options.map((o, i) => [o, ps[i]])),
      confidence: a.confidence ?? order[0][0] - (order[1]?.[0] ?? 0),
    };
  }
  if (typeof a.score !== "number") throw new Error("score missing");
  const n = levels(q).length; // Jev's score is a weighted average over level indices 0..n-1
  return { type: "score", answer: q.scale.min + (a.score / Math.max(1, n - 1)) * (q.scale.max - q.scale.min), confidence: a.confidence ?? 0 };
}

function levels(q: Extract<Question, { type: "score" }>): string[] {
  if (q.scale.labels?.length) return q.scale.labels;
  const out: string[] = [];
  for (let v = q.scale.min; v <= q.scale.max; v++) out.push(String(v));
  return out;
}

export async function jevDecide(state: string, questions: Record<string, Question>, ctx: DecideCtx): Promise<DecisionResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AppError("ENV_MISSING", "OPENROUTER_API_KEY not set", undefined, 500);
  const model = jevModel();
  const body = JSON.stringify({ model, state, questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, toJev(q)])) });
  const t0 = Date.now();
  try {
    const json = await post(body, key);
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(questions)) answers[id] = fromJev(q, (json.answers as Record<string, JevA>)?.[id]);
    const usage = json.usage as { prompt_tokens?: number; input_tokens?: number } | undefined;
    await logModelCall({ ...ctx, provider: "jev-openrouter", model, latency_ms: Date.now() - t0, ok: true, input_tokens: usage?.prompt_tokens ?? usage?.input_tokens, output_tokens: 0, input_preview: state, output_preview: JSON.stringify(json.answers) });
    return { answers, provider: "jev-openrouter", model, latency_ms: Date.now() - t0, raw: json };
  } catch (e) {
    await logModelCall({ ...ctx, provider: "jev-openrouter", model, latency_ms: Date.now() - t0, ok: false, error: (e as Error).message, input_preview: state });
    throw e;
  }
}

/** 8 s timeout; one retry on 429/5xx with 1 s backoff; 404 → next documented endpoint. */
async function post(body: string, key: string): Promise<Record<string, unknown>> {
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      });
      if (res.ok) return (await res.json()) as Record<string, unknown>;
      if (res.status === 404) break;
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }
  throw new Error("Jev endpoint not found (404 on every documented URL)");
}
