"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ScenarioView } from "@/lib/scenarios";
import type { AwardView } from "@/lib/award";
import type { Filter, Rule, SubRule } from "@/lib/scenarios/allocate";
import type { AskAnswer } from "@/lib/query/ask";
import { allocationColumn } from "@/lib/query/result";
import { inrShort, longDate, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MemoView } from "./memo-view";

// DESIGN §3.9 Award (both roles) + TRD §14.2 / §17.11, reworked on the human's review (DECISIONS 2026-09-25 "Award tab"):
// option cards (SAP Ariba's award-scenario cards), who gets what per vendor, what the choice costs, lines in plain words, compare two options.
type Opt = { id: string; name: string; price: number };
type Props = {
  rfxId: string; code: string; buyer: boolean; me: string; locked: boolean; scenarios: ScenarioView[]; award: AwardView | null;
  options: Record<string, Record<string, Opt[]>>; groupValues: { ply: number[]; item_type: string[]; delivery_location: string[] };
};
const rs = (v: number | null) => (v === null ? "—" : money(Math.round(v)));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const qualifiedRule = (r: Rule) => (r.type === "grouped" ? (r.groups ?? []).every((g) => g.rule.qualified_only) : !!r.qualified_only);

async function call(url: string, body?: unknown, method = "POST") {
  try {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(`${j.error ?? "That didn't work."} (${j.code ?? r.status})`); return null; }
    return j;
  } catch { toast.error("Couldn't reach the server — check the connection and try again (NETWORK)"); return null; }
}

/** "₹1.79 lakh cheaper than giving everything to Anand Box Works" — never a signed percentage. */
function vsOne(s: ScenarioView): string | null {
  if (!s.baseline || s.savings_vs_baseline === null) return null;
  const d = s.savings_vs_baseline;
  if (Math.abs(d) < 0.5) return `Same cost as giving everything to ${s.baseline.vendor}`;
  return `${rs(Math.abs(d))} ${d > 0 ? "cheaper" : "more"} than giving everything to ${s.baseline.vendor}`;
}

