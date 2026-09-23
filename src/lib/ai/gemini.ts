import "server-only";
import { ApiError, GoogleGenAI, type Content, type Part } from "@google/genai";
import { z } from "zod";
import { AppError, requireEnv } from "@/lib/errors";
import { logModelCall } from "@/lib/log";

export type { Part };
export type Tier = "fast" | "strong";
type Ctx = { purpose: string; rfx_id?: string | null; response_id?: string | null };

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") }));
export const modelId = (tier: Tier) => requireEnv(tier === "fast" ? "GEMINI_MODEL_FAST" : "GEMINI_MODEL_STRONG");

const preview = (contents: Content[]) =>
  contents.flatMap((c) => c.parts ?? []).map((p) => p.text ?? (p.inlineData ? `[${p.inlineData.mimeType}]` : "")).join(" ");

/** One API call with logging; retries once on 429/5xx after 2 s (TRD §19). */
async function call(tier: Tier, contents: Content[], config: Record<string, unknown>, { purpose, rfx_id, response_id }: Ctx) {
  const model = modelId(tier);
  const ctx = { purpose, rfx_id, response_id };
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    try {
      const res = await ai().models.generateContent({ model, contents, config });
      const text = res.text ?? "";
      await logModelCall({
        ...ctx, provider: "gemini", model, latency_ms: Date.now() - t0, ok: true,
        input_tokens: res.usageMetadata?.promptTokenCount, output_tokens: res.usageMetadata?.candidatesTokenCount,
        input_preview: preview(contents), output_preview: text,
      });
      return text;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      await logModelCall({ ...ctx, provider: "gemini", model, latency_ms: Date.now() - t0, ok: false, error: (e as Error).message, input_preview: preview(contents) });
      if (attempt === 0 && status && (status === 429 || status >= 500)) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      throw new AppError("MODEL_ERROR", `Gemini call failed (${ctx.purpose}): ${(e as Error).message}`, { status }, 502);
    }
  }
}

/**
 * Structured call: JSON schema from Zod, output validated with the same Zod schema.
 * On invalid output, retry once with the validation error appended; then fail visibly (CLAUDE.md rule 5).
 */
export async function generateJSON<S extends z.ZodType>(opts: Ctx & {
  tier: Tier; system?: string; parts: Part[]; schema: S; temperature?: number;
}): Promise<z.infer<S>> {
  const config = {
    temperature: opts.temperature ?? 0.1,
    systemInstruction: opts.system,
    responseMimeType: "application/json",
    responseJsonSchema: z.toJSONSchema(opts.schema),
  };
  const contents: Content[] = [{ role: "user", parts: opts.parts }];
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await call(opts.tier, contents, config, opts);
    const parsed = safeJson(text);
    const result = parsed.ok ? opts.schema.safeParse(parsed.value) : null;
    if (result?.success) return result.data;
    problem = parsed.ok ? z.prettifyError(result!.error) : `not valid JSON: ${parsed.error}`;
    console.warn(`[ai] ${opts.purpose}: invalid output (attempt ${attempt + 1}): ${problem.slice(0, 300)}`);
    contents.push(
      { role: "model", parts: [{ text }] },
      { role: "user", parts: [{ text: `Your previous output failed validation: ${problem}\nFix it and return only JSON matching the schema.` }] },
    );
  }
  throw new AppError("MODEL_INVALID", `Model output failed validation twice (${opts.purpose}): ${problem.slice(0, 500)}`, undefined, 502);
}

/** Plain-text call (e.g. P-CAPTION). */
export async function generateText(opts: Ctx & { tier: Tier; system?: string; parts: Part[]; temperature?: number }) {
  return (await call(opts.tier, [{ role: "user", parts: opts.parts }], { temperature: opts.temperature ?? 0.1, systemInstruction: opts.system }, opts)).trim();
}

function safeJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export const inlineFile = (buf: Buffer, mimeType: string): Part => ({ inlineData: { mimeType, data: buf.toString("base64") } });
