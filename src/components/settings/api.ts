import { toast } from "sonner";

/** JSON request → body, or a toast with what happened and the code (TRD §19 client rule), then null. */
export async function send<T>(url: string, method: string, payload?: unknown, what = "Couldn't save"): Promise<T | null> {
  try {
    const res = await fetch(url, { method, headers: payload ? { "content-type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(`${what}: ${body.error ?? res.statusText} (${body.code ?? res.status})`); return null; }
    return body as T;
  } catch {
    toast.error(`${what}: no connection — check the network and try again (NETWORK)`);
    return null;
  }
}
