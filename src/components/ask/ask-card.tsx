"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DownloadButton } from "@/components/download-button";
import type { AskAnswer } from "@/lib/query/ask";
import { allocationColumn, type Row } from "@/lib/query/result";
import { inrShort, isMoneyColumn, isPctColumn, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ProvenanceDrawer } from "@/components/compare/drawer";
import { useAsk } from "./ask-sheet";
import { AskChart } from "./charts";

/** P11 #16: sends a follow-up to the analyst conversation the card sits in (absent where there is none: follow-ups hide). */
export const AskSendCtx = createContext<((message: string) => void) | null>(null);

const PAGE = 25;
const isPct = isPctColumn, isMoney = isMoneyColumn;
const label = (c: string) => c === "line_no" ? "Line" : c === "q_no" ? "Q" : (c.replace(/_inr$/, "").replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase()));
/** P11 #15: prices in the comparison are ₹ per 1000 pieces (the vendor's own figure, original_*, is not). */
const perThousand = (c: string) => /price/i.test(c) && !/^original_|rank|pct|percent|_inr$|annual|total/i.test(c);

function fmt(c: string, v: unknown): { text: string; num: boolean } {
  if (v === null || v === undefined || v === "") return { text: "—", num: false };
  if (typeof v === "boolean") return { text: v ? "Yes" : "No", num: false };
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
  if (n === null) return { text: String(v), num: false };
  if (c === "line_no" || c === "q_no") return { text: String(n), num: true };
  if (isPct(c)) return { text: `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`, num: true };
  if (isMoney(c)) return { text: money(Math.round(n)), num: true };
  if (/probability/i.test(c)) return { text: n.toFixed(2), num: true };
  return { text: n.toLocaleString("en-IN", { maximumFractionDigits: 2 }), num: true };
}

const sortValue = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === null || v === undefined || v === "" ? null : String(v));

