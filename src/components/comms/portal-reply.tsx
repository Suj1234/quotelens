"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReplyForm, submitReply } from "@/components/rfx/add-response";

/** TRD §17.6 reply form: same intake as Inbox upload, source = portal. */
export function PortalReply({ rfxId, vendorId, vendorName, subject }: { rfxId: string; vendorId: string; vendorName: string; subject: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const rid = await submitReply({ rfxId, vendorId, files, text, source: "portal" });
      toast(`Reply from ${vendorName} received — processing`);
      router.push(`/rfx/${rfxId}/responses/${rid}?run=1`);
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  }
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="hd"><b>Reply</b><span className="hint">Re: {subject}</span></div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ReplyForm files={files} setFiles={setFiles} text={text} setText={setText} placeholder={`Dear Sujit, please find our quotation attached… — ${vendorName}`} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="hint">Sent as {vendorName}. It arrives like any reply and runs the six stages.</span>
          <Button variant="default" disabled={busy || (!files.length && !text.trim())} onClick={send}>{busy ? "Sending…" : "Send reply"}</Button>
        </div>
      </div>
    </div>
  );
}
