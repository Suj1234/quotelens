"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Draft } from "@/lib/rfx-draft";
import { Button } from "@/components/ui/button";

/** TRD §17.3: confirm what will be sent and to whom before v1 is frozen. */
export function IssueDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const r = draft.rfx;
  async function issue() {
    setBusy(true);
    try {
      const res = await fetch(`/api/rfx/${r.id}/issue`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "Issue failed"} (${body.code ?? res.status})`);
      toast(`Issued — ${body.sent} emails in the outbox`);
      router.push(`/rfx/${r.id}/outbox`);
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server (NETWORK)" : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div role="dialog" aria-label="Issue RFx" className="card" style={{ position: "fixed", top: "12vh", left: "50%", transform: "translateX(-50%)", width: "min(560px, calc(100vw - 32px))", zIndex: 40, boxShadow: "var(--shadow)" }}>
        <div className="hd"><b>Issue {r.code} to {draft.vendors.length} vendor{draft.vendors.length === 1 ? "" : "s"}</b><Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button></div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
          <p>Issuing freezes <b>v1</b> — {draft.lines.length} lines, the terms, {draft.questions.length} questions and this vendor list — and sends one email per vendor. Replies are read against v1.</p>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Each email carries</div>
            <div className="mono" style={{ fontSize: 12 }}>{r.code}_Line_Sheet.xlsx · {r.code}_Supplier_Questionnaire.pdf</div>
          </div>
          <table className="t">
            <thead><tr><th>To</th><th>Email</th><th>Reply-To tag</th></tr></thead>
            <tbody>{draft.vendors.map((v) => <tr key={v.vendor_id}><td><b>{v.name}</b></td><td className="mono">{v.email}</td><td className="mono">rfx-{r.code.toLowerCase()}-{v.short_code}</td></tr>)}</tbody>
          </table>
          <p className="hint">Transport: mock email — nothing leaves the system; the emails appear in the Outbox and the vendor portal.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button disabled={busy} onClick={onClose}>Cancel</Button>
            <Button variant="default" disabled={busy} onClick={issue}>{busy ? "Issuing…" : `Issue to ${draft.vendors.length} vendors`}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
