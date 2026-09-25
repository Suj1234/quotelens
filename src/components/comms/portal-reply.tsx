"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LIMIT, ReplyForm, tooLarge } from "@/components/rfx/add-response";

/** Reply to one email in the vendor's mock mailbox: builds a real reply .eml to the tagged Reply-To; no response yet. */
export function PortalReply({ rfxId, vendorId, vendorName, mailboxId, subject, to, again }: { rfxId: string; vendorId: string; vendorName: string; mailboxId: string; subject: string; to: string; again?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    const size = files.reduce((a, f) => a + f.size, 0);
    if (size > LIMIT) return toast.error(tooLarge(files));
    setBusy(true);
    const form = new FormData();
    form.set("rfx_id", rfxId); form.set("vendor_id", vendorId); form.set("mailbox_id", mailboxId);
    if (text.trim()) form.set("email_text", text);
    files.forEach((f) => form.append("files", f));
    try {
      const r = await fetch("/api/email/vendor-reply", { method: "POST", body: form }).catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${j.error ?? "Sending failed"} (${j.code ?? r.status})`);
      toast.success("Sent — it arrives when the buyer syncs the inbox");
      setOpen(false); setFiles([]); setText("");
      router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  if (!open) return <div className="acts"><Button size="sm" onClick={() => setOpen(true)}>{again ? "Reply again" : "Reply"}</Button></div>;
  return (
    <div className="replypane">
      <div className="eyebrow">Your reply · as {vendorName}</div>
      <div className="email"><div className="h"><span>From</span><b>{vendorName}</b><span>To</span><b className="mono" style={{ fontWeight: 400 }}>{to}</b><span>Subject</span><b>{/^re:/i.test(subject) ? subject : `Re: ${subject}`}</b></div></div>
      <ReplyForm files={files} setFiles={setFiles} text={text} setText={setText} placeholder={`Dear Sujit, please find our quotation attached… — ${vendorName}`} minHeight={320} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="hint">Sent as {vendorName}, to the address the email asked for. It waits unread until the buyer syncs the inbox.</span>
        <span style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="default" disabled={busy || (!files.length && !text.trim())} onClick={send}>{busy ? "Sending…" : "Send reply"}</Button>
        </span>
      </div>
    </div>
  );
}