function Steps({ award }: { award: AwardView | null }) {
  const st = award?.status ?? null;
  const m = award?.memo;
  const steps: [string, "done" | "now" | "todo"][] = [
    ["Compare options", st ? "done" : "now"],
    [st === "draft" || st === "approved" ? `Memo drafted by ${m?.prepared.name ?? "the buyer"}` : st === "sent_back" ? "Memo sent back — draft it again" : "Sujit drafts the memo", st === "draft" || st === "approved" ? "done" : st === "sent_back" ? "now" : "todo"],
    [st === "approved" && m?.approved ? `Approved by ${m.approved.name}, ${longDate(m.approved.at)}` : "Priya approves", st === "approved" ? "done" : st === "draft" ? "now" : "todo"],
  ];
  return (
    <ol aria-label="Award steps" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 12.5 }}>
      {steps.map(([t, s], i) => (
        <Fragment key={i}>
          {i > 0 && <li aria-hidden style={{ width: 24, height: 1, background: "var(--hair)" }} />}
          <li aria-current={s === "now" ? "step" : undefined} style={{ display: "inline-flex", gap: 6, alignItems: "center", color: s === "todo" ? "var(--muted)" : "var(--ink)", fontWeight: s === "now" ? 600 : 400 }}>
            <span style={{ width: 18, height: 18, borderRadius: 9, display: "inline-grid", placeItems: "center", fontSize: 11,
              background: s === "done" ? "var(--accent)" : s === "now" ? "var(--accent-tint)" : "var(--tint)", color: s === "done" ? "var(--surface)" : "var(--accent-ink)" }}>{s === "done" ? "✓" : i + 1}</span>
            {t}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

export function AwardScreen(p: Props) {
  const router = useRouter();
  const { scenarios, award, buyer, locked } = p;
  const st = award?.status ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [elapsed, setElapsed] = useState(0);
  const lowest = scenarios.length ? scenarios.reduce((a, b) => (b.total_after < a.total_after - 0.5 ? b : a)) : null;
  // Every option within a rupee of the cheapest is "Lowest cost" (a tie gets the tag on each, not on whichever was saved first).
  const isLowest = (s: ScenarioView) => scenarios.length > 1 && lowest !== null && s.total_after - lowest.total_after < 0.5;
  const [sel, setSel] = useState<string | null>(award?.scenario_id ?? lowest?.id ?? null);
  const [cmp, setCmp] = useState<string | null>(null);
  const [back, setBack] = useState(false); const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [building, setBuilding] = useState(false);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setElapsed(Date.now() - t0), 250); return () => clearInterval(t); }, [busy]);
  const cur = scenarios.find((s) => s.id === sel) ?? lowest;
  const other = cmp && cmp !== cur?.id ? scenarios.find((s) => s.id === cmp) ?? null : null;

  async function run(key: string, url: string, body: unknown, done: string, method = "POST") {
    setBusy(key); setElapsed(0);
    const j = await call(url, body, method);
    // The page re-works every option on refresh (seconds): keep the action busy until the new state is on screen, so an
    // already-approved memo can't be approved again from the old buttons (LOCKED).
    if (j) { toast.success(done); startRefresh(() => { router.refresh(); setBusy(null); }); } else setBusy(null);
    return j;
  }
  const memoFrom = scenarios.find((s) => s.id === award?.scenario_id)?.name ?? award?.memo.scenario.name;
  const staleWhy = award?.stale_reason === "prices" ? "prices changed after it was drafted" : "the option was changed after it was drafted";

  const lead = st === "approved" || locked ? <><b>Awarded.</b> {award?.memo.totals.vendors.map((v) => `${v.name.split(" ")[0]} ${v.lines}`).join(" · ")} · {inrShort(award?.memo.totals.total_after ?? award?.memo.totals.total ?? 0)} a year. Everything is read-only.</>
    : st === "draft" ? (buyer ? <>Memo drafted from <b>{memoFrom}</b>. Waiting for Priya.</> : <>Sujit recommends <b>{memoFrom}</b>. Read the memo below, then approve it or send it back.</>)
    : st === "sent_back" ? (buyer ? <>Priya sent the memo back. Read her note, adjust the option and <b>draft the memo again</b>.</> : <>You sent the memo back to Sujit. It returns here when Sujit drafts it again.</>)
    : <>Decide who gets each of the {cur?.lines.length ?? "RFx"} lines. Each option below is one way to split them — compare them{buyer ? ", then draft the memo from the one you choose." : "; Sujit drafts the memo from one."}</>;

  return (
    <div className="page read">
      <Steps award={award} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <p className="lead" style={{ margin: 0 }}>{lead}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {award && <Button asChild><a href={award.pdf_url} target="_blank" rel="noreferrer">Download PDF</a></Button>}
          {st === "draft" && buyer && <span className="chip amber">Waiting for Priya</span>}
          {st === "draft" && !buyer && !locked && <>
            <Button disabled={!!busy || refreshing} onClick={() => { setBack(!back); setConfirm(false); }}>{busy === "back" ? "Sending…" : "Send back"}</Button>
            <Button variant="default" disabled={!!award?.stale || !!busy || refreshing} title={award?.stale ? `Can't approve: ${staleWhy}. Sujit needs to refresh and draft it again.` : undefined} onClick={() => { setConfirm(true); setBack(false); }}>{busy === "approve" ? "Approving…" : "Approve"}</Button>
          </>}
        </div>
      </div>

      {award?.stale && st === "draft" && <div className="lock" style={{ marginTop: 12, color: "var(--amber)" }}>This memo can&apos;t be approved: {staleWhy}. {buyer ? "Refresh the option below if it says so, then draft the memo again." : "Sujit needs to refresh the option and draft the memo again."}</div>}
      {st === "sent_back" && award?.sent_back_note && <div className="card" style={{ marginTop: 12, borderColor: "var(--amber)" }}><div className="bd"><div className="eyebrow">Sent back by {award.sent_back_by ?? "the approver"}{award.sent_back_at ? ` · ${longDate(award.sent_back_at)}` : ""}</div><p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{award.sent_back_note}</p></div></div>}
      {award && st !== "approved" && <NoteAnswered award={award} buyer={buyer} />}
      {confirm && (
        <div className="card" style={{ marginTop: 12, padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 240 }}>Approving locks {p.code}: the grid, the review queue and the options become read-only, and the memo is signed with your name.</span>
          <Button onClick={() => setConfirm(false)} disabled={!!busy}>Cancel</Button>
          <Button variant="default" disabled={!!busy} onClick={async () => { if (await run("approve", `/api/award/${p.rfxId}/approve`, {}, "Approved — RFx locked")) setConfirm(false); }}>{busy === "approve" ? "Approving…" : "Approve and lock"}</Button>
        </div>
      )}
      {back && (
        <div className="card" style={{ marginTop: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="eyebrow" htmlFor="sbnote">Note for Sujit</label>
          <textarea id="sbnote" className="ta" style={{ minHeight: 64 }} placeholder="What should change before you approve?" value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onClick={() => setBack(false)} disabled={!!busy}>Cancel</Button>
            <Button variant="default" disabled={!note.trim() || !!busy} onClick={async () => { if (await run("back", `/api/award/${p.rfxId}/send-back`, { note }, "Sent back to Sujit with your note")) { setBack(false); setNote(""); } }}>{busy === "back" ? "Sending…" : "Send back"}</Button>
          </div>
        </div>
      )}

      <div className="card" style={{ margin: "16px 0" }}>
        <div className="hd">
          <b style={{ fontSize: 13 }}>Award options{scenarios.length ? ` · ${scenarios.length}` : ""}<span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>each one is a way to split the lines between vendors</span></b>
          {buyer && !locked && <Button size="sm" variant="ghost" onClick={() => setBuilding(!building)}>{building ? "Close" : "Advanced: build by rule"}</Button>}
        </div>
        {!locked && <Describe rfxId={p.rfxId} plies={p.groupValues.ply} onSaved={() => setSel(null)} />}
        {building && <Builder rfxId={p.rfxId} values={p.groupValues} onDone={() => { setBuilding(false); router.refresh(); }} />}
        {!scenarios.length ? (
          <div className="bd"><div className="empty"><b>No options yet.</b> Describe a split above — or pick one of the examples — and it is saved here with its cost.</div></div>
        ) : (
          <div className="bd" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {scenarios.map((s) => (
              <Card key={s.id} s={s} on={s.id === cur?.id} lowest={isLowest(s)} tied={scenarios.filter(isLowest).length > 1} above={scenarios.length > 1 && lowest && !isLowest(s) ? s.total_after - lowest.total_after : null} inMemo={award?.scenario_id === s.id}
                compared={s.id === cmp} canCompare={scenarios.length > 1 && s.id !== cur?.id}
                onPick={() => { setSel(s.id); if (cmp === s.id) setCmp(null); }} onCompare={() => setCmp(cmp === s.id ? null : s.id)}
                manage={locked ? null : buyer || s.created_by_id === p.me} buyer={buyer} />
            ))}
            {cur?.baseline && (
              <div style={{ border: "1px dashed var(--hair)", borderRadius: 6, padding: 12, background: "var(--paper)", fontSize: 12.5 }}>
                <div className="eyebrow">For reference</div>
                <b style={{ fontSize: 13.5, fontWeight: 600 }}>Everything to one vendor</b>
                <div style={{ fontSize: 16, margin: "4px 0" }}><span className="mono">{rs(cur.baseline.total)}</span> a year</div>
                <div className="text-muted-foreground">{cur.baseline.vendor}, the cheapest single vendor{cur.baseline.note ? ` — ${cur.baseline.note}` : ""}</div>
              </div>
            )}
          </div>
        )}
        {other && cur && <Compare a={cur} b={other} onClose={() => setCmp(null)} />}
        {cur && <Detail key={cur.id} s={cur} opts={p.options[cur.id] ?? {}} buyer={buyer} locked={locked} award={award} busy={busy} elapsed={elapsed}
          onDraft={() => run("gen", `/api/award/${p.rfxId}/generate`, { scenario_id: cur.id }, "Memo drafted — Priya can approve")}
          onRefresh={() => run("ref", `/api/scenarios/${cur.id}/refresh`, {}, `Refreshed — ${cur.name}`)} />}
      </div>

      {award && award.history.length > 0 && <History award={award} />}
      {award && <MemoView m={award.memo} />}
    </div>
  );
}

/** What changed in a version, in words: moved lines with reason and cost, a different option, or nothing. */
function ChangeList({ v, award }: { v: AwardView["history"][0]; award: AwardView }) {
  const c = v.changes;
  // Versions from before memo history keep no earlier memo to compare with: fall back to the lines changed by hand in this option.
  if (!c) {
    const o = v.current ? award.memo.open_items.overrides : [];
    return o.length ? <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{o.map((x) => <li key={x.line_no}>Line {x.line_no} → <b style={{ fontWeight: 500 }}>{x.vendor}</b>{x.instead_of ? ` instead of ${x.instead_of}` : ""} — “{x.reason}”</li>)}</ul>
      : <div className="text-muted-foreground">The earlier version isn&apos;t on file to compare with, and no lines were changed by hand.</div>;
  }
  if (!c.option && !c.lines.length) return <div style={{ color: "var(--amber)" }}>No lines changed — same split and cost as the version before.</div>;
  return (
    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
      {c.option && <li>Drafted from “{c.option.to}” instead of “{c.option.from}”</li>}
      {c.lines.slice(0, 12).map((l) => <li key={l.line_no}>Line {l.line_no} {l.description}: {l.from ?? "no vendor"} → <b style={{ fontWeight: 500 }}>{l.to ?? "no vendor"}</b>
        <span className="text-muted-foreground"> ({rs(l.from_price)} → {rs(l.to_price)} per 1000 · {l.delta >= 0 ? "+" : "−"}{rs(Math.abs(l.delta))} a year){l.reason ? ` — “${l.reason}”` : ""}</span></li>)}
      {c.lines.length > 12 && <li className="text-muted-foreground">…and {c.lines.length - 12} more lines</li>}
      <li>Cost a year: {Math.abs(c.total_delta) < 0.5 ? "unchanged" : `${c.total_delta > 0 ? "+" : "−"}${rs(Math.abs(c.total_delta))}`}</li>
    </ul>
  );
}

/** A redrafted memo: the approver's note on the version before, next to what changed (so neither has to remember or compare PDFs). */
function NoteAnswered({ award, buyer }: { award: AwardView; buyer: boolean }) {
  const h = award.history;
  const cur = h[h.length - 1], prev = h[h.length - 2];
  if (!cur || !prev?.sent_back_note || award.status !== "draft") return null;
  return (
    <div className="card" style={{ marginTop: 12, borderColor: "var(--accent)" }}><div className="bd" style={{ fontSize: 13 }}>
      <div className="eyebrow">{buyer ? `${prev.sent_back_by ?? "Priya"}'s note on version ${prev.version}` : `You sent version ${prev.version} back`}{prev.sent_back_at ? ` · ${longDate(prev.sent_back_at)}` : ""}</div>
      <p style={{ margin: "6px 0 8px", whiteSpace: "pre-wrap" }}>“{prev.sent_back_note}”</p>
      <div className="eyebrow">{buyer ? `What you changed in version ${cur.version}` : `What ${cur.prepared_by ?? "Sujit"} changed in version ${cur.version}`}</div>
      <ChangeList v={cur} award={award} />
    </div></div>
  );
}

/** Every drafted memo, oldest first: who drafted it from which option, what changed, what the approver did; each version's PDF. */
function History({ award }: { award: AwardView }) {
  const [open, setOpen] = useState(award.history.length > 1);
  return (
    <div className="card" style={{ margin: "16px 0" }}>
      <div className="hd">
        <b style={{ fontSize: 13 }}>Memo history · {plural(award.history.length, "version")}</b>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"}</Button>
      </div>
      {open && <ol className="bd" style={{ listStyle: "none", margin: 0, display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        {award.history.map((v) => (
          <li key={v.version} style={{ borderLeft: `3px solid ${v.current ? "var(--accent)" : "var(--hair)"}`, paddingLeft: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontWeight: 600 }}>Version {v.version}</b>{v.current && <span className="chip teal">Current</span>}
              <span className="text-muted-foreground">drafted by {v.prepared_by ?? "the buyer"}{v.prepared_at ? ` · ${longDate(v.prepared_at)}` : ""}{v.scenario_name ? ` · from “${v.scenario_name}”` : ""}{v.total !== null ? ` · ${rs(v.total)} a year` : ""}</span>
              {v.pdf_url ? <a href={v.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>PDF</a> : <span className="hint">PDF not kept (drafted before memo history)</span>}
            </div>
            {v.version > 1 && <div style={{ marginTop: 4 }}><span className="text-muted-foreground">Changed since version {v.version - 1}:</span><ChangeList v={v} award={award} /></div>}
            {v.sent_back_note && <div style={{ marginTop: 4 }}><span className="chip amber">Sent back</span> by {v.sent_back_by ?? "the approver"}{v.sent_back_at ? ` · ${longDate(v.sent_back_at)}` : ""}: “{v.sent_back_note}”</div>}
            {v.approved_at && <div style={{ marginTop: 4 }}><span className="chip green">Approved</span> by {v.approved_by ?? "the approver"} · {longDate(v.approved_at)}</div>}
            {v.current && !v.sent_back_note && !v.approved_at && <div className="text-muted-foreground" style={{ marginTop: 4 }}>Waiting for approval</div>}
          </li>
        ))}
      </ol>}
    </div>
  );
}

/** One option as a card (SAP Ariba's scenario cards): cost, vendors, the saving in words, warnings as tags; ⋯ = rename · edit · delete. */
function Card({ s, on, lowest, tied, above, inMemo, compared, canCompare, onPick, onCompare, manage, buyer }: {
  s: ScenarioView; on: boolean; lowest: boolean; tied: boolean; above: number | null; inMemo: boolean; compared: boolean; canCompare: boolean; onPick: () => void; onCompare: () => void;
  manage: boolean | null; buyer: boolean; // manage: null = locked (no menu); false = not this user's option
}) {
  const router = useRouter();
  const one = vsOne(s);
  const expired = s.expiring.some((e) => e.days_left < 0);
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<"rename" | "edit" | "delete" | null>(null);
  const [name, setName] = useState(s.name);
  const [words, setWords] = useState(s.rule.question ?? "");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setElapsed(Date.now() - t0), 250); return () => clearInterval(t); }, [busy]);
  const fromQ = s.rule.type === "from_query";
  const why = manage === false ? `Created by ${s.created_by ?? "Sujit"} — only they or Sujit can change it` : null;
  const items: { key: "rename" | "edit" | "delete"; label: string; off: string | null }[] = [
    { key: "rename", label: "Rename", off: why },
    { key: "edit", label: "Edit what was asked", off: why ?? (!fromQ ? "Built by rule — rename it, or build a new one" : inMemo && !buyer ? "In the memo — only Sujit can change it" : null) },
    { key: "delete", label: "Delete", off: why ?? (inMemo ? "In the memo — draft the memo from another option first" : null) },
  ];
  async function save(body: unknown, method: string, done: string) {
    setBusy(true); setElapsed(0);
    const j = await call(`/api/scenarios/${s.id}`, body, method);
    setBusy(false);
    if (j) { toast.success(done); setMode(null); router.refresh(); }
  }
  const box = { border: `1px solid ${on ? "var(--accent)" : compared ? "var(--ink2)" : "var(--hair)"}`, boxShadow: on ? "inset 3px 0 0 var(--accent)" : undefined, borderRadius: 6, padding: 12, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 4, position: "relative" } as const;

  if (mode === "rename" || mode === "edit") return (
    <form style={box} onSubmit={(e) => { e.preventDefault();
      if (mode === "rename") save({ name }, "PATCH", `Renamed — ${name.trim()}`);
      else save(name.trim() !== s.name ? { name, question: words } : { question: words }, "PATCH", "Option updated from the new words"); }}>
      <label className="eyebrow" htmlFor={`nm-${s.id}`}>Name</label>
      <input id={`nm-${s.id}`} className="ta" style={{ height: 30 }} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={120} />
      {mode === "edit" && <>
        <label className="eyebrow" htmlFor={`wd-${s.id}`} style={{ marginTop: 6 }}>What was asked</label>
        <textarea id={`wd-${s.id}`} className="ta" style={{ minHeight: 84 }} value={words} onChange={(e) => setWords(e.target.value)} disabled={busy} />
        <span className="hint">Saving re-works this option from the new words{name.trim() === s.name ? " and gives it a new short name" : ""}. Your line changes are kept where that vendor still has a price.</span>
      </>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
        <Button type="button" size="sm" onClick={() => { setMode(null); setName(s.name); setWords(s.rule.question ?? ""); }} disabled={busy}>Cancel</Button>
        <Button type="submit" size="sm" variant="default" disabled={busy || !name.trim() || (mode === "edit" && !words.trim())}>{busy ? (mode === "edit" ? `Re-working… ${(elapsed / 1000).toFixed(0)} s` : "Saving…") : "Save"}</Button>
      </div>
    </form>
  );

  return (
    <div style={box}>
      {manage !== null && (
        <div style={{ position: "absolute", top: 6, right: 6 }}>
          <Button size="xs" variant="ghost" aria-label={`More actions for ${s.name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</Button>
          {menu && (
            <div role="menu" style={{ position: "absolute", right: 0, top: 26, zIndex: 20, minWidth: 220, background: "var(--surface)", border: "1px solid var(--hair)", borderRadius: 6, boxShadow: "0 6px 18px rgba(0,0,0,.12)", padding: 4 }}
              onMouseLeave={() => setMenu(false)}>
              {items.map((it) => (
                <button key={it.key} role="menuitem" type="button" disabled={!!it.off} title={it.off ?? undefined}
                  onClick={() => { setMenu(false); setMode(it.key); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "transparent", borderRadius: 4, fontSize: 13,
                    color: it.off ? "var(--muted)" : it.key === "delete" ? "var(--red)" : "var(--ink)", cursor: it.off ? "not-allowed" : "pointer" }}>
                  {it.label}{it.off && <div style={{ fontSize: 11.5 }}>{it.off}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={onPick} aria-pressed={on} style={{ all: "unset", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, paddingRight: 24 }}>
        <b style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</b>
        <span style={{ fontSize: 16 }}><span className="mono">{rs(s.total_after)}</span> a year</span>
        {above !== null && <span style={{ fontSize: 12.5, color: "var(--amber)" }}>{rs(above)} more than the lowest-cost option</span>}
        <span style={{ fontSize: 12.5 }}>{plural(s.vendor_count, "vendor")} · {s.allocated} of {s.lines.length} lines</span>
        {one && <span style={{ fontSize: 12.5, color: s.savings_vs_baseline! > 0.5 ? "var(--green)" : "var(--ink2)" }}>{one}</span>}
      </button>
      {mode === "delete" && (
        <div className="note" style={{ borderLeftColor: "var(--red)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>Delete this option?</span>
          <Button size="xs" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
          <Button size="xs" variant="default" disabled={busy} onClick={() => save(undefined, "DELETE", `Deleted — ${s.name}`)}>{busy ? "Deleting…" : "Delete"}</Button>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        {inMemo && <span className="chip green">In the memo</span>}
        {lowest && <span className="chip teal">{tied ? "Lowest cost (tied)" : "Lowest cost"}</span>}
        {s.outdated && <span className="chip amber">Prices changed</span>}
        {s.ties > 0 && <span className="chip grey">Tie on {plural(s.ties, "line")}</span>}
        {s.unallocated.length > 0 && <span className="chip amber">{s.unallocated.length} with no vendor</span>}
        {s.expiring.length > 0 && <span className={`chip ${expired ? "red" : "amber"}`}>{expired ? "Quote expired" : "Quote expiring"}</span>}
      </div>
      {canCompare && <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        <input type="checkbox" checked={compared} onChange={onCompare} />Compare with the selected option</label>}
      <div className="hint">{s.created_by ?? ""}{fromQ ? " · from a question" : " · by rule"}</div>
    </div>
  );
}

/** Only the lines where two options give different vendors, and what that costs. */
function Compare({ a, b, onClose }: { a: ScenarioView; b: ScenarioView; onClose: () => void }) {
  const diff = a.lines.flatMap((l) => {
    const o = b.lines.find((x) => x.rfx_line_id === l.rfx_line_id);
    return o && o.vendor_id !== l.vendor_id ? [{ l, o, d: (o.annual_value ?? 0) - (l.annual_value ?? 0) }] : [];
  });
  const d = b.total_after - a.total_after;
  return (
    <div className="bd" style={{ borderTop: "1px solid var(--hair2)", background: "var(--paper)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>{a.name} <span className="text-muted-foreground" style={{ fontWeight: 400 }}>vs</span> {b.name}</b>
        <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!diff.length ? (
        <p style={{ margin: "6px 0 0" }}>Same result: both options give every line to the same vendor{Math.abs(d) < 0.5 ? ", so the cost is the same." : `; the cost differs by ${inrShort(Math.abs(d))} only through discounts.`}</p>
      ) : <>
        <p style={{ margin: "6px 0 8px" }}>{plural(diff.length, "line")} go{diff.length === 1 ? "es" : ""} to a different vendor. “{b.name}” costs <b>{inrShort(Math.abs(d))} a year {d > 0 ? "more" : "less"}</b> and uses {plural(b.vendor_count, "vendor")} (this one uses {a.vendor_count}).</p>
        <table className="t" style={{ background: "var(--surface)" }}>
          <thead><tr><th>#</th><th>Line</th><th>{a.name}</th><th>{b.name}</th><th className="num">Difference a year</th></tr></thead>
          <tbody>{diff.map(({ l, o, d: x }) => (
            <tr key={l.rfx_line_id}><td className="mono text-muted-foreground">{l.line_no}</td><td>{l.description}</td>
              <td>{l.vendor ?? "no vendor"} <span className="mono text-muted-foreground">{rs(l.price)}</span></td>
              <td>{o.vendor ?? "no vendor"} <span className="mono text-muted-foreground">{rs(o.price)}</span></td>
              <td className="num mono">{x > 0 ? "+" : x < 0 ? "−" : ""}{rs(Math.abs(x))}</td></tr>
          ))}</tbody>
        </table>
      </>}
    </div>
  );
}

/** A big number with one line under it (What it costs). */
function Tile({ label, value, caption, tone }: { label: string; value: string; caption: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div style={{ border: "1px solid var(--hair)", borderRadius: 6, padding: "10px 12px", background: "var(--surface)" }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 18, margin: "4px 0 2px", color: tone === "good" ? "var(--green)" : tone === "bad" ? "var(--amber)" : undefined }}>{value}</div>
      <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>{caption}</div>
    </div>
  );
}

/** A vendor's discount, in one phrase, for its own row. */
function discountPhrase(d: ScenarioView["discounts"][0]): string {
  const offer = `Offered ${d.pct}% off${d.condition ? ` “${d.condition}”` : ""}`;
  return d.met === true ? `${offer} — earned: −${inrShort(d.saving)} a year` : d.met === false ? `${offer} — not earned here` : `${offer} — condition unclear, not applied (settle it in Review)`;
}

/** The selected option, top to bottom: out-of-date warning · name + Draft · what it costs · who gets the business · who doesn't and why · every line. */
function Detail({ s, opts, buyer, locked, award, busy, elapsed, onDraft, onRefresh }: {
  s: ScenarioView; opts: Record<string, Opt[]>; buyer: boolean; locked: boolean; award: AwardView | null; busy: string | null; elapsed: number;
  onDraft: () => void; onRefresh: () => void;
}) {
  const [showLines, setShowLines] = useState(false);
  const [only, setOnly] = useState("");
  const st = award?.status ?? null;
  const inMemo = award?.scenario_id === s.id;
  const canDraft = buyer && !locked && st !== "approved";
  const winners = s.vendors.filter((v) => v.lines > 0);
  const others = s.vendors.filter((v) => v.lines === 0);
  const sv = s.savings_vs_baseline;
  const extra = s.cheapest_any === null ? null : s.total_after - s.cheapest_any;
  const single = s.lines.filter((l) => l.vendor && !l.runner_up).map((l) => l.line_no);
  const disc = (name: string) => s.discounts.find((d) => d.vendor === name);
  const small = { fontSize: 12.5 } as const;
  return (
    <div className="bd" style={{ borderTop: "1px solid var(--hair2)", display: "flex", flexDirection: "column", gap: 16 }}>
      {s.outdated && !locked && (
        <div className="note" style={{ borderLeftColor: "var(--amber)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 240 }}><b>Prices changed since this option was saved</b> — line{s.changed_lines.length === 1 ? "" : "s"} {s.changed_lines.join(", ")} would now go differently or cost differently. Refresh it before drafting the memo.</span>
          <Button size="sm" variant="default" disabled={!!busy} onClick={onRefresh}>{busy === "ref" ? "Refreshing…" : "Refresh option"}</Button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <b style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</b>
          <div className="text-muted-foreground" style={small}>
            {plural(s.vendor_count, "vendor")} · {s.allocated} of {s.lines.length} lines · {s.rule.type === "from_query" ? "from a question" : "by rule"}{s.created_by ? ` by ${s.created_by}` : ""}
            {s.rule.type !== "from_query" && s.rule_text.trim().toLowerCase() !== s.name.trim().toLowerCase() ? ` · ${s.rule_text}` : ""}
          </div>
          {s.rule.type === "from_query" && s.rule.question && s.rule.question.trim() !== s.name.trim() && <div style={{ ...small, marginTop: 4 }}><span className="text-muted-foreground">What was asked:</span> “{s.rule.question}”</div>}
        </div>
        {canDraft && <Button variant="default" disabled={!!busy || s.outdated} title={s.outdated ? "Refresh the option first" : undefined} onClick={onDraft}>
          {busy === "gen" ? `Drafting… ${(elapsed / 1000).toFixed(0)} s` : inMemo && st === "draft" ? "Draft the memo again" : "Draft memo from this ▸"}</Button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <Tile label="This option costs" value={rs(s.total_after)}
          caption={<>a year{s.total_after < s.total - 0.5 ? `, after discounts (${rs(s.total)} as quoted)` : ""}</>} />
        {s.baseline && sv !== null && (
          <Tile label="Compared with one vendor" tone={sv > 0.5 ? "good" : sv < -0.5 ? "bad" : undefined}
            value={Math.abs(sv) < 0.5 ? "Same cost" : `${rs(Math.abs(sv))} ${sv > 0 ? "cheaper" : "more"}`}
            caption={<>than giving all lines to {s.baseline.vendor} ({rs(s.baseline.total)}){s.baseline.note ? ` — ${s.baseline.note}` : ""}</>} />
        )}
        {qualifiedRule(s.rule) && extra !== null && !s.outdated && (
          <Tile label="Cost of the questionnaire rule" tone={extra > 0.5 ? "bad" : undefined}
            value={extra > 0.5 ? `${rs(extra)} more` : "Nothing extra"}
            caption={<>than the cheapest split with any vendor, including those who didn&apos;t clear the questionnaire ({rs(s.cheapest_any)})</>} />
        )}
      </div>

      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Who gets the business</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {winners.map((v) => {
            const d = disc(v.name);
            return (
              <div key={v.name} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.4fr) 90px 130px minmax(120px, 1fr) 44px", gap: 12, alignItems: "center" }}>
                <div>
                  <div>{v.name}</div>
                  {(v.note || d) && <div style={{ ...small, color: v.note ? "var(--amber)" : "var(--muted)" }}>{[v.note, d && discountPhrase(d)].filter(Boolean).join(" · ")}</div>}
                </div>
                <span className="mono" style={{ textAlign: "right" }}>{v.lines} of {s.lines.length}</span>
                <span className="mono" style={{ textAlign: "right" }}>{rs(v.value)}</span>
                <span aria-hidden style={{ height: 8, borderRadius: 4, background: "var(--tint)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${v.pct}%`, background: "var(--accent)" }} /></span>
                <span className="mono" style={{ textAlign: "right" }}>{v.pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
        {(s.unallocated.length > 0 || single.length > 0) && <p className="text-muted-foreground" style={{ ...small, margin: "8px 0 0" }}>
          {s.unallocated.length > 0 && <>No vendor for line{s.unallocated.length === 1 ? "" : "s"} {s.unallocated.join(", ")}. </>}
          {single.length > 0 && <>Only one usable quote on line{single.length === 1 ? "" : "s"} {single.join(", ")}.</>}</p>}
      </section>

      {others.length > 0 && (
        <section>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Not in this option</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {others.map((v) => { const d = disc(v.name); return (
              <li key={v.name}><b style={{ fontWeight: 500 }}>{v.name}:</b> <span className="text-muted-foreground">{v.note}{d ? `. ${discountPhrase(d)}` : ""}.</span></li>
            ); })}
          </ul>
        </section>
      )}

      {s.expiring.map((e) => <div key={e.vendor} className="note" style={{ borderLeftColor: e.days_left < 0 ? "var(--red)" : "var(--amber)" }}>
        <b>{e.vendor}</b>&apos;s quote {e.days_left < 0 ? <>expired on {longDate(e.until)}</> : <>is valid only until {longDate(e.until)} ({plural(e.days_left, "day")} left)</>} — ask them to extend it before the award is approved.{" "}
        {buyer && <a href={`review?vendor=${e.vendor_code}`}>Ask {e.vendor} to extend →</a>}</div>)}

      <section>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" onClick={() => setShowLines(!showLines)} aria-expanded={showLines}>{showLines ? "Hide the lines" : `Show all ${s.lines.length} lines`}</Button>
          {showLines && <select className="sel" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Show lines for">
            <option value="">All vendors</option>
            {winners.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>}
        </div>
        {showLines && <Lines s={s} only={only} opts={opts} canEdit={buyer && !locked} />}
      </section>
    </div>
  );
}

/** Describe a split in words → Ask (same SQL path as the Ask panel) → saved straight in as an option when the answer gives each line a vendor. Both roles. */
function Describe({ rfxId, plies, onSaved }: { rfxId: string; plies: number[]; onSaved: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [miss, setMiss] = useState<string | null>(null);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setElapsed(Date.now() - t0), 250); return () => clearInterval(t); }, [busy]);
  const examples = ["Cheapest vendor per line, only vendors who cleared the questionnaire", "Cheapest vendor per line on landed cost",
    ...(plies.length > 1 ? [`${Math.max(...plies)}-ply to the cheapest qualified vendor, ${Math.min(...plies)}-ply to the cheapest overall`] : [])];
  async function go(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setQ(question); setBusy(true); setElapsed(0); setMiss(null);
    const a = (await call("/api/ask", { rfx_id: rfxId, question, allocate: true })) as AskAnswer | null;
    if (a && (!a.ok || !allocationColumn(a.columns, a.rows))) setMiss(a.ok ? a.answer_text : "I couldn't work that out from the grid — try rephrasing.");
    else if (a) { const sv = await call("/api/scenarios", { rfx_id: rfxId, name: question.slice(0, 120), query_id: a.query_id }); if (sv) { toast.success(`Saved — ${sv.name}`); setQ(""); onSaved(); router.refresh(); } }
    setBusy(false);
  }
  return (
    <div className="bd" style={{ borderBottom: "1px solid var(--hair2)", display: "flex", flexDirection: "column", gap: 8 }}>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); go(q); }}>
        <input className="ta" style={{ flex: 1, height: 32 }} value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} aria-label="Describe how to split the lines"
          placeholder="New option: describe how to split the lines, e.g. cheapest qualified vendor per line" />
        <Button type="submit" variant="default" disabled={busy || !q.trim()}>{busy ? `Working… ${(elapsed / 1000).toFixed(0)} s` : "Create option"}</Button>
      </form>
      <div className="sugg">{examples.map((x) => <button key={x} type="button" disabled={busy} onClick={() => go(x)}>{x}</button>)}</div>
      {miss && <div className="note" style={{ borderLeftColor: "var(--amber)", fontSize: 12.5 }}>That answer doesn&apos;t give each line a vendor, so it can&apos;t be an option. Say who should get the lines — e.g. “cheapest vendor per line …”.<div className="text-muted-foreground" style={{ marginTop: 4 }}>{miss}</div></div>}
    </div>
  );
}

