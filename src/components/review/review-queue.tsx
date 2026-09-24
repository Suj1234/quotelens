"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Action, QueueItem } from "@/lib/review";
import { countWord, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EvidenceBlock } from "@/components/compare/evidence";
import { SyncRepliedButton } from "@/components/comms/sync-inbox";

const TYPE_ORDER = ["ambiguous_unit", "low_confidence_read", "prior_pricing", "discount_treatment", "fx_assumption", "freight_treatment", "questionnaire_ambiguous", "questionnaire_missing", "validity_short", "missing_line", "unmapped_item", "conflict", "unknown_vendor", "not_a_quote"];
const PRICE_TYPES = ["ambiguous_unit", "low_confidence_read", "conflict"];
const INFO = ["fx_assumption", "discount_treatment", "freight_treatment", "validity_short", "missing_line"];
const LABEL: Record<Action, string> = {
  confirm: "Confirm", override: "Override…", exclude: "Exclude", map: "Map to line…", ignore: "Ignore", "ask-vendor": "Ask vendor",
  "mark-not-quoted": "Treat as not quoted", dismiss: "Dismiss", "accept-yes": "Accept as Yes", "treat-no": "Treat as No",
};
// DESIGN §5: toasts confirm the verb
const DONE: Record<Action, string> = {
  confirm: "Confirmed — cell now counts", override: "Overridden — cell now counts", exclude: "Excluded — logged in the ledger", map: "Mapped — grid updated",
  ignore: "Ignored", "ask-vendor": "Sent — logged under vendor communications", "mark-not-quoted": "Treated as not quoted", dismiss: "Dismissed",
  "accept-yes": "Accepted as Yes", "treat-no": "Treated as No",
};
type Draft = { to: string; reply_to: string; clar_n: number; subject: string; body: string; items: { id: string; text: string }[] };
type Pending = { total: number; by_vendor: { vendor: string; count: number; clarification: boolean }[] };
const ASKABLE = ["ambiguous_unit", "low_confidence_read", "prior_pricing", "questionnaire_ambiguous", "questionnaire_missing"];
const andList = (xs: (string | number)[]) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : String(xs[0] ?? "");

