import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";

// Mock at the provider boundary (CLAUDE.md rule 3): queued fake responses, no network.
const queue: Array<string | Error> = [];
const seen: unknown[] = [];
vi.mock("@google/genai", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, m: string) { super(m); } },
  GoogleGenAI: class {
    models = {
      generateContent: async (req: unknown) => {
        seen.push(req);
        const next = queue.shift()!;
        if (next instanceof Error) throw next;
        return { text: next, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
      },
    };
  },
}));
vi.mock("@/lib/log", () => ({ logModelCall: vi.fn(async () => {}) }));

process.env.GEMINI_API_KEY = "test";
process.env.GEMINI_MODEL_FAST = "fast-model";
process.env.GEMINI_MODEL_STRONG = "strong-model";
const { generateJSON } = await import("./gemini");
const { ApiError } = await import("@google/genai");
const FakeApiError = ApiError as unknown as new (status: number, message: string) => Error;
const schema = z.object({ n: z.number() });
const run = () => generateJSON({ tier: "fast", purpose: "test", parts: [{ text: "hi" }], schema });

beforeEach(() => { queue.length = 0; seen.length = 0; });

test("valid JSON passes through", async () => {
  queue.push('{"n": 3}');
  expect(await run()).toEqual({ n: 3 });
});

test("invalid output → one retry with the validation error appended", async () => {
  queue.push('{"n": "three"}', '{"n": 3}');
  expect(await run()).toEqual({ n: 3 });
  const retry = seen[1] as { contents: { role: string; parts: { text: string }[] }[] };
  expect(retry.contents).toHaveLength(3);
  expect(retry.contents[2].parts[0].text).toMatch(/failed validation/);
});

test("invalid twice → MODEL_INVALID", async () => {
  queue.push("not json", '{"n": null}');
  await expect(run()).rejects.toMatchObject({ code: "MODEL_INVALID" });
});

test("429 is retried once, other errors are not", async () => {
  queue.push(new FakeApiError(429, "slow down"), '{"n": 1}');
  expect(await run()).toEqual({ n: 1 });
  queue.push(new FakeApiError(400, "bad request"));
  await expect(run()).rejects.toMatchObject({ code: "MODEL_ERROR" });
}, 10_000);
