"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Draft, Turn } from "@/lib/rfx-draft";
import { Button } from "@/components/ui/button";
import { Editor, toEdit, type Edit } from "./editor";
import { IssueDialog } from "./issue-dialog";

const CHIPS: [string, string | null][] = [
  ["Attach last year's sheet", null], // opens the file picker
  ["Standard terms", "Standard terms — per 1000 pieces, delivered with freight included, 45-day payment, 60-day validity."],
  ["Attach questionnaire", "Yes, attach the supplier questionnaire. Make BIS/ISO and BRC disqualifying."],
  ["Add vendors", "Add last year's five vendors."],
];

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init).catch(() => { throw new Error("Couldn't reach the server — check the connection and try again (NETWORK)"); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${body.error ?? "Request failed"} (${body.code ?? res.status})`);
  return body;
}

/** DESIGN §3.3 New RFx: co-pilot on the left, the structured draft on the right. */
export function NewRfx({ initial, buyerName }: { initial: Draft | null; buyerName: string }) {
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [edit, setEditState] = useState<Edit | null>(initial ? toEdit(initial) : null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const set = (fn: (e: Edit) => Edit) => { setEditState((e) => (e ? fn(e) : e)); setDirty(true); };
  const load = (d: Draft) => { setDraft(d); setEditState(toEdit(d)); setDirty(false); };
  const transcript = (draft?.rfx.copilot_transcript ?? []) as Turn[];
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [transcript.length, pending]);
  useEffect(() => { // warn before leaving with unsaved edits
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /** The draft exists from the first action (no empty drafts from merely opening the page). */
  async function ensureId(): Promise<string> {
    if (draft) return draft.rfx.id;
    const { id } = await call("/api/rfx", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const d = await call(`/api/rfx/${id}`, { method: "GET" });
    load(d);
    window.history.replaceState(null, "", `/rfx/new?id=${id}`); // no server round-trip: the component keeps its in-flight state
    return id;
  }

  async function save(quiet = false): Promise<Draft | null> {
    if (!draft || !edit) return draft;
    const h = edit.header;
    const d = await call(`/api/rfx/${draft.rfx.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        header: { title: h.title, category: h.category, cover_note: h.cover_note, currency: h.currency, quote_unit: h.quote_unit, incoterm: h.incoterm, freight_included_requested: h.freight_included_requested, payment_terms_days: h.payment_terms_days, validity_days_requested: h.validity_days_requested, contract_months: h.contract_months, response_deadline: h.response_deadline, delivery_locations: h.delivery_locations },
        terms_set: h.terms_set,
        lines: edit.lines.map((l) => ({ ...l, sku: l.sku || null, gsm_spec: l.gsm_spec || null, item_type: l.item_type || null, delivery_location: l.delivery_location || null })),
        questions: edit.questions.map((q) => ({ ...q, disqualify_if: q.disqualify_if || null })),
        vendors: { vendor_ids: edit.vendors.map((v) => v.vendor_id), new: edit.newVendors },
      }),
    });
    load(d);
    if (!quiet) toast("Saved — draft kept");
    return d;
  }

  async function onSave() {
    setBusy("save");
    try { if (!draft) await ensureId(); else await save(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message && !files.length) return;
    const tooBig = files.find((f) => f.size > 4.4 * 1024 * 1024);
    if (tooBig) return toast.error(`${tooBig.name} is over 4.5 MB — the upload limit here. Attach a smaller sheet or paste the rows.`);
    setBusy("send");
    setPending(message || files.map((f) => f.name).join(", "));
    try {
      const id = await ensureId();
      if (dirty) await save(true);
      const form = new FormData();
      form.set("message", message);
      files.forEach((f) => form.append("files", f));
      load(await call(`/api/rfx/${id}/copilot`, { method: "POST", body: form }));
      setMsg(""); setFiles([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); setPending(null); }
  }

  const h = edit?.header;
  const vendorCount = edit ? edit.vendors.length + edit.newVendors.length : 0;
  const missing = !edit ? ["lines", "terms", "deadline", "questionnaire", "vendors"]
    : [!edit.lines.length && "lines", !h?.terms_set && "terms", !h?.response_deadline && "response deadline (Terms tab)", !edit.questions.length && "questionnaire", !vendorCount && "vendors"].filter(Boolean);
  const ready = missing.length === 0;
  const lastSheet = [...transcript].reverse().find((t) => t.role === "buyer" && t.attachments?.length)?.attachments?.at(-1) ?? null;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div className="eyebrow">Draft · {draft?.rfx.code ?? "new"}</div>
          <h1>New RFx</h1>
          <p className="text-muted-foreground" style={{ marginTop: 4 }}>Describe the need; the co-pilot asks what a good buyer would ask and fills the right-hand side. It never invents line items.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <span className="hint">unsaved changes</span>}
          <Button onClick={onSave} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
          <Button variant="default" disabled={!ready || !!busy} title={ready ? undefined : `Still needed: ${missing.join(", ")}`}
            onClick={async () => { try { if (dirty) await save(true); setIssuing(true); } catch (e) { toast.error((e as Error).message); } }}>
            Issue to {vendorCount} vendor{vendorCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <div className="split">
        <div className="card chat">
          <div className="hd"><b>Co-pilot</b><span className="hint">{h?.terms_set ? "terms set" : "terms pending"} · {edit?.questions.length ? `${edit.questions.length} questions` : "questionnaire pending"}</span></div>
          <div className="log" ref={logRef}>
            {!transcript.length && !pending && <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>Start with what you&apos;re buying, for which plants and for how long. Attach last year&apos;s line sheet and the co-pilot parses it into the Lines tab.</div>}
            {transcript.map((t, i) => (
              <div key={i} className={`msg ${t.role === "buyer" ? "me" : "cp"}`}>
                <div className="from">{t.role === "buyer" ? buyerName : "Co-pilot"}</div>
                {t.text && <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>}
                {t.attachments?.length ? <div className="hint" style={{ marginTop: 4 }}>Attached: <span className="mono">{t.attachments.join(", ")}</span></div> : null}
                {t.questions?.length ? <ol style={{ margin: "6px 0 0 18px", padding: 0, listStyle: "decimal" }}>{t.questions.map((q, j) => <li key={j}>{q}</li>)}</ol> : null}
                {t.patch && <div className="patch">{t.patch.split("\n").map((line, j) => { const [k, ...rest] = line.split(" · "); return <div key={j}>{rest.length ? <><b>{k}</b> · {rest.join(" · ")}</> : line}</div>; })}</div>}
              </div>
            ))}
            {pending && <>
              <div className="msg me"><div className="from">{buyerName}</div><div style={{ whiteSpace: "pre-wrap" }}>{pending}</div></div>
              <div className="msg cp"><div className="from">Co-pilot</div><div className="text-muted-foreground">Working on it…</div></div>
            </>}
          </div>
          <div className="composer">
            <div className="sugg">
              {CHIPS.map(([label, text]) => <button key={label} disabled={!!busy} onClick={() => (text ? send(text) : fileRef.current?.click())}>{label}</button>)}
            </div>
            <textarea className="ta" value={msg} disabled={busy === "send"} placeholder="Tell the co-pilot what you need, or paste a line sheet…" onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(msg); } }} />
            {files.length > 0 && <div className="sugg">{files.map((f, i) => <span key={i} className="chip">{f.name}<button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ marginLeft: 4 }}>×</button></span>)}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button className="hint" onClick={() => fileRef.current?.click()} style={{ cursor: "pointer" }}>Attach xlsx / csv</button>
              <input ref={fileRef} type="file" hidden multiple accept=".xlsx,.xls,.csv,.txt" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
              <Button variant="default" size="sm" disabled={!!busy || (!msg.trim() && !files.length)} onClick={() => send(msg)}>{busy === "send" ? "Sending…" : "Send"}</Button>
            </div>
          </div>
        </div>
        {edit
          ? <Editor edit={edit} set={set} draft={draft} sourceFile={lastSheet} onAttach={() => fileRef.current?.click()} />
          : <Editor edit={{ header: { terms_set: false, delivery_locations: [] } as unknown as Edit["header"], lines: [], questions: [], vendors: [], newVendors: [] }}
              set={(fn) => { ensureId().then(() => set(fn)).catch((e) => toast.error((e as Error).message)); }} draft={null} sourceFile={null} onAttach={() => fileRef.current?.click()} />}
      </div>
      {issuing && draft && <IssueDialog draft={draft} onClose={() => setIssuing(false)} />}
    </div>
  );
}
