import "server-only";
import { ApiError, type Content, type Part } from "@google/genai";
import { BaseLlm, FunctionTool, Gemini, InMemorySessionService, LlmAgent, LogLevel, Runner, createEvent, setLogLevel, type LlmRequest, type LlmResponse } from "@google/adk";
import type { z } from "zod";
import { modelId } from "@/lib/ai/gemini";
import { AppError, requireEnv } from "@/lib/errors";
import { logModelCall } from "@/lib/log";

// P9 (docs/handoff/P9_Agents_Plan.md §4 A): the two conversations (co-pilot, analyst) run as Google ADK agents with tools.
// The model decides which tools to call; the tools act on the DB through the existing lib code and re-check everything
// server-side. The reply the user sees comes with `actions` — the tool calls that actually succeeded — so the UI never
// relies on the model's own account of what it changed.

setLogLevel(LogLevel.WARN); // ADK logs every request at INFO

type Ctx = { purpose: string; rfx_id?: string | null };
export type AgentEvent = { type: "step"; text: string } | { type: "action"; tool: string; text: string };
export type Action = { tool: string; text: string; data?: unknown; result?: unknown };

export type AgentTool<S extends z.ZodObject = z.ZodObject> = {
  name: string; description: string; parameters: S;
  /** One line shown while the tool runs ("Reading rfx_lines.xlsx…"). */
  step?: (input: z.infer<S>) => string;
  /** Result goes back to the model; `action` (a plain-text summary) is recorded only when the tool succeeded. */
  run: (input: z.infer<S>) => Promise<{ result: unknown; action?: string; data?: unknown }>;
};
export const tool = <S extends z.ZodObject>(t: AgentTool<S>) => t as unknown as AgentTool;

const previewReq = (r: LlmRequest) => (r.contents.at(-1)?.parts ?? [])
  .map((p) => p.text ?? (p.functionResponse ? `[result ${p.functionResponse.name}]` : p.inlineData ? `[${p.inlineData.mimeType}]` : "")).join(" ");
const previewRes = (r?: LlmResponse) => (r?.content?.parts ?? [])
  .map((p) => (p.thought ? "" : p.text ?? (p.functionCall ? `[call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args ?? {})})]` : ""))).join(" ");

/**
 * Every model call the agent makes goes through here: logged to model_calls with tokens and cost (CLAUDE.md rule 4),
 * retried once on 429/5xx/network (as gemini.ts does). `inner` is the real Gemini model, or a scripted one in tests.
 */
export class LoggedLlm extends BaseLlm {
  constructor(private inner: BaseLlm, private ctx: Ctx) { super({ model: inner.model }); }
  async *generateContentAsync(req: LlmRequest, stream?: boolean, signal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let last: LlmResponse | undefined, yielded = false;
      try {
        for await (const r of this.inner.generateContentAsync(req, stream, signal)) { last = r; yielded = true; yield r; }
        await logModelCall({
          ...this.ctx, provider: "gemini", model: this.model, latency_ms: Date.now() - t0, ok: !last?.errorCode,
          error: last?.errorCode ? `${last.errorCode}: ${last.errorMessage ?? ""}` : null,
          usage: last?.usageMetadata, input_preview: previewReq(req), output_preview: previewRes(last),
        });
        return;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined;
        await logModelCall({ ...this.ctx, provider: "gemini", model: this.model, latency_ms: Date.now() - t0, ok: false, error: (e as Error).message, input_preview: previewReq(req) });
        const network = !status && /fetch failed|timed? ?out|ECONNRESET|socket/i.test(`${(e as Error).message} ${(e as Error).name}`);
        if (!yielded && attempt === 0 && !signal?.aborted && (network || (status && (status === 429 || status >= 500)))) { await new Promise((r) => setTimeout(r, 2000)); continue; }
        throw e;
      }
    }
  }
  connect(): never { throw new Error("Live connections are not used."); }
}