export function ReviewQueue({ rfxId, items, canAct, focus, vendor: initialVendor = "", pending: initialPending }: { rfxId: string; items: QueueItem[]; canAct: boolean; focus: string | null; vendor?: string; pending: Pending | null }) {
  const router = useRouter();
  // The server's count, unless this page polled a newer one since (a refresh brings a new server count and wins again).
  const [polled, setPolled] = useState<{ base: Pending | null; v: Pending } | null>(null);
  const pending = polled && polled.base === initialPending ? polled.v : initialPending;
  const [vendor, setVendor] = useState(initialVendor); const [type, setType] = useState(""); const [status, setStatus] = useState("open");
  const [cur, setCur] = useState<string | null>(focus);
  const [busy, setBusy] = useState<string | null>(null);
  const [group, setGroup] = useState<"type" | "vendor">("type");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = useMemo(() => items.filter((i) => (!vendor || i.vendor?.code === vendor) && (!type || i.type === type)
    && (status === "all" || (status === "open" ? i.status === "open" : i.status !== "open"))), [items, vendor, type, status]);
  // PRD #17: grouped by type (DESIGN §3.6 order) or by vendor; J/K follow the same order.
  const keyOf = useCallback((i: QueueItem) => (group === "type" ? i.type : i.vendor?.name ?? "Unknown sender"), [group]);
  const ordered = useMemo(() => [...shown].sort((a, b) => group === "type"
    ? (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || (a.vendor?.name ?? "").localeCompare(b.vendor?.name ?? "")
    : keyOf(a).localeCompare(keyOf(b)) || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)), [shown, group, keyOf]);
  const open = items.filter((i) => i.status === "open");
  const vendors = [...new Map(items.filter((i) => i.vendor).map((i) => [i.vendor!.code, i.vendor!.name])).entries()];
  const types = [...new Set(items.map((i) => i.type))];

  const run = useCallback(async (it: QueueItem, action: Action, body: Record<string, unknown> = {}) => {
    setBusy(it.id);
    try {
      const r = await fetch(`/api/review/${it.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { toast.error(`${j.error ?? "That didn't work."} (${j.code ?? r.status})`); return null; }
      if (action !== "ask-vendor") { toast.success(DONE[action]); router.refresh(); }
      return j as { status: string; draft?: Draft };
    } catch { toast.error("Couldn't reach the server — check the connection and try again."); return null; }
    finally { setBusy(null); }
  }, [router]);

  const bulk = async (ids: string[], action: Action, done: string) => {
    if (!ids.length) return;
    setBusy("bulk");
    const r = await fetch("/api/review/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) }).catch(() => null);
    setBusy(null);
    const j = await r?.json().catch(() => null) as { results?: { error?: string }[] } | null;
    if (!r?.ok || !j?.results) return toast.error("Couldn't apply that — try again.");
    const failed = j.results.filter((x) => x.error).length;
    if (failed) toast.error(`${ids.length - failed} done, ${failed} skipped (that action doesn't apply to them)`); else toast.success(`${done} ${ids.length}`);
    setPicked(new Set());
    router.refresh();
  };
  const ackAll = () => bulk(open.filter((i) => INFO.includes(i.type)).map((i) => i.id), "confirm", "Acknowledged");
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const groups = [...new Set(ordered.map(keyOf))];
  // DESIGN §3.6 note while a clarification is out: "Clarification sent to Westline Packaging for items 5, 9, 15 and 19. Waiting for their reply."
  const askedVendors = [...new Set(items.filter((i) => i.status === "asked_vendor").map((i) => i.vendor?.name ?? "the vendor"))];
  const asked = askedVendors.map((v) => {
    const its = items.filter((i) => i.status === "asked_vendor" && (i.vendor?.name ?? "the vendor") === v);
    const nos = its.map((i) => i.line_no).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const other = its.length - nos.length;
    return `Clarification sent to ${v} for ${nos.length ? `${nos.length === 1 ? "item" : "items"} ${andList(nos)}${other ? ` and ${other} more ${other === 1 ? "point" : "points"}` : ""}` : `${its.length} ${its.length === 1 ? "point" : "points"}`}. Waiting for their reply.`;
  });
  // While a clarification is out, look for the reply every 30 s (cheap: headers only) so the button can say who replied.
  useEffect(() => {
    if (!canAct || !askedVendors.length) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") fetch(`/api/email/pending?rfx=${rfxId}`).then((r) => r.ok ? r.json() : null).then((j) => j && setPolled({ base: initialPending, v: j })).catch(() => {}); }, 30_000);
    return () => clearInterval(t);
  }, [canAct, askedVendors.length, rfxId, initialPending]);
  const replied = (pending?.by_vendor ?? []).filter((p) => p.clarification || askedVendors.includes(p.vendor));

  // J / K move, C confirms the current card (TRD §17.8).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k" && k !== "c") return;
      const i = ordered.findIndex((x) => x.id === cur);
      if (k === "c") { const it = ordered[i]; if (canAct && it?.status === "open" && it.actions.includes("confirm")) run(it, "confirm"); return; }
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, i + (k === "j" ? 1 : -1)))];
      if (next) { setCur(next.id); document.getElementById(`rq-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ordered, cur, canAct, run]);
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
        {canAct && replied.map((p) => <SyncRepliedButton key={p.vendor} rfxId={rfxId} vendor={p.vendor} />)}
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" className="sel"><option value="">All vendors</option>{vendors.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="sel"><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="sel"><option value="open">Open</option><option value="resolved">Decided</option><option value="all">All</option></select>
        <div className="seg" role="group" aria-label="Group by">
          <button className={group === "type" ? "on" : ""} onClick={() => setGroup("type")}>By type</button>
          <button className={group === "vendor" ? "on" : ""} onClick={() => setGroup("vendor")}>By vendor</button>
        </div>
        <span className="hint"><span className="kbd">J</span> <span className="kbd">K</span> move · <span className="kbd">C</span> confirm</span>
      </div>
      {asked.map((a) => <div key={a} className="note" style={{ marginBottom: 12 }}>{a}</div>)}
      {canAct && picked.size > 0 && (
        <div className="lock" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, position: "sticky", top: 0, zIndex: 5, color: "var(--ink)" }}>
          <b>{picked.size} selected</b>
          <Button size="sm" variant="default" disabled={busy === "bulk"} onClick={() => bulk([...picked], "confirm", "Confirmed")}>Confirm</Button>
          <Button size="sm" disabled={busy === "bulk"} onClick={() => bulk([...picked], "dismiss", "Dismissed")}>Dismiss</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          <span className="hint">Confirm uses each card&apos;s proposed value; cards it doesn&apos;t apply to are skipped.</span>
        </div>
      )}
      <div className="rq">
        {groups.map((g) => (
          <section key={g} className="rq">
            <div className="eyebrow" style={{ marginTop: 6 }}>{group === "type" ? g.replaceAll("_", " ") : g} · {ordered.filter((i) => keyOf(i) === g).length}</div>
            {ordered.filter((i) => keyOf(i) === g).map((it) => <Card key={it.id} it={it} rfxId={rfxId} askable={items.filter((x) => x.status === "open" && x.vendor?.id === it.vendor?.id && ASKABLE.includes(x.type)).map((x) => x.id)} canAct={canAct} busy={busy === it.id} current={cur === it.id} onPick={() => setCur(it.id)} run={run}
              selected={picked.has(it.id)} onSelect={() => toggle(it.id)} />)}
          </section>
        ))}
        {!shown.length && <div className="empty"><b>No items match.</b> Change the filters to see decided items or other vendors.</div>}
      </div>
    </>
  );
}

function Card({ it, rfxId, askable, canAct, busy, current, onPick, run, selected, onSelect }: {
  it: QueueItem; rfxId: string; askable: string[]; canAct: boolean; busy: boolean; current: boolean; onPick: () => void; selected: boolean; onSelect: () => void;
  run: (it: QueueItem, a: Action, body?: Record<string, unknown>) => Promise<{ status: string; draft?: Draft } | null>;
}) {
  const [mode, setMode] = useState<"override" | "exclude" | "map" | null>(null);
  const [value, setValue] = useState(it.proposed_value ? String(Math.round(it.proposed_value)) : "");
  const [reason, setReason] = useState("");
  const [line, setLine] = useState("");
  const [asking, setAsking] = useState(false);
  const resolved = it.status !== "open";
  const primary = it.actions[0];

  const click = async (a: Action) => {
    if (a === "override" || a === "exclude" || a === "map") return setMode(a);
    if (a === "ask-vendor") return setAsking(true);
    await run(it, a);
  };
  const label = (a: Action) => a === "confirm" && it.proposed_value !== null && PRICE_TYPES.includes(it.type)
    ? `Confirm ${money(it.proposed_value, "INR", 0)}` : a === "confirm" && INFO.includes(it.type) ? "Acknowledge" : LABEL[a];

  return (
    <div className={`rqcard${resolved ? " resolved" : ""}${current ? " cur" : ""}`} id={`rq-${it.id}`} onClick={onPick}>
      <EvidenceBlock ev={it.evidence} />
      <div>
        <div className="ttl">
          {canAct && !resolved && <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} aria-label="Select for bulk action" />}
          {it.title}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {it.vendor && <span className="chip">{it.vendor.name}</span>}
          <span className="chip grey">{it.type.replaceAll("_", " ")}</span>
          {resolved && <span className="chip green">{it.status.replaceAll("_", " ")}</span>}
        </div>
        {(it.proposed_note || it.detail) && <div className="text-muted-foreground" style={{ marginTop: 8, maxWidth: "60ch", fontSize: 12 }}>{it.proposed_note ?? it.detail}</div>}
        {(it.probability !== null || (it.proposed_value !== null && PRICE_TYPES.includes(it.type))) && (
          <div className="prop">
            {it.probability !== null && <span><span className="pbar"><i style={{ width: `${Math.round(it.probability * 100)}%` }} /></span> <span className="mono" style={{ fontSize: 11 }}>p {it.probability.toFixed(2)}</span></span>}
            {it.proposed_value !== null && PRICE_TYPES.includes(it.type) && <span>proposed <span className="v">{money(it.proposed_value, "INR", 0)}</span> <span className="text-muted-foreground" style={{ fontSize: 11 }}>per 1000</span></span>}
          </div>
        )}
        {resolved && it.resolution && <div className="hint" style={{ marginTop: 8 }}>{[it.resolution.value !== undefined && it.type !== "questionnaire_ambiguous" ? money(it.resolution.value, "INR", 0) : null, it.resolution.note, it.resolution.by && `by ${it.resolution.by}`].filter(Boolean).join(" · ")}</div>}

        {!resolved && canAct && !mode && !asking && (
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
        {asking && it.vendor && <ClarifyBlock rfxId={rfxId} vendor={it.vendor} itemIds={[...new Set([it.id, ...askable])]} onDone={() => setAsking(false)} />}
      </div>
    </div>
  );
}

/** DESIGN §2.11 "Ask vendor inline": one P-CLARIFY email for all the vendor's open askable cards; untick to leave some out. */
function ClarifyBlock({ rfxId, vendor, itemIds, onDone }: { rfxId: string; vendor: { id: string; name: string }; itemIds: string[]; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set(itemIds));
  const [drafted, setDrafted] = useState<string[]>([]);
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | null>("draft");
  const post = async (url: string, payload: object) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) throw new Error(r ? `${j?.error ?? "That didn't work."} (${j?.code ?? r.status})` : "Couldn't reach the server — check the connection and try again (NETWORK)");
    return j;
  };
  const fetchDraft = useCallback((ids: string[]) => post("/api/clarify", { rfx_id: rfxId, vendor_id: vendor.id, review_item_ids: ids }).then((d: Draft) => {
    setDraft((prev) => ({ ...d, items: prev ? [...prev.items.filter((x) => !d.items.some((y) => y.id === x.id)), ...d.items] : d.items }));
    setSubject(d.subject); setBody(d.body); setDrafted(ids);
  }), [rfxId, vendor.id]);
  const make = (ids: string[]) => { setBusy("draft"); fetchDraft(ids).catch((e) => toast.error((e as Error).message)).finally(() => setBusy(null)); };
  // Draft once when the block opens; a failed first draft closes it again.
  useEffect(() => { fetchDraft(itemIds).catch((e) => { toast.error((e as Error).message); onDone(); }).finally(() => setBusy(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on open
  const chosen = [...ticked];
  const stale = chosen.length !== drafted.length || chosen.some((id) => !drafted.includes(id));
  const send = async () => {
    setBusy("send");
    try {
      await post("/api/clarify/send", { rfx_id: rfxId, vendor_id: vendor.id, subject, body, review_item_ids: drafted });
      toast.success("Sent — logged under vendor communications");
      onDone(); router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  if (!draft) return <div className="hint" style={{ marginTop: 12 }}>Drafting the email to {vendor.name}…</div>;
  return (
    <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
      {draft.items.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, fontSize: 12 }}>
          {draft.items.map((x) => <label key={x.id} style={{ display: "flex", gap: 6, alignItems: "baseline" }}><input type="checkbox" checked={ticked.has(x.id)}
            onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} />{x.text}</label>)}
        </div>
      )}
      <div className="email">
        <div className="h">
          <span>To</span><b>{draft.to}</b>
          <span>Reply-To</span><b className="mono" style={{ fontWeight: 400 }}>{draft.reply_to}</b>
          <span>Subject</span><input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" style={{ fontWeight: 500 }} />
        </div>
        <textarea className="ta b" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" style={{ minHeight: 200, width: "100%", border: 0, resize: "vertical" }} />
      </div>
      <div className="acts">
        {stale
          ? <Button size="sm" variant="default" disabled={!chosen.length || !!busy} onClick={() => make(chosen)}>{busy === "draft" ? "Drafting…" : `Redraft for ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}</Button>
          : <Button size="sm" variant="default" disabled={!!busy || !subject.trim() || !body.trim()} onClick={send}>{busy === "send" ? "Sending…" : "Send"}</Button>}
        <Button size="sm" variant="ghost" disabled={busy === "send"} onClick={onDone}>Cancel</Button>
        <span className="hint">{stale ? "The ticked items changed — redraft before sending." : `Replies to ${draft.reply_to.split("@")[0].split("+")[1]} come back through Sync inbox.`}</span>
      </div>
    </div>
  );
}
