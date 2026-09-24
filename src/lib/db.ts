import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/errors";

let client: SupabaseClient | undefined;

// Service-role client (bypasses RLS). Server only; created lazily so builds don't need env.
export function db(): SupabaseClient {
  client ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    // A dropped connection fails after 60 s (visible error, stage can be retried) instead of hanging the request forever.
    global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) }) },
  });
  return client;
}
