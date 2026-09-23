"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AskAnswer } from "@/lib/query/ask";
import type { ChartSpec, Row } from "@/lib/query/result";
import { inrShort, money } from "@/lib/format";
import { Button } from "@/components/ui/button";

const PAGE = 25;
const isMoney = (c: string) => /_inr$|price|value|total|spend|saving|impact|cost|amount/i.test(c) && !/pct|percent|rank|probability/i.test(c);
const isPct = (c: string) => /pct|percent/i.test(c);
const label = (c: string) => c === "line_no" ? "Line" : c === "q_no" ? "Q" : (c.replace(/_inr$/, "").replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase()));

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

/** DESIGN §2.15: label · track · value, one colour, no library. */
function Bars({ spec }: { spec: ChartSpec }) {
  const y = spec.series[0].y;
  const max = Math.max(...spec.data.map((d) => Math.abs(Number(d[y]) || 0)), 1);
  const moneyish = isMoney(y) || y === "value";
  return (
    <div style={{ marginTop: 10 }}>
      <div className="text-muted-foreground" style={{ fontSize: 11, marginBottom: 4 }}>{spec.title}</div>
      {spec.data.map((d, i) => {
        const v = Number(d[y]) || 0;
        return (
          <div className="bar" key={i}>
            <span className="lbl" title={String(d[spec.x])}>{String(d[spec.x])}</span>
            <span className="trk"><span className="fill" style={{ width: `${(Math.abs(v) / max * 100).toFixed(1)}%` }} /></span>
            <span className="v">{moneyish ? inrShort(v) : v.toLocaleString("en-IN")}</span>
          </div>
        );
      })}
    </div>
  );
}

function Rows({ columns, rows }: { columns: string[]; rows: Row[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE);
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <div className="rows">
        <table className="t">
          <thead><tr>{columns.map((c) => <th key={c} className={rows.some((r) => fmt(c, r[c]).num) ? "num" : undefined}>{label(c)}</th>)}</tr></thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i}>{columns.map((c) => { const f = fmt(c, r[c]); return <td key={c} className={f.num ? "num mono" : undefined}>{f.text}</td>; })}</tr>
            ))}
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
  const [bg, setBg] = useState<AskAnswer | null>(null);
  const [showBg, setShowBg] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = showBg && bg ? bg : a;

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
  return (
    <div className="qa">
      <div className="q">{a.question}</div>
      <div className="a">{cur.answer_text}</div>
      {cur.exclusions.length > 0 && <div className="excl">Excluded: {exclText(cur)}</div>}
      {a.ok && (
        <div className="how">
          How I computed this: {cur.computed_note || "one query over the comparison."}{" "}
          {cur.sql && <button onClick={() => setSqlOpen(!sqlOpen)}>{sqlOpen ? "Hide query" : "Show query"}</button>}
        </div>
      )}
      {sqlOpen && cur.sql && <pre>{cur.sql}</pre>}
      {cur.chart_spec && <Bars spec={cur.chart_spec} />}
      {cur.rows.length > 0 && <Rows key={cur.query_id} columns={cur.columns} rows={cur.rows} />}
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
      <div className="acts">
        {a.ok && !bg && unsureInScope && a.unresolved_cells > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={bestGuesses}>{busy ? "Computing…" : "Include best guesses"}</Button>}
        {cur.ok && cur.rows.length > 0 && <>
          <Button asChild size="sm"><a href={`/api/export/query/${cur.query_id}?format=xlsx`} download>Export</a></Button>
          <Button asChild size="sm" variant="ghost"><a href={`/api/export/query/${cur.query_id}?format=csv`} download>CSV</a></Button>
        </>}
        <span className="hint" style={{ marginLeft: "auto" }}>{a.asked_by ? `${a.asked_by} · ` : ""}{(cur.duration_ms / 1000).toFixed(1)} s</span>
      </div>
    </div>
  );
}
