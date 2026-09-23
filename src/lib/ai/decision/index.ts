import "server-only";
import { getSetting } from "@/lib/settings";
import { geminiDecide } from "./providers/gemini";

// TRD §10.1
export type ChoiceQ = { type: "choice"; options: string[]; instruction?: string };
export type ScoreQ = { type: "score"; scale: { min: number; max: number; labels?: string[] }; instruction?: string };
export type BoolQ = { type: "boolean"; statement: string };
export type Question = ChoiceQ | ScoreQ | BoolQ;

export type ChoiceA = { type: "choice"; answer: string; probabilities: Record<string, number>; confidence: number };
export type ScoreA = { type: "score"; answer: number; confidence: number };
export type BoolA = { type: "boolean"; probability: number };
export type Answer = ChoiceA | ScoreA | BoolA;

export interface DecisionResult {
  answers: Record<string, Answer>;
  provider: "jev-openrouter" | "gemini";
  model: string;
  latency_ms: number;
  raw?: unknown;
}
export type DecideCtx = { rfx_id?: string | null; response_id?: string | null; purpose: string };

/** Every typed decision goes through here (CLAUDE.md rule 4). */
export async function decide(state: string, questions: Record<string, Question>, ctx: DecideCtx): Promise<DecisionResult> {
  const provider = await getSetting("decision_provider");
  // ponytail: Gemini emulation only until P2-T1 adds the OpenRouter → Jev adapter (auto/jev fall back to Gemini).
  void provider;
  return geminiDecide(state.slice(0, 6000), questions, ctx);
}

export const choice = (r: DecisionResult, id: string) => r.answers[id] as ChoiceA;
export const bool = (r: DecisionResult, id: string) => (r.answers[id] as BoolA).probability;