/** P11 #14 #15: sortable columns, sticky header, units on prices; a row with a line and a vendor opens that cell's source. */
function Rows({ columns, rows, cellOf, onOpen }: { columns: string[]; rows: Row[]; cellOf: (r: Row) => string | null; onOpen: (key: string) => void }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ c: string; dir: 1 | -1 } | null>(null);
  const sorted = !sort ? rows : [...rows].sort((a, b) => {
    const x = sortValue(a[sort.c]), y = sortValue(b[sort.c]);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // blanks last either way
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-IN", { numeric: true })) * sort.dir;
  });
  const pages = Math.ceil(rows.length / PAGE);
  const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const by = (c: string) => { setPage(0); setSort(sort?.c === c ? (sort.dir === 1 ? { c, dir: -1 } : null) : { c, dir: 1 }); };
  return (
    <>
      <div className="rows">
        <table className="t">
          <thead><tr>{columns.map((c) => (
            <th key={c} className={rows.some((r) => fmt(c, r[c]).num) ? "num" : undefined} aria-sort={sort?.c === c ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
              <button onClick={() => by(c)} title="Sort">{label(c)}{perThousand(c) && <span className="unit">₹/1000 pcs</span>}{sort?.c === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
            </th>))}</tr></thead>
          <tbody>
            {slice.map((r, i) => {
              const key = cellOf(r);
              return (
                <tr key={i} className={key ? "open-src" : undefined} onClick={key ? () => onOpen(key) : undefined} title={key ? "Open where this price came from" : undefined}
                  tabIndex={key ? 0 : undefined} onKeyDown={key ? (e) => { if (e.key === "Enter") onOpen(key); } : undefined}>
                  {columns.map((c) => { const f = fmt(c, r[c]); return <td key={c} className={f.num ? "num mono" : undefined}>{f.text}</td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="hint" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <span>Rows {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
          <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="xs" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

const exclText = (a: AskAnswer) => a.exclusions.map((e) => e.vendor ? `${e.vendor} — ${e.reason}` : `${e.cells} ${e.reason}`).join("; ");

/** DESIGN §2.13 answer card. "Include best guesses" re-runs this answer's SQL on the best-guess view (TRD §13.2). */
export function AskCard({ a, rfxId }: { a: AskAnswer; rfxId: string }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bg, setBg] = useState<AskAnswer | null>(null);
  const [showBg, setShowBg] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = showBg && bg ? bg : a;
  // TRD §13.5 / DESIGN §2.13: Save as scenario only on answers that allocate lines (line_no + vendor, one row per line); never on a locked RFx.
  const router = useRouter();
  const locked = useAsk()?.locked ?? false;
  const saveable = cur.ok && !locked && allocationColumn(cur.columns, cur.rows) !== null;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(a.question.slice(0, 120));
  const [saved, setSaved] = useState<string | null>(null);
  async function saveScenario() {
    setBusy(true);
    try {
      const res = await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx_id: rfxId, name: name.trim() || a.question, query_id: cur.query_id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "Couldn't save the scenario"} (${body.code ?? res.status})`);
      toast.success(`Saved — ${body.name}`); setSaved(body.name); setNaming(false); router.refresh();
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server — check the connection and try again (NETWORK)" : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function bestGuesses() {
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx_id: rfxId, question: a.question, include_best_guess: true, base_query_id: a.query_id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "Request failed"} (${body.code ?? res.status})`);
      setBg(body); setShowBg(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  const unsureInScope = a.exclusions.some((e) => e.cells) || a.columns.includes("state");
  // P11 #14: the cell a row points at — its line and its vendor (by code, or by name through the RFx's vendor list).
  const [cell, setCell] = useState<string | null>(null);
  const vcol = cur.columns.find((c) => c === "vendor_code") ?? cur.columns.find((c) => c === "vendor") ?? cur.columns.find((c) => /vendor/i.test(c) && !/runner|second|next|alt|count|_id$/i.test(c));
  const cellOf = (r: Row): string | null => {
    if (!vcol || !cur.columns.includes("line_no") || r.line_no === null || r.line_no === undefined) return null;
    const v = String(r[vcol] ?? ""), code = (cur.vendors ?? []).find((x) => x.code === v || x.name === v)?.code;
    return code ? `${r.line_no}:${code}` : null;
  };
  const send = useContext(AskSendCtx);
  const followUps = send ? cur.follow_ups ?? [] : []; // questions only, so a locked RFx keeps them
  return (
    <div className="qa">
      <div className="q qhead">
        <span>{a.question}</span>
        <button className="qa-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Expand" : "Collapse"}</button>
      </div>
      <div className="a">{cur.answer_text}</div>
      {!collapsed && <>
      {cur.exclusions.length > 0 && <div className="excl">Excluded: {exclText(cur)}</div>}
      {cur.truncated && <div className="excl">More than {cur.rows.length.toLocaleString("en-IN")} rows — only the first {cur.rows.length.toLocaleString("en-IN")} are kept, so no total or chart is shown. Ask a narrower question.</div>}
      {cur.discount_note && <div className="note">{cur.discount_note}</div>}
      {a.ok && (
        <div className="how">
          How I computed this: {cur.computed_note || "one query over the comparison."}{" "}
          {cur.sql && <button onClick={() => setSqlOpen(!sqlOpen)}>{sqlOpen ? "Hide query" : "Show query"}</button>}
        </div>
      )}
      {sqlOpen && cur.sql && <pre>{cur.sql}</pre>}
      {cur.chart_spec && <AskChart spec={cur.chart_spec} vendors={cur.vendors ?? []} />}
      {cur.rows.length > 0 && <Rows key={cur.query_id} columns={cur.columns} rows={cur.rows} cellOf={cellOf} onOpen={setCell} />}
      {cell && <ProvenanceDrawer key={cell} rfxId={rfxId} cellKey={cell} basis={cur.columns.some((c) => /landed/i.test(c)) ? "landed" : "unit"} canReview={false} onClose={() => setCell(null)} />}
      {followUps.length > 0 && (
        <div className="fu sugg">{followUps.map((f) => <button key={f.label} onClick={() => send!(f.message)}>{f.label}</button>)}</div>
      )}
      {a.ok && a.rows.length === 0 && <div className="hint" style={{ marginTop: 8 }}>The query returned no rows.</div>}
      {bg?.best_guess && (
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
          <div className="seg">
            <button className={!showBg ? "on" : ""} onClick={() => setShowBg(false)}>Without best guesses <span className="mono">{bg.best_guess.total_without !== null ? inrShort(bg.best_guess.total_without) : "—"}</span></button>
            <button className={showBg ? "on" : ""} onClick={() => setShowBg(true)}>With best guesses <span className="mono">{bg.best_guess.total_with !== null ? inrShort(bg.best_guess.total_with) : "—"}</span></button>
          </div>
          <span className="hint">{bg.best_guess.cells} cell{bg.best_guess.cells === 1 ? "" : "s"} filled with the system&apos;s best guess</span>
        </div>
      )}
      {a.ok && !bg && unsureInScope && a.unresolved_cells > 0 && (
        <div className="small" style={{ marginTop: 10, fontSize: 12, color: "var(--amber)" }}>
          {a.unresolved_cells} cells unresolved in this RFx{a.at_stake > 0 ? ` · ${inrShort(a.at_stake)} at stake` : ""} — totals leave them out.
        </div>
      )}
      {naming && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ta" style={{ flex: 1, minWidth: 180, height: 28 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") saveScenario(); if (e.key === "Escape") setNaming(false); }} />
          <Button size="sm" variant="default" disabled={busy || !name.trim()} onClick={saveScenario}>{busy ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </div>
      )}
      <div className="acts">
        {saveable && !naming && (saved
          ? <span className="hint" style={{ alignSelf: "center" }}>Saved as “{saved}” — compare it on the Award tab</span>
          : <Button size="sm" onClick={() => setNaming(true)}>Save as scenario</Button>)}
        {a.ok && !bg && unsureInScope && a.unresolved_cells > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={bestGuesses}>{busy ? "Computing…" : "Include best guesses"}</Button>}
        {cur.ok && cur.rows.length > 0 && <>
          <DownloadButton href={`/api/export/query/${cur.query_id}?format=xlsx`} size="sm">Export</DownloadButton>
          <DownloadButton href={`/api/export/query/${cur.query_id}?format=csv`} size="sm" variant="ghost">CSV</DownloadButton>
        </>}
        <span className="hint" style={{ marginLeft: "auto" }}>{a.asked_by ? `${a.asked_by} · ` : ""}{(cur.duration_ms / 1000).toFixed(1)} s</span>
      </div>
      </>}
    </div>
  );
}
