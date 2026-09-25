"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readReplies } from "@/components/comms/sync-inbox";

/** Overview "Needs you": run the six stages on replies that stopped or were never processed (Process now · Retry · Process all). */
export function ReadReplies({ ids, label }: { ids: string[]; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function go() {
    setBusy(ids.length > 1 ? `Processing 0 of ${ids.length}…` : "Processing…");
    const failed = await readReplies(ids, (n) => { if (ids.length > 1) setBusy(`Processing ${n} of ${ids.length}…`); router.refresh(); });
    setBusy(null);
    if (failed) toast.error(`${failed === ids.length ? "Processing" : `${failed} of ${ids.length}`} stopped at a stage — the reason is on the Overview`);
    router.refresh();
  }
  return <Button size="xs" variant="outline" disabled={!!busy} onClick={go}>{busy ?? label}</Button>;
}
