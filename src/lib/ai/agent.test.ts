import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import { AppError } from "@/lib/errors";

// Mock at the provider boundary (CLAUDE.md rule 3): a scripted model instead of Gemini, no network.
const logged: { purpose: string; ok: boolean; usage?: unknown }[] = [];
vi.mock("@/lib/log", () => ({ logModelCall: vi.fn(async (row) => { logged.push(row); }) }));
process.env.GEMINI_API_KEY = "test";
process.env.GEMINI_MODEL_STRONG = "strong-model";
const { runAgent, tool } = await import("./agent");

type Step = LlmResponse | ((req: LlmRequest) => LlmResponse);
class Scripted extends BaseLlm {
  requests: LlmRequest[] = [];
  constructor(private steps: Step[]) { super({ model: "scripted" }); }
  async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(structuredClone({ contents: req.contents }) as LlmRequest);
    const s = this.steps.shift() ?? { content: { role: "model", parts: [{ text: "out of script" }] } };
    yield typeof s === "function" ? s(req) : s;
  }
  connect(): never { throw new Error("no live"); }
}
const call = (name: string, args: Record<string, unknown>): LlmResponse => ({ content: { role: "model", parts: [{ functionCall: { name, args } }] }, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } });
const say = (text: string): LlmResponse => ({ content: { role: "model", parts: [{ text }] }, usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 } });
const lastToolResult = (req: LlmRequest) => req.contents.at(-1)?.parts?.find((p) => p.functionResponse)?.functionResponse?.response;

const done: string[] = [];
const add = tool({
  name: "add_item", description: "Add an item", parameters: z.object({ name: z.string().min(1) }),
  step: (i) => `Adding ${i.name}`,
  run: async ({ name }) => { done.push(name); return { result: { ok: true, count: done.length }, action: `Added ${name}` }; },
});
const base = { name: "test_agent", purpose: "test_agent", instruction: "test", tools: [add], history: [], message: [{ text: "go" }] };
beforeEach(() => { logged.length = 0; done.length = 0; });

test("tool runs, action recorded, every model call logged with its purpose and usage", async () => {
  const events: unknown[] = [];
  const model = new Scripted([call("add_item", { name: "box" }), (req) => say(`count=${(lastToolResult(req) as { count: number }).count}`)]);
  const out = await runAgent({ ...base, model, onEvent: (e) => events.push(e) });
  expect(out).toEqual({ reply: "count=1", actions: [{ tool: "add_item", text: "Added box", data: undefined }] });
  expect(done).toEqual(["box"]);
  expect(events).toEqual([{ type: "step", text: "Adding box" }, { type: "action", tool: "add_item", text: "Added box" }]);
  expect(logged.map((l) => [l.purpose, l.ok])).toEqual([["test_agent", true], ["test_agent", true]]);
  expect(logged[0].usage).toEqual({ promptTokenCount: 10, candidatesTokenCount: 2 });
});

test("server check refuses the tool: nothing runs, no action, the refusal goes back to the model", async () => {
  const model = new Scripted([call("add_item", { name: "box" }), (req) => say(`refused: ${(lastToolResult(req) as { error: string }).error}`)]);
  const out = await runAgent({ ...base, model, check: async () => { throw new AppError("FROZEN", "MER-1 is issued."); } });
  expect(done).toEqual([]);
  expect(out.actions).toEqual([]);
  expect(out.reply).toBe("refused: MER-1 is issued.");
});

test("invalid tool input (Zod) goes back to the model as an error, not thrown to the user", async () => {
  const model = new Scripted([call("add_item", { name: "" }), (req) => say(JSON.stringify(lastToolResult(req)).includes("error") ? "fixed" : "no error")]);
  const out = await runAgent({ ...base, model });
  expect(done).toEqual([]);
  expect(out.reply).toBe("fixed");
});

test("step limit stops a looping model with a plain message; actions so far are kept", async () => {
  const model = new Scripted(Array.from({ length: 20 }, (_, i) => call("add_item", { name: `x${i}` })));
  const out = await runAgent({ ...base, model, maxLlmCalls: 3 });
  expect(done.length).toBe(3);
  expect(out.actions.length).toBe(3);
  expect(out.reply).toMatch(/more steps than I'm allowed/);
});

test("history is replayed to the model before the new message", async () => {
  const model = new Scripted([say("ok")]);
  await runAgent({ ...base, model, history: [{ role: "user", text: "earlier question" }, { role: "model", text: "earlier answer" }] });
  const texts = model.requests[0].contents.map((c) => `${c.role}:${c.parts?.map((p) => p.text).join("")}`);
  expect(texts).toEqual(["user:earlier question", "model:earlier answer", "user:go"]);
});
