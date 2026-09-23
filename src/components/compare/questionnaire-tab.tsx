"use client";

import { useState } from "react";
import type { QaGrid } from "@/lib/rfx-tabs";

/** DESIGN §3.7 / TRD §17.9: 10 rows × vendors, ◆ disqualifying, red "No", amber unclear / "—"; click an answer → its evidence. */
export function QuestionnaireTab({ qa }: { qa: QaGrid }) {
  const [sel, setSel] = useState<{ q: number; v: string } | null>(null);
  const row = sel && qa.rows.find((r) => r.q_no === sel.q);
  const a = row?.answers[sel!.v];
  const vendor = sel && qa.vendors.find((v) => v.code === sel.v);
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>#</th><th>Question</th>{qa.vendors.map((v) => <th key={v.code}>{v.name}</th>)}</tr></thead>
          <tbody>
            {qa.rows.map((r) => (
              <tr key={r.q_no}>
                <td className="mono text-muted-foreground">Q{r.q_no}{r.disqualifying ? " ◆" : ""}</td>
                <td style={{ maxWidth: 360 }}>{r.text}</td>
                {qa.vendors.map((v) => {
                  const x = r.answers[v.code];
                  const on = sel?.q === r.q_no && sel.v === v.code;
                  return (
                    <td key={v.code} title={x?.tip} onClick={() => x && setSel(on ? null : { q: r.q_no, v: v.code })}
                      style={{ cursor: x ? "pointer" : undefined, outline: on ? "2px solid var(--ink)" : undefined, outlineOffset: -2 }}>
                      {!x ? <span className="hint">not read</span> : x.tone ? <span className={`chip ${x.tone}`}>{x.show}</span> : x.show}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row && a && vendor && (
        <div className="bd" style={{ borderTop: "1px solid var(--hair2)", display: "grid", gridTemplateColumns: "minmax(240px, 420px) 1fr", gap: 16 }}>
          <div className="evidence">
            <div className="snip">{a.snippet ?? a.raw ?? "The vendor didn't answer this question."}</div>
            <div className="cap">{vendor.name}{a.where ? ` · ${a.where}` : ""}</div>
          </div>
          <div style={{ fontSize: 12.5 }}>
            <div style={{ fontWeight: 600 }}>Q{row.q_no} · {vendor.name}</div>
            <div className="text-muted-foreground" style={{ marginTop: 4 }}>{row.text}</div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Vendor&apos;s answer</dt><dd>{a.raw ?? "—"}</dd>
              <dt>Read as</dt><dd>{a.show} · {a.state}</dd>
              {a.p && <><dt>Probability</dt><dd className="mono">{a.p}</dd></>}
              {row.disqualifying && <><dt>Disqualifying rule</dt><dd>{a.passes === true ? "passes" : a.passes === false ? <span className="chip red">fails</span> : <span className="chip amber">not decided yet</span>}</dd></>}
            </dl>
          </div>
        </div>
      )}
      <div className="bd hint">◆ disqualifying · amber = unclear or not answered · click an answer for the vendor&apos;s words</div>
    </div>
  );
}