export type RunOpts = Ctx & {
  /** A function is re-evaluated before every model call (so it can carry fresh state). */
  name: string; instruction: string | (() => Promise<string>); tools: AgentTool[];
  /** Prior turns, oldest first (rebuilt from the stored transcript on every request — no server-side session state). */
  history: { role: "user" | "model"; text: string }[];
  message: Part[];
  /** Runs before every tool call; throw an AppError to refuse (role, RFx state). The refusal goes back to the model. */
  check?: (tool: string) => Promise<void>;
  onEvent?: (e: AgentEvent) => void;
  maxLlmCalls?: number; timeoutMs?: number; temperature?: number;
  model?: BaseLlm; // tests only
};

/** One user message through the agent: model ↔ tools until it answers. Returns its reply and the actions that succeeded. */
export async function runAgent(o: RunOpts): Promise<{ reply: string; actions: Action[] }> {
  const actions: Action[] = [];
  const tools = o.tools.map((t) => new FunctionTool({
    name: t.name, description: t.description, parameters: t.parameters,
    execute: async (input: unknown) => {
      try {
        await o.check?.(t.name);
        const args = input as z.infer<typeof t.parameters>;
        if (t.step) o.onEvent?.({ type: "step", text: t.step(args) });
        const out = await t.run(args);
        if (out.action) { actions.push({ tool: t.name, text: out.action, data: out.data, result: out.result }); o.onEvent?.({ type: "action", tool: t.name, text: out.action }); }
        return out.result ?? { ok: true };
      } catch (e) {
        if (!(e instanceof AppError)) console.error(`[agent:${o.name}] tool ${t.name} failed:`, e);
        return { error: e instanceof AppError ? e.message : `The tool failed: ${(e as Error).message}` };
      }
    },
  }));
  const inner = o.model ?? new Gemini({ model: modelId("strong"), apiKey: requireEnv("GEMINI_API_KEY") });
  const agent = new LlmAgent({
    name: o.name, model: new LoggedLlm(inner, { purpose: o.purpose, rfx_id: o.rfx_id }), instruction: typeof o.instruction === "string" ? o.instruction : () => (o.instruction as () => Promise<string>)(), tools,
    generateContentConfig: { temperature: o.temperature ?? 0.3, thinkingConfig: { thinkingLevel: "LOW" as never } },
  });
  const sessions = new InMemorySessionService();
  const runner = new Runner({ appName: "quotelens", agent, sessionService: sessions });
  const session = await sessions.createSession({ appName: "quotelens", userId: "u" });
  for (const h of o.history) {
    if (!h.text.trim()) continue;
    await sessions.appendEvent({ session, event: createEvent({ invocationId: "history", author: h.role === "user" ? "user" : o.name, content: { role: h.role, parts: [{ text: h.text }] } }) });
  }

  const texts: string[] = [];
  const signal = AbortSignal.timeout(o.timeoutMs ?? 100_000);
  try {
    for await (const ev of runner.runAsync({ userId: "u", sessionId: session.id, newMessage: { role: "user", parts: o.message } satisfies Content, runConfig: { maxLlmCalls: o.maxLlmCalls ?? 8 }, abortSignal: signal })) {
      if (ev.errorCode) throw new Error(`${ev.errorCode}: ${ev.errorMessage ?? ""}`); // the step limit arrives this way too
      if (ev.author !== o.name) continue;
      const t = (ev.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
      if (t.trim()) texts.push(t.trim());
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = (e as Error).message ?? String(e);
    if (/Max number of llm calls/i.test(msg)) texts.push("I stopped here — that took more steps than I'm allowed in one message. Check what changed on the right and tell me what's left.");
    else if (signal.aborted) texts.push("I ran out of time on that one. Check what changed on the right and ask again for what's left.");
    else throw new AppError("MODEL_ERROR", `The ${o.name} failed: ${msg}`, undefined, 502);
  }
  // The reply is the model's last text (earlier texts are its notes between tool calls).
  return { reply: texts.at(-1) || (actions.length ? "Done." : "I couldn't produce a reply — try rephrasing."), actions };
}
