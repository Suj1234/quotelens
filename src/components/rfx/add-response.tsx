"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const LIMIT = 4.4 * 1024 * 1024; // leave room for the form fields under Vercel's 4.5 MB body limit
export const tooLarge = (files: File[]) => `${files.length === 1 ? files[0].name : "These files"} ${files.length === 1 ? "is" : "are"} over 4.5 MB — the upload limit here. Send a smaller photo or scan, split the files, or paste the email text.`;

/** Upload files and/or pasted text as one vendor reply, then open Response Detail with the six stages running. */
export async function submitReply(o: { rfxId: string; vendorId: string; files: File[]; text: string; source: "mock_upload" | "mock_paste" | "portal"; useSeed?: boolean }): Promise<string> {
  const size = o.files.reduce((a, f) => a + f.size, 0);
  if (size > LIMIT) throw new Error(tooLarge(o.files));
  const form = new FormData();
  form.set("rfx_id", o.rfxId);
  form.set("vendor_id", o.vendorId);
  form.set("source", o.source);
  if (o.text.trim()) form.set("email_text", o.text);
  if (o.useSeed) form.set("use_seed", "1");
  o.files.forEach((f) => form.append("files", f));
  const res = await fetch("/api/responses", { method: "POST", body: form }).catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 413 && !body.error ? "The upload is over 4.5 MB — the limit here. (TOO_LARGE)" : `${body.error ?? "Upload failed"} (${body.code ?? res.status})`);
  return body.response_id as string;
}

/** Drop zone + pasted text, shared by the Add response sheet and the vendor portal. */
export function ReplyForm({ files, setFiles, text, setText, placeholder }: { files: File[]; setFiles: (f: File[]) => void; text: string; setText: (t: string) => void; placeholder: string }) {
  const [over, setOver] = useState(false);
  return (
    <>
      <label className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...Array.from(e.dataTransfer.files)]); }}>
        <input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        <div><b>Drop files or click</b></div>
        <div style={{ marginTop: 4, fontSize: 11 }} className="text-muted-foreground">xlsx · pdf · docx · jpg · eml — any layout, any format</div>
      </label>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map((f, i) => (
            <div className="filerow" key={i}>
              <span className="ext">{f.name.split(".").pop()?.toUpperCase()}</span><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
              <span className="hint mono">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button size="xs" variant="ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <div className="eyebrow">or paste the email body</div>
      <textarea className="ta" style={{ minHeight: 120 }} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
    </>
  );
}

/** DESIGN §3.5 "Add response" (400 px sheet): same six stages as a Gmail reply. */
export function AddResponse({ rfxId, vendorId, vendorName }: { rfxId: string; vendorId: string; vendorName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, busy]);

  async function submit() {
    setBusy(true);
    try {
      const rid = await submitReply({ rfxId, vendorId, files, text, source: files.length || seed ? "mock_upload" : "mock_paste", useSeed: seed });
      router.push(`/rfx/${rfxId}/responses/${rid}?run=1`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Add response</Button>
      {open && <>
        <div className="scrim" onClick={() => !busy && setOpen(false)} />
        <aside className="sheet" role="dialog" aria-label={`Add response — ${vendorName}`}>
          <div className="hd"><b>Add response — {vendorName}</b><Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>Close</Button></div>
          <div className="bd">
            <ReplyForm files={files} setFiles={setFiles} text={text} setText={setText} placeholder="Dear Sujit sir, our rates as below…" />
            {seed && <div className="note" style={{ fontSize: 12 }}>Using the dataset&apos;s sample reply from {vendorName} (added to anything above).</div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button size="sm" disabled={busy} onClick={() => setSeed(!seed)}>{seed ? "Don't use seed file" : "Use seed file"}</Button>
              <Button variant="default" disabled={busy || (!files.length && !text.trim() && !seed)} onClick={submit}>{busy ? "Uploading…" : "Submit and run"}</Button>
            </div>
            <div className="hint">Runs classify → extract → map → normalise → questionnaire → flags. Same path as a Gmail reply.</div>
          </div>
        </aside>
      </>}
    </>
  );
}
