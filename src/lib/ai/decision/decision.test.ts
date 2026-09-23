import { beforeEach, expect, test, vi } from "vitest";

// Provider boundary mocks only (CLAUDE.md rule 3): Gemini SDK and fetch (OpenRouter).
const gemini: string[] = [];
vi.mock("@google/genai", () => ({
  ApiError: class extends Error {},
  GoogleGenAI: class { models = { generateContent: async () => ({ text: gemini.shift()!, usageMetadata: {} }) }; },
}));
const logged: { provider: string; ok: boolean }[] = [];
vi.mock("@/lib/log", () => ({ logModelCall: vi.fn(async (r: { provider: string; ok: boolean }) => { logged.push(r); }) }));
let providerSetting = "auto";
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => providerSetting) }));

process.env.GEMINI_API_KEY = "test";
process.env.GEMINI_MODEL_FAST = "fast-model";
const { decide } = await import("./index");

const Q = { line: { type: "choice" as const, options: ["L1", "L2", "none_of_these"] }, prices: { type: "boolean" as const, statement: "has prices" } };
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

beforeEach(() => { gemini.length = 0; logged.length = 0; providerSetting = "auto"; delete process.env.OPENROUTER_API_KEY; vi.unstubAllGlobals(); });

test("Gemini emulation: choice probabilities renormalised to sum to 1, margin confidence", async () => {
  gemini.push(JSON.stringify({ answers: { line: { probabilities: [0.6, 0.3, 0.3] }, prices: { probability: 0.9 } } }));
  const r = await decide("state", Q, { purpose: "test" });
  const a = r.answers.line as { answer: string; probabilities: Record<string, number>; confidence: number };
  expect(r.provider).toBe("gemini");
  expect(sum(a.probabilities)).toBeCloseTo(1, 10);
  expect(a.answer).toBe("L1");
  expect(a.confidence).toBeCloseTo(0.5 - 0.25, 10);
});

test("Jev: request uses noul/choice primitives; answers mapped back; probabilities sum to 1", async () => {
  process.env.OPENROUTER_API_KEY = "k";
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    expect(body.questions.prices).toEqual({ type: "noul", instructions: "has prices" });
    expect(body.questions.line.criteria).toEqual({ o0: "L1", o1: "L2", o2: "none_of_these" });
    return new Response(JSON.stringify({ answers: { line: { type: "choice", choice: "o1", probabilities: { o0: 0.1, o1: 0.7, o2: 0.1 }, confidence: 0.6 }, prices: { type: "noul", noul: 0.98 } } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const r = await decide("state", Q, { purpose: "test" });
  const a = r.answers.line as { answer: string; probabilities: Record<string, number> };
  expect(r.provider).toBe("jev-openrouter");
  expect(a.answer).toBe("L2");
  expect(sum(a.probabilities)).toBeCloseTo(1, 10);
  expect((r.answers.prices as { probability: number }).probability).toBe(0.98);
});

test("Jev error → falls back to Gemini, failure logged", async () => {
  process.env.OPENROUTER_API_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
  gemini.push(JSON.stringify({ answers: { line: { probabilities: [0, 0, 1] }, prices: { probability: 0.1 } } }));
  const r = await decide("state", Q, { purpose: "test" });
  expect(r.provider).toBe("gemini");
  expect(logged.some((l) => l.provider === "jev-openrouter" && !l.ok)).toBe(true);
});

test("setting 'gemini' never calls Jev even with a key", async () => {
  process.env.OPENROUTER_API_KEY = "k";
  providerSetting = "gemini";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  gemini.push(JSON.stringify({ answers: { line: { probabilities: [1, 0, 0] }, prices: { probability: 1 } } }));
  expect((await decide("state", Q, { purpose: "test" })).provider).toBe("gemini");
  expect(fetchMock).not.toHaveBeenCalled();
});
