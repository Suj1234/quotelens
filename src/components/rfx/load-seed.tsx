"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readReplies } from "@/components/comms/sync-inbox";

/** Mock-mode "Load seeded responses" (TRD §17.4): replaces earlier seed responses with the dataset files, then reads them. */
export function LoadSeed({ rfxId, primary }: { rfxId: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<{ set: string; label: string } | null>(null);
  async function load(set: "clean" | "realistic") {
    setBusy({ set, label: "Loading…" });
    const res = await fetch(`/api/rfx/${rfxId}/seed-responses?set=${set}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(null); return toast.error(`${body.error ?? "Loading failed"} (${body.code ?? res.status})`); }
    const ids: string[] = body.response_ids;
    router.refresh();
    // Same six stages Sync inbox runs, so the Overview never sits on received-but-unread replies.
    setBusy({ set, label: `Processing 0 of ${ids.length}…` });
    const failed = await readReplies(ids, (n) => { setBusy({ set, label: `Processing ${n} of ${ids.length}…` }); router.refresh(); });
    setBusy(null);
    if (failed) toast.error(`${ids.length - failed} of ${ids.length} replies processed · ${failed} stopped at a stage — Retry is on the Overview`);
    else toast.success(`${ids.length} replies loaded and processed`);
    router.refresh();
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button variant={primary ? "default" : "outline"} size="sm" disabled={!!busy} onClick={() => load("clean")}>
        {busy?.set === "clean" ? busy.label : "Load seeded responses"}
      </Button>
      <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => load("realistic")}>
        {busy?.set === "realistic" ? busy.label : "Realistic set"}
      </Button>
    </div>
  );
}
