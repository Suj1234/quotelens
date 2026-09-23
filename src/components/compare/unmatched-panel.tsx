"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { UnmatchedItem } from "@/lib/unmatched";
import { Button } from "@/components/ui/button";

/** TRD §17.9 bottom collapsible "Unmatched items": items that fit no RFx line; map one to a line or ignore it. */
export function UnmatchedPanel({ items, lines, canAct }: { items: UnmatchedItem[]; lines: { id: string; line_no: number; description: string }[]; canAct: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  const act = async (it: UnmatchedItem, action: "map" | "ignore") => {
    if (!it.review_id) return toast.error("This item has no review card; re-run the map stage for its response.");
    setBusy(it.id);
    const r = await fetch(`/api/review/${it.review_id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "map" ? { line_id: pick[it.id] } : {}) }).catch(() => null);
    setBusy(null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) return toast.error(`${j?.error ?? "That didn't work."}`);
    toast.success(action === "map" ? "Mapped — grid updated" : "Ignored");
    router.refresh();
  };
  return (
    <details className="card" style={{ marginBottom: 20 }}>
      <summary className="hd" style={{ cursor: "pointer" }}><b>Unmatched items <span className="mono text-muted-foreground">{items.length}</span></b><span className="hint">read from a reply but fit no RFx line — not in the grid</span></summary>
      <table className="t">
        <thead><tr><th>Vendor</th><th>Item as written</th><th>Price as written</th><th>Closest line</th><th /></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{it.vendor}</td><td>{it.description}</td><td className="mono">{it.price}</td>
              <td className="text-muted-foreground">{it.best ? <>L{it.best.line_no} {it.best.description} <span className="mono">p {it.best.p.toFixed(2)}</span></> : "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {canAct && <span style={{ display: "inline-flex", gap: 6 }}>
                  <select className="sel" value={pick[it.id] ?? ""} onChange={(e) => setPick({ ...pick, [it.id]: e.target.value })} aria-label="Map to line"><option value="">Map to line…</option>{lines.map((l) => <option key={l.id} value={l.id}>L{l.line_no} {l.description}</option>)}</select>
                  <Button size="sm" disabled={busy === it.id || !pick[it.id]} onClick={() => act(it, "map")}>Map</Button>
                  <Button size="sm" variant="ghost" disabled={busy === it.id} onClick={() => act(it, "ignore")}>Ignore</Button>
                </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
