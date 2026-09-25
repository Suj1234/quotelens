"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// One sync at a time per tab, shared by the header button, the RFx frame's 30 s poll and the Review queue's
// "Sync inbox — X replied" (TRD §15.3, DESIGN §2.3 / §3.6).
type State = { busy: boolean; label: string | null };
let state: State = { busy: false, label: null };
const subs = new Set<() => void>();
const set = (s: State) => { state = s; subs.forEach((f) => f()); };
const useSyncState = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state, () => state);

type SyncResult = { new_responses: { response_id: string; vendor: string | null; clarification: boolean }[]; skipped: unknown[]; ignored: unknown[] };

/** Read one response's run-all NDJSON stream to the end; true when every stage finished. */
async function runAll(id: string): Promise<boolean> {
  const r = await fetch(`/api/responses/${id}/run-all`, { method: "POST" });
  const text = await r.text();
  return r.ok && !text.split("\n").filter(Boolean).some((l) => JSON.parse(l).status === "error");
}

/** Run the six stages on each reply, two at a time; onDone fires after each one. Returns how many stopped at a stage. */
export async function readReplies(ids: string[], onDone?: (finished: number) => void): Promise<number> {
  let failed = 0, finished = 0;
  const queue = [...ids];
  await Promise.all([0, 1].map(async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (!(await runAll(id).catch(() => false))) failed++;
      onDone?.(++finished);
    }
  }));
  return failed;
}

/** Sync the mailbox, then run the six stages on each new reply, two at a time. Returns how many arrived. */
export async function syncNow(rfxId: string, o: { quiet?: boolean; refresh: () => void }): Promise<number> {
  if (state.busy) return 0;
  set({ busy: true, label: "Syncing…" });
  try {
    const r = await fetch("/api/email/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx_id: rfxId }) })
      .catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${j.error ?? "Sync failed"} (${j.code ?? r.status})`);
    const got = (j as SyncResult).new_responses;
    const ignored = (j as SyncResult).ignored.length;
    if (!got.length) {
      if (!o.quiet) toast(ignored ? `Nothing new for this RFx — ${ignored} unrelated ${ignored === 1 ? "email" : "emails"} ignored` : "Nothing new");
      return 0;
    }
    const n = got.length;
    set({ busy: true, label: `Syncing… ${n} new ${n === 1 ? "reply" : "replies"}, processing` });
    o.refresh();
    const failed = await readReplies(got.map((g) => g.response_id));
    const names = [...new Set(got.map((g) => g.vendor ?? "an unknown sender"))];
    const what = got.every((g) => g.clarification) ? (n === 1 ? "clarification reply" : "clarification replies") : n === 1 ? "reply" : "replies";
    toast.success(`Synced — ${n} new ${what} from ${names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ")}${failed ? ` · ${failed} stopped at a stage, open it to retry` : ""}`);
    o.refresh();
    return n;
  } catch (e) {
    toast.error((e as Error).message);
    return 0;
  } finally {
    set({ busy: false, label: null });
  }
}

/** DESIGN §2.3 header button (buyer only, left of Ask). */
export function SyncInboxButton({ rfxId }: { rfxId: string }) {
  const router = useRouter();
  const s = useSyncState();
  return <Button disabled={s.busy} onClick={() => syncNow(rfxId, { refresh: router.refresh })}>{s.label ?? "Sync inbox"}</Button>;
}

/** DESIGN §3.6 primary button once a tagged reply is waiting unread. */
export function SyncRepliedButton({ rfxId, vendor }: { rfxId: string; vendor: string }) {
  const router = useRouter();
  const s = useSyncState();
  return <Button variant="default" disabled={s.busy} onClick={() => syncNow(rfxId, { refresh: router.refresh })}>{s.label ?? `Sync inbox — ${vendor} replied`}</Button>;
}

/** TRD §15.3: every RFx tab (buyer, not draft or awarded) syncs every 30 s while visible, mock and Gmail alike; never overlapping, quiet when nothing is new. */
export function SyncPoller({ rfxId }: { rfxId: string }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && !state.busy) syncNow(rfxId, { quiet: true, refresh: router.refresh }); };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [rfxId, router]);
  return null;
}