/** Every line (TRD §14.2 / §17.11) in plain words: who gets it, the next cheapest and by how much, why; the buyer can change the vendor with a reason, or undo. */
function Lines({ s, only, opts, canEdit }: { s: ScenarioView; only: string; opts: Record<string, Opt[]>; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [vendor, setVendor] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  async function save(line: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    const j = await call(`/api/scenarios/${s.id}/override`, { rfx_line_id: line, ...body });
    setBusy(false);
    if (j) { toast.success(done); setEdit(null); router.refresh(); }
  }
  const next = (l: ScenarioView["lines"][0]) => {
    if (!l.runner_up) return <span className="text-muted-foreground">none — only quote</span>;
    const g = l.gap_pct;
    return <>{l.runner_up} <span className="mono">{rs(l.runner_up_price)}</span>
      <div className="text-muted-foreground" style={{ fontSize: 11.5 }}>{l.tie ? "same price" : g === null ? "" : g > 0 ? `${g.toFixed(1)}% more` : `${Math.abs(g).toFixed(1)}% less — you pay more by choice`}</div></>;
  };
  return (
    <table className="t" style={{ marginTop: 8 }}>
      <thead><tr><th>#</th><th>Line</th><th>Gets this line</th><th className="num">₹ per 1000</th><th className="num">₹ a year</th><th>Next cheapest</th><th>Why this vendor</th>{canEdit && <th />}</tr></thead>
      <tbody>
        {s.lines.filter((l) => !only || l.vendor === only).map((l) => (
          <Fragment key={l.rfx_line_id}>
            <tr>
              <td className="mono text-muted-foreground">{l.line_no}</td>
              <td>{l.description}</td>
              <td>{l.vendor ?? <span className="chip amber">No vendor</span>}</td>
              <td className="num mono">{rs(l.price)}</td><td className="num mono">{rs(l.annual_value)}</td>
              <td style={{ fontSize: 12.5 }}>{next(l)}</td>
              <td style={{ fontSize: 12.5 }}>{l.is_override ? <><span className="chip green">Changed by hand</span> {l.reason.replace(/^manual override: /, "")}{l.auto_vendor ? <span className="text-muted-foreground"> (the rule picked {l.auto_vendor})</span> : null}</> : <span className="text-muted-foreground">{l.reason}</span>}</td>
              {canEdit && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {l.is_override
                  ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => save(l.rfx_line_id, { revert: true }, `Undone — line ${l.line_no} back to ${l.auto_vendor ?? "the rule's pick"}`)}>Undo change</Button>
                  : <Button size="xs" variant="ghost" title="Give this line to another vendor. You must give a reason; it goes into the memo." onClick={() => { setEdit(edit === l.rfx_line_id ? null : l.rfx_line_id); setVendor(""); setReason(""); }}>Change vendor</Button>}
              </td>}
            </tr>
            {edit === l.rfx_line_id && (
              <tr><td colSpan={8}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
                  <select className="sel" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor for this line">
                    <option value="">Give line {l.line_no} to…</option>
                    {(opts[l.rfx_line_id] ?? []).filter((o) => o.id !== l.vendor_id).map((o) => <option key={o.id} value={o.id}>{o.name} · {rs(o.price)}</option>)}
                  </select>
                  <input className="ta" style={{ flex: 1, minWidth: 220, height: 28 }} placeholder="Reason (goes into the memo), e.g. incumbent tooling" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="default" disabled={!vendor || !reason.trim() || busy} onClick={() => save(l.rfx_line_id, { vendor_id: vendor, reason }, `Line ${l.line_no} now goes to ${(opts[l.rfx_line_id] ?? []).find((o) => o.id === vendor)?.name}`)}>{busy ? "Saving…" : "Change"}</Button>
                  <Button size="sm" onClick={() => setEdit(null)}>Cancel</Button>
                  {!(opts[l.rfx_line_id] ?? []).some((o) => o.id !== l.vendor_id) && <span className="hint">No other vendor has a usable price on this line under this option&apos;s rule.</span>}
                </div>
              </td></tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

type GroupRow = { kind: "ply" | "item_type" | "delivery_location"; value: string; qualified: boolean };
const KIND_LABEL = { ply: "Ply", item_type: "Item type", delivery_location: "Plant" };

/** TRD §17.11 New scenario: type, qualified only, basis, best guesses, groups, price-vs-questionnaire weight. */
function Builder({ rfxId, values, onDone }: { rfxId: string; values: Props["groupValues"]; onDone: () => void }) {
  const [type, setType] = useState<"cheapest_per_line" | "grouped" | "weighted">("cheapest_per_line");
  const [qualified, setQualified] = useState(true);
  const [basis, setBasis] = useState<"unit" | "landed">("unit");
  const [bg, setBg] = useState(false);
  const [price, setPrice] = useState(70);
  const first = (k: GroupRow["kind"]) => String((values[k] as (string | number)[])[0] ?? "");
  const [groups, setGroups] = useState<GroupRow[]>(values.ply.length > 1
    ? [{ kind: "ply", value: String(Math.max(...values.ply)), qualified: true }, { kind: "ply", value: String(Math.min(...values.ply)), qualified: false }]
    : [{ kind: "ply", value: first("ply"), qualified: true }]);
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const b = basis === "landed" ? "landed" : "unit";
  const label = (g: GroupRow) => `${g.kind === "ply" ? `${g.value}-ply` : g.value} ${g.qualified ? "qualified" : "overall"}`;
  const auto = type === "cheapest_per_line" ? `Cheapest ${qualified ? "qualified" : "overall"} per line (${b})`
    : type === "weighted" ? `Weighted ${price}/${100 - price}${qualified ? " qualified" : ""} (${b})` : `${groups.map(label).join(" + ")} (${b})`;
  const filter = (g: GroupRow): Filter => (g.kind === "ply" ? { ply: Number(g.value) } : { [g.kind]: g.value });
  const rule: Rule = type === "grouped"
    ? { type, price_basis: basis, include_best_guess: bg, groups: groups.map((g) => ({ filter: filter(g), rule: { type: "cheapest_per_line", qualified_only: g.qualified } as SubRule })) }
    : { type, price_basis: basis, include_best_guess: bg, qualified_only: qualified, ...(type === "weighted" ? { weights: { price: price / 100, questionnaire: Math.round(100 - price) / 100 } } : {}) };
  async function save() {
    setBusy(true);
    const n = name.trim() || auto;
    const j = await call("/api/scenarios", { rfx_id: rfxId, name: n, rule });
    setBusy(false);
    if (j) { toast.success(`Saved — ${n}`); onDone(); }
  }
  const check = (v: boolean, set: (x: boolean) => void, text: string) => <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />{text}</label>;
  return (
    <div className="bd" style={{ borderBottom: "1px solid var(--hair2)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div className="seg" role="group" aria-label="Rule">
          {([["cheapest_per_line", "Cheapest per line"], ["grouped", "By group"], ["weighted", "Weighted"]] as const).map(([k, t]) => <button key={k} className={type === k ? "on" : ""} onClick={() => setType(k)}>{t}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Price basis">
          <button className={basis === "unit" ? "on" : ""} onClick={() => setBasis("unit")}>Unit price</button>
          <button className={basis === "landed" ? "on" : ""} onClick={() => setBasis("landed")}>Landed cost</button>
        </div>
        {type !== "grouped" && check(qualified, setQualified, "Only vendors who cleared the questionnaire")}
        {check(bg, setBg, "Include best guesses")}
      </div>
      {type === "grouped" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
              <select className="sel" value={g.kind} aria-label="Group by" onChange={(e) => { const kind = e.target.value as GroupRow["kind"]; setGroups(groups.map((x, j) => (j === i ? { ...x, kind, value: first(kind) } : x))); }}>
                {(Object.keys(KIND_LABEL) as GroupRow["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <select className="sel" value={g.value} aria-label="Value" onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                {(values[g.kind] as (string | number)[]).map((v) => <option key={String(v)} value={String(v)}>{g.kind === "ply" ? `${v}-ply` : v}</option>)}
              </select>
              <span className="text-muted-foreground">lines →</span>
              <select className="sel" value={g.qualified ? "q" : "all"} aria-label="Rule for this group" onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, qualified: e.target.value === "q" } : x)))}>
                <option value="q">cheapest vendor who cleared the questionnaire</option>
                <option value="all">cheapest vendor overall</option>
              </select>
              {groups.length > 1 && <Button size="xs" variant="ghost" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button size="xs" onClick={() => setGroups([...groups, { kind: "ply", value: first("ply"), qualified: true }])}>Add group</Button>
            <span className="hint">Lines no group covers stay unallocated and are flagged. The first matching group wins.</span>
          </div>
        </div>
      )}
      {type === "weighted" && (
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
          <span className="text-muted-foreground" style={{ width: 120 }}>Price vs questionnaire</span>
          <input type="range" min={0} max={100} step={5} value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ width: 220, accentColor: "var(--accent)" }} />
          <span className="mono">{price}% price · {100 - price}% questionnaire</span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="ta" style={{ flex: 1, minWidth: 240, height: 30 }} placeholder={auto} value={name} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" />
        <Button variant="default" disabled={busy || (type === "grouped" && !groups.length)} onClick={save}>{busy ? "Saving…" : "Save scenario"}</Button>
      </div>
    </div>
  );
}
