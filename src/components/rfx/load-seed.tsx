"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Mock-mode "Load seeded responses" (TRD §17.4): replaces earlier seed responses with the dataset files. */
export function LoadSeed({ rfxId, primary }: { rfxId: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function load(set: "clean" | "realistic") {
    setBusy(set);
    const res = await fetch(`/api/rfx/${rfxId}/seed-responses?set=${set}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast.error(`${body.error ?? "Loading failed"} (${body.code ?? res.status})`);
    toast(`Loaded ${body.response_ids.length} responses — open one to run its stages`);
    router.refresh();
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button variant={primary ? "default" : "outline"} size="sm" disabled={!!busy} onClick={() => load("clean")}>
        {busy === "clean" ? "Loading…" : "Load seeded responses"}
      </Button>
      <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => load("realistic")}>
        {busy === "realistic" ? "Loading…" : "Realistic set"}
      </Button>
    </div>
  );
}
