"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readReplies } from "@/components/comms/sync-inbox";
import type { SeedPickVendor } from "@/lib/responses";

/**
 * Mock-mode "Load seeded responses" (TRD §17.4): the buyer picks which invited vendors get the dataset's reply
 * (default: those who haven't replied another way), then the replies are read. Earlier seed replies are replaced;
 * email and portal replies stay, and any of them whose cells a removed seed reply had taken are read again first.
 */
export function LoadSeed({ rfxId, vendors, primary }: { rfxId: string; vendors: SeedPickVendor[]; primary?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState<"clean" | "realistic">("clean");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const show = () => { setPicked(vendors.filter((v) => v.available && !v.replied).map((v) => v.id)); setOpen(true); };

  async function load() {
    setOpen(false);
    setBusy("Loading…");
    const res = await fetch(`/api/rfx/${rfxId}/seed-responses?set=${set}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_ids: picked }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(null); return toast.error(`${body.error ?? "Loading failed"} (${body.code ?? res.status})`); }
    const ids: string[] = body.response_ids, rerun: string[] = body.rerun_ids ?? [];
    router.refresh();
    // Replies kept from email / the portal first, one at a time (a clarification after the reply it answers).
    let failed = 0;
    for (const [i, id] of rerun.entries()) {
      setBusy(`Re-reading kept reply ${i + 1} of ${rerun.length}…`);
      failed += await readReplies([id]);
    }
    // Same six stages Sync inbox runs, so the Overview never sits on received-but-unread replies.
    setBusy(`Processing 0 of ${ids.length}…`);
    failed += await readReplies(ids, (n) => { setBusy(`Processing ${n} of ${ids.length}…`); router.refresh(); });
    setBusy(null);
    const all = ids.length + rerun.length;
    if (failed) toast.error(`${all - failed} of ${all} replies processed · ${failed} stopped at a stage — Retry is on the Overview`);
    else toast.success(`${ids.length} sample ${ids.length === 1 ? "reply" : "replies"} loaded and processed${rerun.length ? ` · ${rerun.length} kept ${rerun.length === 1 ? "reply" : "replies"} read again` : ""}`);
    router.refresh();
  }

  const note = (v: SeedPickVendor) => !v.available ? "No sample reply in the dataset"
    : v.replied ? "Already replied by email or portal — a sample reply would be a second one"
    : v.seeded ? "Has a sample reply — loading replaces it" : "No reply yet";
  return (
    <>
      <Button variant={primary ? "default" : "outline"} size="sm" disabled={!!busy} onClick={show}>{busy ?? "Load seeded responses"}</Button>
      {open && <>
        <div className="scrim" onClick={() => setOpen(false)} />
        <div role="dialog" aria-label="Load seeded responses" className="card" style={{ position: "fixed", top: "12vh", maxHeight: "80vh", overflow: "auto", left: "50%", transform: "translateX(-50%)", width: "min(640px, calc(100vw - 32px))", zIndex: 40, boxShadow: "var(--shadow)" }}>
          <div className="hd"><b>Load seeded responses</b><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
            <p>Each ticked vendor gets the dataset&apos;s reply, as if they had sent it. Loading again replaces earlier sample replies; replies that came by email or the portal stay.</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div className="seg" role="group" aria-label="Sample set">
                <button className={set === "clean" ? "on" : ""} onClick={() => setSet("clean")}>Clean</button>
                <button className={set === "realistic" ? "on" : ""} onClick={() => setSet("realistic")}>Realistic</button>
              </div>
              <span className="hint">{set === "clean" ? "Tidy files, as in the eval." : "Messier files. OrientPack's is a photo only, with no questionnaire, so it won't clear."}</span>
            </div>
            <table className="t">
              <tbody>{vendors.map((v) => (
                <tr key={v.id}>
                  <td style={{ width: 28 }}><input type="checkbox" aria-label={v.name} disabled={!v.available} checked={picked.includes(v.id)}
                    onChange={(e) => setPicked((p) => e.target.checked ? [...p, v.id] : p.filter((x) => x !== v.id))} /></td>
                  <td><b style={{ opacity: v.available ? 1 : 0.5 }}>{v.name}</b></td>
                  <td className="text-muted-foreground">{note(v)}</td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" variant="default" disabled={!picked.length} onClick={load}>{picked.length ? `Load ${picked.length} ${picked.length === 1 ? "reply" : "replies"}` : "Pick a vendor"}</Button>
            </div>
          </div>
        </div>
      </>}
    </>
  );
}
