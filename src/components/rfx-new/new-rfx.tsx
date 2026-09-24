"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import type { Draft, Turn } from "@/lib/rfx-draft";
import { UNTITLED } from "@/lib/rfx-list";
import { issueBlockers, type LineRules } from "@/lib/line-rules";
import type { CategoryTemplate } from "@/lib/settings-schema";
import { Button } from "@/components/ui/button";
import { toEdit, type Edit } from "./editor";
import { IssueDialog } from "./issue-dialog";
import { FileViewer, type ViewFile } from "./file-viewer";
import { Preview, SectionSheet, type Section } from "./preview";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init).catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${body.error ?? "Request failed"} (${body.code ?? res.status})`);
  return body;
}

const ACCEPT = ".xlsx,.xls,.csv,.txt,.docx,.pdf,.png,.jpg,.jpeg,.webp";

/** P9 B13–B20 (replaces DESIGN §3.3's form + side chat): the RFx is built by talking to the co-pilot; the right side is a read-only preview. */
export function NewRfx({ initial, buyerName, opening, category, rules, standard }: {
  initial: Draft | null; buyerName: string; opening: string; category: string; rules: LineRules; standard: CategoryTemplate["standard_terms"] | null;
}) {
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [edit, setEditState] = useState<Edit | null>(initial ? toEdit(initial) : null);
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; files: File[]; steps: string[] } | null>(null);
  const [changed, setChanged] = useState<Section[]>([]);
  const [open, setOpen] = useState<Section | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [viewing, setViewing] = useState<ViewFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = (d: Draft) => { setDraft(d); setEditState(toEdit(d)); };
  const transcript = (draft?.rfx.copilot_transcript ?? []) as Turn[];
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [transcript.length, pending?.steps.length]);
  useEffect(() => { if (!changed.length) return; const t = setTimeout(() => setChanged([]), 4000); return () => clearTimeout(t); }, [changed]);

  /** The draft exists from the first action (no empty drafts from merely opening the page). */
  async function ensureId(): Promise<string> {
    if (draft) return draft.rfx.id;
    const { id } = await call("/api/rfx", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    load(await call(`/api/rfx/${id}`, { method: "GET" }));
    window.history.replaceState(null, "", `/rfx/new?id=${id}`); // no server round-trip: the component keeps its in-flight state
    return id;
  }

  /** Manual edits from a section sheet (the same PATCH as before; each message to the co-pilot saves on its own). */
  async function save(e: Edit) {
    if (!draft) return;
    const h = e.header;
    load(await call(`/api/rfx/${draft.rfx.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        header: { title: h.title, category: h.category, cover_note: h.cover_note, currency: h.currency, quote_unit: h.quote_unit, incoterm: h.incoterm, freight_included_requested: h.freight_included_requested, tax_basis: h.tax_basis, payment_terms_days: h.payment_terms_days, validity_days_requested: h.validity_days_requested, contract_months: h.contract_months, response_deadline: h.response_deadline, delivery_locations: h.delivery_locations },
        terms_set: h.terms_set,
        lines: e.lines.map((l) => ({ ...l, sku: l.sku || null, gsm_spec: l.gsm_spec || null, item_type: l.item_type || null, delivery_location: l.delivery_location || null })),
        questions: e.questions.map((q) => ({ ...q, disqualify_if: q.disqualify_if || null })),
        vendors: { vendor_ids: e.vendors.map((v) => v.vendor_id), new: e.newVendors },
      }),
    }));
  }

  async function saveSection() {
    if (!edit || !open) return;
    setBusy("save");
    // Done on the Terms sheet is the buyer confirming the terms shown, changed or not.
    const e = open === "terms" ? { ...edit, header: { ...edit.header, terms_set: true } } : edit;
    try { await save(e); setEditing(false); setChanged([open]); toast(open === "terms" ? "Terms confirmed" : "Saved"); } catch (err) { toast.error((err as Error).message); } finally { setBusy(null); }
  }

  async function saveTitle() {
    const t = titleEdit?.trim();
    setTitleEdit(null);
    if (!t || t === draft?.rfx.title) return;
    try {
      const id = await ensureId();
      load(await call(`/api/rfx/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ header: { title: t } }) }));
    } catch (e) { toast.error((e as Error).message); }
  }

  async function send(text: string) {
    const message = text.trim();
    if ((!message && !files.length) || busy) return;
    const tooBig = files.find((f) => f.size > 4.4 * 1024 * 1024);
    if (tooBig) return toast.error(`${tooBig.name} is over 4.5 MB — the upload limit here. Attach a smaller file or paste the rows.`);
    setBusy("send");
    setPending({ text: message, files, steps: [] });
    const sent = { msg, files };
    setMsg(""); setFiles([]); // cleared at once; restored below if the message didn't get through
    try {
      const id = await ensureId();
      const form = new FormData();
      form.set("message", message);
      files.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/rfx/${id}/copilot`, { method: "POST", body: form }).catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
      if (!res.ok || !res.body) { setMsg(sent.msg); setFiles(sent.files); const b = await res.json().catch(() => ({})); throw new Error(`${b.error ?? "Request failed"} (${b.code ?? res.status})`); }
      // NDJSON: {type:"step"|"action", text} while the agent works, then {type:"done", draft, changed} or {type:"error"}.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "", finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line);
          if (ev.type === "step") setPending((p) => (p ? { ...p, steps: [...p.steps, ev.text] } : p));
          else if (ev.type === "done") { load(ev.draft); setChanged(ev.changed ?? []); finished = true; }
          else if (ev.type === "error") throw new Error(`${ev.error} (${ev.code})`);
        }
      }
      if (!finished) throw new Error("The co-pilot stopped before answering — try again (STREAM)");
    } catch (e) {
      if ((e as Error).message.includes("(NETWORK)")) { setMsg(sent.msg); setFiles(sent.files); }
      toast.error((e as Error).message);
      if (draft) call(`/api/rfx/${draft.rfx.id}`, { method: "GET" }).then(load).catch(() => {}); // show whatever did change
    } finally { setBusy(null); setPending(null); }
  }

  const vendorCount = draft?.vendors.length ?? 0;
  const r = draft?.rfx;
  const missing = !draft ? ["line items", "commercial terms", "a response deadline", "a questionnaire", "vendors"] : issueBlockers(draft, rules); // same rule as the Issue route
  const ready = missing.length === 0;
  const title = r && r.title !== UNTITLED ? r.title : "New RFx";

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <nav className="crumb" aria-label="Breadcrumb"><Link href="/rfx">Sourcing events</Link><span>/</span><span className="cur">{r?.code ?? "New RFx"}</span></nav>
          {titleEdit !== null
            ? <input className="ta" autoFocus value={titleEdit} aria-label="RFx title" style={{ fontSize: 20, fontWeight: 600, marginTop: 2, maxWidth: 720 }}
                onChange={(e) => setTitleEdit(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setTitleEdit(null); }} />
            : <h1 className="ttl-edit" title="Click to rename" onClick={() => setTitleEdit(r && r.title !== UNTITLED ? r.title : "")}>{title}</h1>}
          <div className="hint" style={{ marginTop: 4, fontSize: 12.5 }}>Draft · {r?.category ?? category}</div>
        </div>
        <Button variant="default" disabled={!ready || !!busy} title={ready ? "Freeze v1 and send it to the vendors" : `Still needed: ${missing.join(", ")}`} onClick={() => setIssuing(true)}>
          Issue to {vendorCount} vendor{vendorCount === 1 ? "" : "s"}
        </Button>
      </div>

      <div className="split2">
        <div className="card chat">
          <div className="hd"><b>Co-pilot</b><span className="hint">{ready ? "Ready to issue" : `Still needed: ${missing.join(", ")}`}</span></div>
          <div className="log" ref={logRef}>
            <div className="msg cp"><div className="from">Co-pilot</div><div style={{ whiteSpace: "pre-wrap" }}>{opening}</div></div>
            {transcript.map((t, i) => t.role === "event" ? <div key={i} className="msg ev">{t.text}</div> : (
              <div key={i} className={`msg ${t.role === "buyer" ? "me" : "cp"}`}>
                <div className="from">{t.role === "buyer" ? buyerName : "Co-pilot"}</div>
                {t.text && <div style={{ whiteSpace: "pre-wrap" }}>{t.role === "copilot" ? <Plain text={t.text} /> : t.text}</div>}
                {t.attachments?.length && r ? <div className="fchips" style={{ marginTop: t.text ? 8 : 0 }}>{t.attachments.map((a) => <FileChip key={a} name={a} onView={() => setViewing({ name: a, url: `/api/rfx/${r.id}/copilot/file?name=${encodeURIComponent(a)}` })} />)}</div> : null}
                {t.questions?.length ? <ol style={{ margin: "6px 0 0 18px", padding: 0, listStyle: "decimal" }}>{t.questions.map((q, j) => <li key={j}>{q}</li>)}</ol> : null}
                {t.patch && <div className="patch"><div className="eyebrow" style={{ marginBottom: 3 }}>What I changed</div>{t.patch.split("\n").map((line, j) => { const [k, ...rest] = line.split(" · "); return <div key={j}>{rest.length ? <><b>{k}</b> · {rest.join(" · ")}</> : line}</div>; })}</div>}
              </div>
            ))}
            {pending && <>
              <div className="msg me"><div className="from">{buyerName}</div>
                {pending.text && <div style={{ whiteSpace: "pre-wrap" }}>{pending.text}</div>}
                {pending.files.length > 0 && <div className="fchips" style={{ marginTop: pending.text ? 8 : 0 }}>{pending.files.map((f, i) => <FileChip key={i} name={f.name} size={f.size} onView={() => setViewing({ name: f.name, blob: f })} />)}</div>}
              </div>
              <div className="msg cp"><div className="from">Co-pilot</div>
                {pending.steps.map((s, i) => <div key={i} className="text-muted-foreground" style={{ fontSize: 12.5 }}>{i < pending.steps.length - 1 ? `✓ ${s.replace(/…$/, "")}` : s}</div>)}
                <div className="text-muted-foreground working">Working on it…</div>
              </div>
            </>}
          </div>
          <div className="composer">
            {files.length > 0 && <div className="fchips">{files.map((f, i) => <FileChip key={i} name={f.name} size={f.size} onView={() => setViewing({ name: f.name, blob: f })} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}</div>}
            <textarea className="ta" value={msg} disabled={busy === "send"} placeholder="Tell the co-pilot what you need — or attach last year's line sheet…" onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(msg); } }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button className="hint" onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="xlsx, csv, txt, docx, pdf or an image, up to 4.5 MB"><Paperclip size={13} aria-hidden /> Attach a file</button>
              <input ref={fileRef} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
              <span className="hint" style={{ marginLeft: "auto" }}>Enter to send · Shift+Enter for a new line</span>
              <Button variant="default" size="sm" disabled={!!busy || (!msg.trim() && !files.length)} onClick={() => send(msg)}>{busy === "send" ? "Working…" : "Send"}</Button>
            </div>
          </div>
        </div>
        <Preview draft={draft} rules={rules} changed={changed} onView={(s) => { setOpen(s); setEditing(false); }} />
      </div>

      {open && draft && edit && (
        <SectionSheet section={open} draft={draft} edit={edit} set={(fn) => setEditState((e) => (e ? fn(e) : e))} editing={editing}
          setEditing={(on) => {
            // Unconfirmed terms open with the company's standard terms (the column defaults mean nothing to the buyer).
            if (on && open === "terms" && !draft.rfx.terms_set && standard) setEditState((e) => e && { ...e, header: { ...e.header, currency: standard.currency, quote_unit: standard.quote_unit, incoterm: standard.incoterm, freight_included_requested: standard.freight_included, tax_basis: standard.tax_basis, payment_terms_days: standard.payment_terms_days, validity_days_requested: standard.validity_days, contract_months: standard.contract_months } });
            setEditing(on);
          }}
          busy={busy === "save"} onDone={saveSection} onClose={() => setOpen(null)}
          onCancel={() => { setEditState(toEdit(draft)); setEditing(false); }} />
      )}
      {issuing && draft && <IssueDialog draft={draft} onClose={() => setIssuing(false)} />}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Model text as plain text: **bold** becomes bold; other markdown asterisks are dropped (no HTML from the model). */
function Plain({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part.replace(/\*([^*\n]+)\*/g, "$1").replace(/^\s*[*-] /gm, "• "))}</>;
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** An attached file: name, size, View (in-app: the local copy before sending, the stored copy after) and remove before sending. */
function FileChip({ name, size, onView, onRemove }: { name: string; size?: number; onView?: () => void; onRemove?: () => void }) {
  return (
    <span className="fchip">
      <FileText size={13} aria-hidden />
      <span className="nm" title={name}>{name}</span>
      {size !== undefined && <span className="sz">{kb(size)}</span>}
      {onView && <button type="button" className="lnk" onClick={onView}>View</button>}
      {onRemove && <button type="button" className="x" aria-label={`Remove ${name}`} onClick={onRemove}><X size={12} aria-hidden /></button>}
    </span>
  );
}
