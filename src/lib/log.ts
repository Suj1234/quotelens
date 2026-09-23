import "server-only";
import { db } from "@/lib/db";

export type ModelCall = {
  rfx_id?: string | null; response_id?: string | null; purpose: string; provider: string; model: string;
  input_tokens?: number | null; output_tokens?: number | null; latency_ms: number; ok: boolean; error?: string | null;
  input_preview?: string; output_preview?: string;
};

/** Every model call lands in model_calls (CLAUDE.md rule 4). A logging failure is reported, never fatal. */
export async function logModelCall(row: ModelCall) {
  const { error } = await db().from("model_calls").insert({
    ...row,
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
