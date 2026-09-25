"use client";

import { Fragment, useState } from "react";
import type { ModelCallRow } from "@/lib/model-calls";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { send } from "./api";

const PURPOSES = ["classify", "extract", "map", "normalise", "questionnaire", "flags", "copilot", "dispatch", "clarify", "ask_sql", "ask_narrate", "memo"];
// DESIGN §0.6 / TRD §10: the provider label says whether a probability was measured or estimated.
const PROVIDER: Record<string, string> = { gemini: "LLM-estimated (Gemini)", "jev-openrouter": "measured (Jev)" };
const k = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-IN"));

/** DESIGN §3.10 "Model calls"; TRD §17.15 (GET /api/logs with filters). */
export function ModelCalls({ initial, rfx }: { initial: ModelCallRow[]; rfx: { id: string; code: string }[] }) {
  const [rows, setRows] = useState(initial);
  const [f, setF] = useState({ rfx: "", purpose: "", provider: "", ok: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeOf = new Map(rfx.map((r) => [r.id, r.code]));

  async function load(next = f) {
    setF(next);
    setBusy(true);
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    const r = await send<{ items: ModelCallRow[] }>(`/api/logs?${qs}`, "GET", undefined, "Couldn't load model calls");
    setBusy(false);
    if (r) setRows(r.items);
  }
  const sel = (key: keyof typeof f, label: string, opts: [string, string][]) => (
    <select className="sel" aria-label={label} value={f[key]} disabled={busy} onChange={(e) => load({ ...f, [key]: e.target.value })}>
      <option value="">{label}</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const failed = rows.filter((r) => !r.ok).length;

  return (
    <section id="model-calls">
      <h2 style={{ marginTop: 28 }}>Model calls</h2>
      <p className="muted small" style={{ margin: "4px 0 12px" }}>Every call, with purpose and provider. Nothing is hidden.</p>
      <div className="card">
        <div className="hd">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sel("rfx", "All RFx", rfx.map((r) => [r.id, r.code]))}
            {sel("purpose", "All purposes", PURPOSES.map((p) => [p, p]))}
            {sel("provider", "All providers", Object.entries(PROVIDER))}
            {sel("ok", "Any result", [["true", "ok"], ["false", "failed"]])}
          </div>
          <span className="hint">{busy ? "Loading…" : `${rows.length === 200 ? "latest 200" : rows.length} call${rows.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed — click one for its error` : ""}`} <Button size="sm" variant="ghost" disabled={busy} onClick={() => load()}>Refresh</Button></span>
        </div>
        {rows.length ? (
          <div className="evalrows">
            <table className="t">
              <thead><tr><th>Time</th><th>RFx</th><th>Purpose</th><th>Provider</th><th>Model</th><th className="num">In</th><th className="num">Out</th><th className="num">Latency</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr onClick={() => !r.ok && setOpen(open === r.id ? null : r.id)} style={r.ok ? undefined : { cursor: "pointer" }} title={r.error ?? undefined}>
                      <td className="mono xs">{dateTime(r.created_at)}</td>
                      <td className="mono xs">{r.rfx_id ? codeOf.get(r.rfx_id) ?? "—" : "—"}</td>
                      <td className="mono xs">{r.purpose}</td>
                      <td>{PROVIDER[r.provider] ?? r.provider}</td>
                      <td className="mono xs">{r.model}</td>
                      <td className="num">{k(r.input_tokens)}</td><td className="num">{k(r.output_tokens)}</td>
                      <td className="num">{r.latency_ms == null ? "—" : `${(r.latency_ms / 1000).toFixed(1)}s`}</td>
                      <td>{r.ok ? <span className="chip green">OK</span> : <span className="chip red">Failed</span>}</td>
                    </tr>
                    {open === r.id && <tr><td colSpan={9} className="xs" style={{ background: "var(--tint)", whiteSpace: "pre-wrap" }}>{r.error ?? "No error text was recorded."}</td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="bd"><div className="empty"><b>No model calls{Object.values(f).some(Boolean) ? " match these filters" : " yet"}.</b> {Object.values(f).some(Boolean) ? "Clear a filter to see more." : "Calls appear here as soon as a stage, a question or a memo runs."}</div></div>}
      </div>
    </section>
  );
}
