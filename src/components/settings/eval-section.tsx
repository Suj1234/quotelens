"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CellResult, StoredEval, Verdict } from "@/lib/eval/run";
import { dateTime, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ProvenanceDrawer, STATE_LABEL } from "@/components/compare/drawer";
import { send } from "./api";

type Eligible = { id: string; code: string; title: string; set: string };
const ORDER: Verdict[] = ["wrong", "missing", "flagged_ok", "correct"];
const VERDICT: Record<Verdict, [string, string]> = { correct: ["correct", "green"], flagged_ok: ["flagged OK", "amber"], wrong: ["wrong", "red"], missing: ["missing", "red"] };
const n = (v: number | null) => (v == null ? "—" : money(v, "INR", Number.isInteger(v) ? 0 : 2).replace("₹", ""));

/** DESIGN §3.10 "Eval — seed set"; TRD §17.14 / §18. Shows the latest stored run; Run eval re-judges the current grid. */
export function EvalSection({ eligible, selected, last, vendors }: { eligible: Eligible[]; selected: Eligible | null; last: StoredEval | null; vendors: Record<string, string> }) {
  const router = useRouter();
  const [running, setRunning] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<"all" | "off" | Verdict>("all");
  const [vendor, setVendor] = useState("all");
  const [cell, setCell] = useState<string | null>(null);
  useEffect(() => {
    if (running === null) return;
    const t = setInterval(() => setRunning((s) => (s === null ? null : s + 1)), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function run() {
    if (!selected) return;
    setRunning(0);
    const r = await send<{ totals: StoredEval["totals"] }>("/api/eval/run", "POST", { rfx_id: selected.id }, "Eval failed — Retry");
    setRunning(null);
    if (r) { toast(`Eval done — ${r.totals.correct + r.totals.flagged_ok}/${r.totals.cells}`); router.refresh(); }
  }

  const rows = useMemo(() => (last?.per_cell ?? [])
    .filter((c) => (verdict === "all" || (verdict === "off" ? c.verdict !== "correct" : c.verdict === verdict)) && (vendor === "all" || c.vendor === vendor))
    .sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.vendor.localeCompare(b.vendor) || a.line_no - b.line_no), [last, verdict, vendor]);
  const t = last?.totals;
  const reviewed = last?.per_cell.filter((c) => c.state === "reviewed").length ?? 0;
  const qMiss = (last?.per_question ?? []).filter((q) => !q.ok);
  const vendorCodes = [...new Set((last?.per_cell ?? []).map((c) => c.vendor))];

  return (
    <section>
      <p className="muted small" style={{ margin: "0 0 12px" }}>The grid compared against a 150-cell answer key. Run before every demo.</p>
      {!eligible.length ? (
        <div className="empty"><b>No RFx can be judged yet.</b> The answer key covers the seed replies — open an RFx and use Load seeded responses, then run its stages.</div>
      ) : (
        <>
          <div className="toolbar">
            <select className="sel" value={selected?.id} aria-label="RFx to judge" onChange={(e) => router.push(`/settings/eval?rfx=${e.target.value}`, { scroll: false })}>
              {eligible.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.set} set</option>)}
            </select>
            <Button variant="default" size="sm" disabled={running !== null} onClick={run}>{running !== null ? `Running… ${running}s` : "Run eval"}</Button>
            <span className="hint">{last ? `Last run ${dateTime(last.ran_at)} · judged on the current state${reviewed ? ` — ${reviewed} cell${reviewed === 1 ? "" : "s"} reviewed by the buyer` : " — before review"}` : "Never run on this RFx."}</span>
          </div>
          {!last || !t ? (
            <div className="empty"><b>No eval run for {selected?.code} yet.</b> Run eval to compare its grid with the answer key.</div>
          ) : (
            <>
              <div className="grid3">
                <div className="card bd stat"><span className="v">{t.correct + t.flagged_ok}<span className="muted" style={{ fontSize: 14 }}>/{t.cells}</span></span><span className="l">correct or honestly flagged · questionnaire {t.questionnaire_correct}/{t.questionnaire_total}</span></div>
                <div className="card bd stat"><span className="v">{t.correct} · {t.flagged_ok}</span><span className="l">correct · flagged OK</span></div>
                <div className="card bd stat"><span className="v">{t.wrong} · {t.missing}</span><span className="l">wrong · missing</span></div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="hd">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select className="sel" value={verdict} aria-label="Verdict" onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
                      <option value="all">All verdicts</option><option value="off">Not correct</option>
                      {ORDER.map((v) => <option key={v} value={v}>{VERDICT[v][0]}</option>)}
                    </select>
                    <select className="sel" value={vendor} aria-label="Vendor" onChange={(e) => setVendor(e.target.value)}>
                      <option value="all">All vendors</option>
                      {vendorCodes.map((v) => <option key={v} value={v}>{vendors[v] ?? v}</option>)}
                    </select>
                  </div>
                  <span className="hint">{rows.length} of {t.cells} cells · ₹ per 1000 pcs · click a row for where the number came from</span>
                </div>
                <div className="evalrows">
                  <table className="t">
                    <thead><tr><th>Vendor</th><th>Line</th><th>State</th><th className="num">Expected</th><th className="num">Got</th><th>Verdict</th></tr></thead>
                    <tbody>
                      {rows.map((c) => <Row key={`${c.vendor}:${c.line_no}`} c={c} name={vendors[c.vendor] ?? c.vendor} onOpen={() => setCell(`${c.line_no}:${c.vendor}`)} />)}
                      {!rows.length && <tr><td colSpan={6} className="muted">No cells match these filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="legend" style={{ padding: "8px 14px", borderTop: "1px solid var(--hair2)" }}>
                  <span className="chip green">Correct</span> state and price match (±1%)
                  <span className="chip amber">Flagged OK</span> marked unsure, best guess right
                  <span className="chip red">Wrong</span> state or price off
                  <span className="chip red">Missing</span> no cell
                </div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="hd"><b>Questionnaire</b><span className="hint">{t.questionnaire_correct} of {t.questionnaire_total} answers match the key</span></div>
                {qMiss.length ? (
                  <table className="t">
                    <thead><tr><th>Vendor</th><th>Question</th><th>Expected</th><th>Got</th></tr></thead>
                    <tbody>{qMiss.map((q) => (
                      <tr key={`${q.vendor}:${q.q_no}`}><td>{vendors[q.vendor] ?? q.vendor}</td><td className="mono">Q{q.q_no}</td><td>{expectedQ(q.expected)}</td><td>{gotQ(q.got)}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <div className="bd hint">{last.per_question?.length ? "Every answer matches the key." : "This run predates the stored questionnaire detail — Run eval to list mismatches."}</div>}
              </div>
            </>
          )}
        </>
      )}
      {cell && selected && <ProvenanceDrawer key={cell} rfxId={selected.id} cellKey={cell} basis="unit" canReview={false} onClose={() => setCell(null)} />}
    </section>
  );
}

function Row({ c, name, onOpen }: { c: CellResult; name: string; onOpen: () => void }) {
  const [label, tone] = c.state ? STATE_LABEL[c.state] ?? [c.state, "grey"] : ["No cell", "red"];
  const exp = c.expected == null ? "—" : `${n(c.expected)}${c.expected_state === "ambiguous" || c.expected_state === "low_confidence" ? " (best guess)" : ""}`;
  const got = c.got != null ? n(c.got) : c.best_guess != null ? `${n(c.best_guess)}?` : "—";
  return (
    <tr onClick={onOpen} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td>{name}</td><td className="mono">{c.line_no}</td><td><span className={`chip ${tone}`}>{label}</span></td>
      <td className="num">{exp}</td><td className="num">{got}</td>
      <td><span className={`chip ${VERDICT[c.verdict][1]}`}>{VERDICT[c.verdict][0]}</span> {c.why && <span className="xs muted">{c.why}</span>}</td>
    </tr>
  );
}

type Q = StoredEval["per_question"][number];
const yn = (b: boolean | null | undefined) => (b === true ? "yes" : b === false ? "no" : null);
function expectedQ(e: Q["expected"]) {
  return [e.expected_state.replaceAll("_", " "), yn(e.expected_bool), e.expected_number, e.expected_text_contains && `“${e.expected_text_contains}”`].filter((x) => x != null && x !== "").join(" · ");
}
function gotQ(g: unknown) {
  if (!g) return <span className="muted">no answer</span>;
  const x = g as { state: string; bool: boolean | null; number: number | null };
  return [x.state.replaceAll("_", " "), yn(x.bool), x.number].filter((v) => v != null).join(" · ");
}
