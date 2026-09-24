import "server-only";
import { db } from "@/lib/db";
import { costUsd, usageColumns, type Price, type Usage } from "@/lib/cost";

export type ModelCall = {
  rfx_id?: string | null; response_id?: string | null; purpose: string; provider: string; model: string;
  input_tokens?: number | null; output_tokens?: number | null; latency_ms: number; ok: boolean; error?: string | null;
  input_preview?: string; output_preview?: string;
  usage?: Usage; // Gemini usageMetadata: every token count + the cost are derived from it (migration 0012)
};

// Prices change rarely; a short cache keeps one lookup per model per minute per server instance.
const priceCache = new Map<string, { at: number; price: Price | null }>();
async function priceFor(model: string, day: string): Promise<Price | null> {
  const key = `${model}|${day}`, hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.price;
  const { data, error } = await db().from("model_prices").select("id, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok")
    .eq("model", model).lte("effective_from", day).or(`effective_to.is.null,effective_to.gte.${day}`).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const price = data ? { id: data.id, input_usd_per_mtok: Number(data.input_usd_per_mtok), output_usd_per_mtok: Number(data.output_usd_per_mtok),
    cached_input_usd_per_mtok: data.cached_input_usd_per_mtok === null ? null : Number(data.cached_input_usd_per_mtok) } : null;
  priceCache.set(key, { at: Date.now(), price });
  return price;
}

async function costColumns(row: ModelCall) {
  if (!row.usage) return { cost_note: row.ok ? "no usage returned" : "call failed — no usage returned" };
  try {
    const price = await priceFor(row.model, new Date().toISOString().slice(0, 10));
    if (!price) return { cost_note: `no price in model_prices for ${row.model}` };
    const usd = costUsd(row.usage, price);
    const { data } = await db().from("settings").select("value").eq("key", "fx_rates").maybeSingle();
    const rate = Number((data?.value as Record<string, { rate?: number }> | undefined)?.USD?.rate) || null;
    return { price_id: price.id, cost_usd: usd, usd_inr_rate: rate, cost_inr: rate ? Math.round(usd * rate * 1e6) / 1e6 : null, cost_note: rate ? null : "no USD rate in Settings — ₹ not computed" };
  } catch (e) {
    return { cost_note: `cost lookup failed: ${(e as Error).message.slice(0, 200)}` };
  }
}

/** Every model call lands in model_calls (CLAUDE.md rule 4), with its token breakdown and cost. A logging failure is reported, never fatal. */
export async function logModelCall(row: ModelCall) {
  const { usage, ...rest } = row;
  const tokens = usage ? usageColumns(usage) : {};
  const { error } = await db().from("model_calls").insert({
    ...rest, ...tokens, usage_raw: usage ?? null, ...(await costColumns(row)),
    input_preview: row.input_preview?.slice(0, 500),
    output_preview: row.output_preview?.slice(0, 500),
    error: row.error?.slice(0, 2000),
  });
  if (error) console.error("[log] model_calls insert failed:", error.message);
}

export async function audit(e: {
  rfx_id?: string | null; actor: string; event: string; entity_type?: string; entity_id?: string; payload?: Record<string, unknown>;
}) {
  const { error } = await db().from("audit_events").insert({ ...e, payload: e.payload ?? {} });
  if (error) console.error("[log] audit insert failed:", error.message);
}
