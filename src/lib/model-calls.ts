import "server-only";
import { db } from "@/lib/db";

export type ModelCallRow = {
  id: string; created_at: string; rfx_id: string | null; response_id: string | null; purpose: string; provider: string; model: string;
  input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; ok: boolean; error: string | null;
};
export type LogFilter = { rfx?: string | null; purpose?: string | null; provider?: string | null; ok?: boolean | null };

/** TRD §17.15: newest first, capped at 200. */
export async function listModelCalls(f: LogFilter = {}, limit = 200): Promise<ModelCallRow[]> {
  let q = db().from("model_calls").select("id, created_at, rfx_id, response_id, purpose, provider, model, input_tokens, output_tokens, latency_ms, ok, error")
    .order("created_at", { ascending: false }).limit(Math.min(limit, 200));
  if (f.rfx) q = q.eq("rfx_id", f.rfx);
  if (f.purpose) q = q.eq("purpose", f.purpose);
  if (f.provider) q = q.eq("provider", f.provider);
  if (f.ok != null) q = q.eq("ok", f.ok);
  const { data, error } = await q;
  if (error) throw error;
  return data as ModelCallRow[];
}

/** Settings are global: their changes are audit events without an rfx_id, listed under the Settings page. */
export async function recentSettingChanges(limit = 10) {
  const { data, error } = await db().from("audit_events").select("id, actor, payload, created_at").eq("event", "settings.changed")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((e) => e.actor))];
  const users = ids.length ? (await db().from("users").select("id, name").in("id", ids)).data ?? [] : [];
  return (data ?? []).map((e) => ({ ...e, actor_name: users.find((u) => u.id === e.actor)?.name ?? e.actor }));
}
