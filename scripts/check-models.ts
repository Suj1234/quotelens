// P0-T6 · Lists Gemini models for this key and checks each candidate on: a 1-line JSON-schema prompt, a PDF, a photo.
// Usage: npm run check:models [-- model-a model-b …]   (default: GEMINI_MODEL_FAST and GEMINI_MODEL_STRONG)
// Setup tool only — app code calls Gemini through src/lib/ai/gemini.ts (P1-T3), which logs to model_calls.
import fs from "node:fs";
import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { requireEnv } from "@/lib/errors";

const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
const seed = (p: string) => fs.readFileSync(`supabase/seed/${p}`).toString("base64");

const available: string[] = [];
for await (const m of await ai.models.list({ config: { pageSize: 100 } })) {
  if (m.name?.includes("gemini") && m.supportedActions?.includes("generateContent")) available.push(m.name.replace("models/", ""));
}
console.log(`[models] ${available.length} Gemini models support generateContent for this key`);

const Ping = z.object({ ok: z.boolean(), capital_of_india: z.string() });
const Doc = z.object({
  vendor_name: z.string(),
  currency: z.string(),
  priced_rows: z.number().int(),
  footnotes: z.array(z.string()),
});
const TESTS: { name: string; schema: z.ZodType; parts: Part[] }[] = [
  { name: "json", schema: Ping, parts: [{ text: "Reply with ok=true and the capital of India." }] },
  {
    name: "pdf", schema: Doc,
    parts: [
      { inlineData: { mimeType: "application/pdf", data: seed("02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf") } },
      { text: "From this quotation: vendor name, currency, number of rows that carry a price, and every footnote verbatim." },
    ],
  },
  {
    name: "image", schema: Doc,
    parts: [
      { inlineData: { mimeType: "image/jpeg", data: seed("04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg") } },
      { text: "From this photographed rate card: vendor name, currency, number of rows that carry a price, and every footnote verbatim." },
    ],
  },
];

const models = process.argv.slice(2).length ? process.argv.slice(2) : [requireEnv("GEMINI_MODEL_FAST"), requireEnv("GEMINI_MODEL_STRONG")];
let failed = false;
for (const model of [...new Set(models)]) {
  if (!available.includes(model)) { console.log(`✗ ${model}: not available to this key`); failed = true; continue; }
  for (const t of TESTS) {
    const t0 = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: t.parts }],
        config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(t.schema) },
      });
      const out = t.schema.parse(JSON.parse(res.text ?? ""));
      const u = res.usageMetadata;
      console.log(`✓ ${model.padEnd(24)} ${t.name.padEnd(5)} ${String(Date.now() - t0).padStart(6)} ms  in=${u?.promptTokenCount} out=${u?.candidatesTokenCount}  ${JSON.stringify(out).slice(0, 200)}`);
    } catch (e) {
      failed = true;
      console.log(`✗ ${model.padEnd(24)} ${t.name.padEnd(5)} ${String(Date.now() - t0).padStart(6)} ms  ${(e as Error).message.slice(0, 200)}`);
    }
  }
}
process.exitCode = failed ? 1 : 0;
