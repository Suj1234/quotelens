"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Draft } from "@/lib/rfx-draft";
import { Button } from "@/components/ui/button";
import { FileViewer } from "@/components/rfx-new/file-viewer";

/** TRD §17.3: confirm what will be sent and to whom before v1 is frozen. */
export function IssueDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  // P9 N1: one vendor's email, written by the same prompt as Issue; nothing is sent.
  const [pv, setPv] = useState<{ vendor: string; busy: boolean; open?: boolean; mail?: { to: string; from: string; subject: string; body: string; attachment: string } }>({ vendor: draft.vendors[0]?.vendor_id ?? "", busy: false });
  async function previewEmail() {
    setPv((p) => ({ ...p, busy: true }));
    try {
      const res = await fetch(`/api/rfx/${draft.rfx.id}/issue/email-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_id: pv.vendor }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "Preview failed"} (${body.code ?? res.status})`);
      setPv((p) => ({ ...p, busy: false, open: true, mail: body }));
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server (NETWORK)" : (e as Error).message);
      setPv((p) => ({ ...p, busy: false }));
    }
  }
  const r = draft.rfx;
  const form = `${r.code}_Quote_Form.xlsx`;
  async function issue() {
    setBusy(true);
    try {
      const res = await fetch(`/api/rfx/${r.id}/issue`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "Issue failed"} (${body.code ?? res.status})`);
      toast(`Issued — ${body.sent} emails sent`);
      router.push(`/rfx/${r.id}/overview`);
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server (NETWORK)" : (e as Error).message);
      setBusy(false);
    }
  }
  // The viewer is a side sheet (z 30) under this dialog (z 40), so the dialog steps aside while it's open.
  if (viewing) return <FileViewer file={{ name: form, url: `/api/rfx/${r.id}/issue/preview` }} onClose={() => setViewing(false)} />;
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div role="dialog" aria-label="Issue RFx" className="card" style={{ position: "fixed", top: "8vh", maxHeight: "86vh", overflow: "auto", left: "50%", transform: "translateX(-50%)", width: "min(820px, calc(100vw - 32px))", zIndex: 40, boxShadow: "var(--shadow)" }}>
        <div className="hd"><b>Issue {r.code} to {draft.vendors.length} vendor{draft.vendors.length === 1 ? "" : "s"}</b><Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button></div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
          <p>Issuing freezes <b>v1</b> — {draft.lines.length} lines, the terms, {draft.questions.length} questions and this vendor list — and sends one email per vendor. Replies are read against v1.</p>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Each email carries</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ fontSize: 12 }}>{form}</span>
              <span className="hint">Line Items · Questionnaire tabs</span>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setViewing(true)} style={{ marginLeft: "auto" }}>View</Button>
              <Button size="xs" variant="ghost" asChild><a href={`/api/rfx/${r.id}/issue/preview`} download={form}>Download</a></Button>
            </div>
          </div>
          <table className="t">
            <thead><tr><th>To</th><th>Email</th><th>Reply-To tag</th></tr></thead>
            <tbody>{draft.vendors.map((v) => <tr key={v.vendor_id}><td><b>{v.name}</b></td><td className="mono">{v.email}</td><td className="mono">rfx-{r.code.toLowerCase()}-{v.short_code}</td></tr>)}</tbody>
          </table>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Email preview</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select className="sel" value={pv.vendor} onChange={(e) => setPv({ vendor: e.target.value, busy: false })} aria-label="Vendor to preview" disabled={pv.busy || busy}>
                {draft.vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
              </select>
              <Button size="xs" disabled={!pv.vendor || pv.busy || busy} onClick={() => (pv.open ? setPv((p) => ({ ...p, open: false })) : pv.mail ? setPv((p) => ({ ...p, open: true })) : previewEmail())}>
                {pv.busy ? "Preparing preview…" : pv.open ? "Hide preview" : "Preview email"}
              </Button>
            </div>
            {pv.mail && pv.open && (
              <div className="mail-pv">
                <div><span className="hint lbl">From</span> {pv.mail.from}</div>
                <div><span className="hint lbl">To</span> {pv.mail.to}</div>
                <div><span className="hint lbl">Subject</span> <b>{pv.mail.subject}</b></div>
                <div><span className="hint lbl">Attached</span> <span className="mono">{pv.mail.attachment}</span></div>
                <pre>{pv.mail.body}</pre>
                <div className="hint">Not sent. Each vendor&apos;s email is written when you issue, from the same details — the wording can differ slightly, the facts don&apos;t.</div>
              </div>
            )}
          </div>
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
