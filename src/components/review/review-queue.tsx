"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Action, QueueItem } from "@/lib/review";
import { countWord, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EvidenceBlock } from "@/components/compare/evidence";

const INFO = ["fx_assumption", "discount_treatment", "freight_treatment", "validity_short", "missing_line"];
const LABEL: Record<Action, string> = {
  confirm: "Confirm", override: "Override…", exclude: "Exclude", map: "Map to line…", ignore: "Ignore", "ask-vendor": "Ask vendor",
  "mark-not-quoted": "Treat as not quoted", dismiss: "Dismiss", "accept-yes": "Accept as Yes", "treat-no": "Treat as No",
};
// DESIGN §5: toasts confirm the verb
const DONE: Record<Action, string> = {
  confirm: "Confirmed — cell now counts", override: "Overridden — cell now counts", exclude: "Excluded — logged in the ledger", map: "Mapped — grid updated",
  ignore: "Ignored", "ask-vendor": "Marked as asked — logged under vendor communications", "mark-not-quoted": "Treated as not quoted", dismiss: "Dismissed",
  "accept-yes": "Accepted as Yes", "treat-no": "Treated as No",
};
type Draft = { to: string; reply_to: string; subject: string; body: string };

export function ReviewQueue({ items, canAct, focus }: { items: QueueItem[]; canAct: boolean; focus: string | null }) {
  const router = useRouter();
  const [vendor, setVendor] = useState(""); const [type, setType] = useState(""); const [status, setStatus] = useState("open");
  const [cur, setCur] = useState<string | null>(focus);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = useMemo(() => items.filter((i) => (!vendor || i.vendor?.code === vendor) && (!type || i.type === type)
    && (status === "all" || (status === "open" ? i.status === "open" : i.status !== "open"))), [items, vendor, type, status]);
  const open = items.filter((i) => i.status === "open");
  const vendors = [...new Map(items.filter((i) => i.vendor).map((i) => [i.vendor!.code, i.vendor!.name])).entries()];
  const types = [...new Set(items.map((i) => i.type))];

  const run = useCallback(async (it: QueueItem, action: Action, body: Record<string, unknown> = {}) => {
    setBusy(it.id);
    try {
      const r = await fetch(`/api/review/${it.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { toast.error(`${j.error ?? "That didn't work."} (${j.code ?? r.status})`); return null; }
      if (action !== "ask-vendor" || body.mode === "mark_sent") { toast.success(DONE[action]); router.refresh(); }
      return j as { status: string; draft?: Draft };
    } catch { toast.error("Couldn't reach the server — check the connection and try again."); return null; }
    finally { setBusy(null); }
  }, [router]);

  const ackAll = async () => {
    const ids = open.filter((i) => INFO.includes(i.type)).map((i) => i.id);
    if (!ids.length) return;
    setBusy("bulk");
    const r = await fetch("/api/review/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action: "confirm" }) });
    setBusy(null);
    if (r.ok) { toast.success(`Acknowledged ${ids.length} assumptions`); router.refresh(); } else toast.error("Couldn't acknowledge them — try again.");
  };

  // J / K move, C confirms the current card (TRD §17.8).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k" && k !== "c") return;
      const i = shown.findIndex((x) => x.id === cur);
      if (k === "c") { const it = shown[i]; if (canAct && it?.status === "open" && it.actions.includes("confirm")) run(it, "confirm"); return; }
      const next = shown[Math.min(shown.length - 1, Math.max(0, i + (k === "j" ? 1 : -1)))];
      if (next) { setCur(next.id); document.getElementById(`rq-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown, cur, canAct, run]);
  useEffect(() => { if (focus) document.getElementById(`rq-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus]);

  return (
    <>
      <p className="lead">
        {open.length
          ? <><b>{countWord(open.length)} {open.length === 1 ? "item needs" : "items need"}</b> a decision. Nothing here counts in totals until you decide. Evidence on the left, your call on the right.</>
          : <><b>Nothing waits for you.</b> Every item has a decision; the grid counts all reviewed cells.</>}
      </p>
      <div style={{ display: "flex", gap: 8, margin: "14px 0 18px", alignItems: "center", flexWrap: "wrap" }}>
        {canAct && open.some((i) => INFO.includes(i.type)) && <Button onClick={ackAll} disabled={busy === "bulk"}>Acknowledge all assumptions</Button>}
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" className="sel"><option value="">All vendors</option>{vendors.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="sel"><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="sel"><option value="open">Open</option><option value="resolved">Decided</option><option value="all">All</option></select>
        <span className="hint"><span className="kbd">J</span> <span className="kbd">K</span> move · <span className="kbd">C</span> confirm</span>
      </div>
      <div className="rq">
        {shown.map((it) => <Card key={it.id} it={it} canAct={canAct} busy={busy === it.id} current={cur === it.id} onPick={() => setCur(it.id)} run={run} />)}
        {!shown.length && <div className="empty"><b>No items match.</b> Change the filters to see decided items or other vendors.</div>}
      </div>
    </>
  );
}

function Card({ it, canAct, busy, current, onPick, run }: {
  it: QueueItem; canAct: boolean; busy: boolean; current: boolean; onPick: () => void;
  run: (it: QueueItem, a: Action, body?: Record<string, unknown>) => Promise<{ status: string; draft?: Draft } | null>;
}) {
  const [mode, setMode] = useState<"override" | "exclude" | "map" | null>(null);
  const [value, setValue] = useState(it.proposed_value ? String(Math.round(it.proposed_value)) : "");
  const [reason, setReason] = useState("");
  const [line, setLine] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const resolved = it.status !== "open";
  const primary = it.actions[0];

  const click = async (a: Action) => {
    if (a === "override" || a === "exclude" || a === "map") return setMode(a);
    if (a === "ask-vendor") { const r = await run(it, a, { mode: "draft" }); if (r?.draft) setDraft(r.draft); return; }
    await run(it, a);
  };
  const label = (a: Action) => a === "confirm" && it.proposed_value !== null && ["ambiguous_unit", "low_confidence_read"].includes(it.type)
    ? `Confirm ${money(it.proposed_value, "INR", 0)}` : a === "confirm" && INFO.includes(it.type) ? "Acknowledge" : LABEL[a];

  return (
    <div className={`rqcard${resolved ? " resolved" : ""}${current ? " cur" : ""}`} id={`rq-${it.id}`} onClick={onPick}>
      <EvidenceBlock ev={it.evidence} />
      <div>
        <div className="ttl">{it.title}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {it.vendor && <span className="chip">{it.vendor.name}</span>}
          <span className="chip grey">{it.type.replaceAll("_", " ")}</span>
          {resolved && <span className="chip green">{it.status.replaceAll("_", " ")}</span>}
        </div>
        {(it.proposed_note || it.detail) && <div className="text-muted-foreground" style={{ marginTop: 8, maxWidth: "60ch", fontSize: 12 }}>{it.proposed_note ?? it.detail}</div>}
        {(it.probability !== null || (it.proposed_value !== null && ["ambiguous_unit", "low_confidence_read"].includes(it.type))) && (
          <div className="prop">
            {it.probability !== null && <span><span className="pbar"><i style={{ width: `${Math.round(it.probability * 100)}%` }} /></span> <span className="mono" style={{ fontSize: 11 }}>p {it.probability.toFixed(2)}</span></span>}
            {it.proposed_value !== null && ["ambiguous_unit", "low_confidence_read"].includes(it.type) && <span>proposed <span className="v">{money(it.proposed_value, "INR", 0)}</span> <span className="text-muted-foreground" style={{ fontSize: 11 }}>per 1000</span></span>}
          </div>
        )}
        {resolved && it.resolution && <div className="hint" style={{ marginTop: 8 }}>{[it.resolution.value !== undefined && it.type !== "questionnaire_ambiguous" ? money(it.resolution.value, "INR", 0) : null, it.resolution.note, it.resolution.by && `by ${it.resolution.by}`].filter(Boolean).join(" · ")}</div>}

        {!resolved && canAct && !mode && !draft && (
          <div className="acts">
            {it.actions.map((a) => <Button key={a} size="sm" variant={a === primary ? "default" : "outline"} disabled={busy} onClick={(e) => { e.stopPropagation(); click(a); }}>{label(a)}</Button>)}
          </div>
        )}
        {!resolved && !canAct && <div className="hint" style={{ marginTop: 10 }}>Waiting for Sujit.</div>}

        {mode && (
          <div className="acts" onClick={(e) => e.stopPropagation()}>
            {mode === "override" && <input className="mono inp" style={{ width: 120 }} inputMode="decimal" placeholder="₹ per 1000" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value per 1000 pcs" />}
            {mode === "map"
              ? <select className="sel" value={line} onChange={(e) => setLine(e.target.value)} aria-label="RFx line"><option value="">Pick a line…</option>{it.candidates?.map((c) => <option key={c.line_id} value={c.line_id}>L{c.line_no} {c.description}</option>)}</select>
              : <input className="inp" style={{ flex: 1, minWidth: 180 }} placeholder="Reason (goes in the ledger)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />}
            <Button size="sm" variant="default" disabled={busy || (mode === "map" ? !line : !reason.trim() || (mode === "override" && !Number(value)))}
              onClick={async () => { if (await run(it, mode, mode === "map" ? { line_id: line } : { value: Number(value), reason })) setMode(null); }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        )}
        {draft && (
          <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="email">
              <div className="h"><span>To</span><b>{draft.to}</b><span>Reply-To</span><b className="mono">{draft.reply_to}</b><span>Subject</span><b>{draft.subject}</b></div>
              <div className="b">{draft.body}</div>
            </div>
            <div className="acts">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`).then(() => toast.success("Copied — paste it into your email"))}>Copy</Button>
              <Button size="sm" variant="default" disabled={busy} onClick={async () => { if (await run(it, "ask-vendor", { mode: "mark_sent" })) setDraft(null); }}>Mark as asked</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <span className="hint">Sending from QuoteLens comes with email set-up; for now send it yourself.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
