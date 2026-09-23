import "server-only";
import { z } from "zod";
import { generateJSON, modelId } from "@/lib/ai/gemini";
import type { Answer, DecideCtx, DecisionResult, Question } from "../index";

// TRD §10.4 (P-DECIDE)
const PROMPT = `You are a decision engine. You will be given STATE and a set of typed QUESTIONS. Answer every question strictly within its type:
- choice: pick exactly one option from the list; also give a probability for every option (they must sum to 1).
- boolean: give the probability (0-1) that the statement is TRUE of the state.
- score: give a number within the scale.
Base answers only on the STATE. Do not explain. Calibrate: if the state does not settle the question, spread probability instead of guessing.
STATE:
{state}
QUESTIONS (JSON):
{questions}
Return ONLY JSON matching the schema. For choice questions, "probabilities" lists one probability per option, in the same order as the options.`;

const p01 = z.number().min(0).max(1);

/** Schema built from the question set, so structured output enforces one answer per question. */
function schemaFor(questions: Record<string, Question>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [id, q] of Object.entries(questions)) {
    shape[id] = q.type === "choice"
      ? z.object({ probabilities: z.array(p01).length(q.options.length) })
      : q.type === "boolean"
        ? z.object({ probability: p01 })
        : z.object({ answer: z.number().min(q.scale.min).max(q.scale.max), confidence: p01 });
  }
  return z.object({ answers: z.object(shape) });
}

export async function geminiDecide(state: string, questions: Record<string, Question>, ctx: DecideCtx): Promise<DecisionResult> {
  const t0 = Date.now();
  const out = await generateJSON({
    ...ctx, tier: "fast", temperature: 0, schema: schemaFor(questions),
    parts: [{ text: PROMPT.replace("{state}", state).replace("{questions}", JSON.stringify(questions, null, 1)) }],
  });
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = (out.answers as Record<string, { probabilities?: number[]; probability?: number; answer?: number; confidence?: number }>)[id];
    if (q.type === "choice") {
      const ps = normalise(a.probabilities!);
      const order = ps.map((p, i) => [p, i] as const).sort((x, y) => y[0] - x[0]);
      answers[id] = {
        type: "choice", answer: q.options[order[0][1]],
        probabilities: Object.fromEntries(q.options.map((o, i) => [o, ps[i]])),
        confidence: order[0][0] - (order[1]?.[0] ?? 0), // margin, TRD §10.4
      };
    } else if (q.type === "boolean") {
      answers[id] = { type: "boolean", probability: clamp(a.probability!) };
    } else {
      answers[id] = { type: "score", answer: a.answer!, confidence: clamp(a.confidence!) };
    }
  }
  return { answers, provider: "gemini", model: modelId("fast"), latency_ms: Date.now() - t0 };
}

const clamp = (p: number) => Math.min(1, Math.max(0, p));
export function normalise(ps: number[]) {
  const c = ps.map(clamp);
  const sum = c.reduce((a, b) => a + b, 0);
  return sum > 0 ? c.map((p) => p / sum) : c.map(() => 1 / c.length);
}
