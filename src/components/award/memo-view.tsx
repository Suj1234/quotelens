import { Fragment } from "react";
import type { MemoData } from "@/lib/award/memo";
import { longDate, money } from "@/lib/format";

// DESIGN §2.16 memo on the page — the same memo_json the PDF is rendered from (TRD §14.3's six parts).
const rs = (v: number | null) => (v === null ? "—" : money(Math.round(v)));
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const STATE: Record<string, string> = { low_confidence: "low-confidence read", ambiguous: "ambiguous unit", references_prior: "prior pricing", conflict: "conflict" };
const Paras = ({ text }: { text: string }) => <>{text.split(/\n+/).filter(Boolean).map((t, i) => <p key={i}>{t}</p>)}</>;

export function MemoView({ m }: { m: MemoData }) {
  const t = m.totals;
  return (
    <div className="memo">
      <div className="eyebrow">Meridian Foods Pvt Ltd · Procurement</div>
      <h1>Award recommendation — RFx {m.rfx.code}</h1>
      <div className="text-muted-foreground">{m.rfx.title} · prepared by {m.prepared.name} on {longDate(m.prepared.at)} · {m.approved ? `approved by ${m.approved.name} on ${longDate(m.approved.at)}` : "awaiting approval"}</div>

      <h2>Recommendation</h2>
      <Paras text={m.narrative.recommendation} />
      <h2>Basis of award</h2>
      <Paras text={m.narrative.basis_of_award} />
      <p>Scenario “{m.scenario.name}”: {m.scenario.rule_text}. Prices are ₹ per 1000 pieces on {m.scenario.price_basis === "landed" ? "landed cost" : "unit price"}.</p>

      <h2>Allocation</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>#</th><th>Line</th><th className="num">Annual qty</th><th>Vendor</th><th className="num">₹/1000</th><th className="num">Annual ₹</th><th>Runner-up</th><th className="num">Gap</th><th>Reason</th></tr></thead>
          <tbody>
            {m.allocation.map((a) => (
              <tr key={a.line_no}>
                <td className="mono text-muted-foreground">{a.line_no}</td><td>{a.description}</td><td className="num mono">{a.annual_qty.toLocaleString("en-IN")}</td>
                <td>{a.vendor ?? <span className="chip amber">unallocated</span>}{a.is_override && <> <span className="chip green">override</span></>}</td>
                <td className="num mono">{rs(a.price)}</td><td className="num mono">{rs(a.annual_value)}</td>
                <td className="text-muted-foreground">{a.runner_up ? `${a.runner_up} ${rs(a.runner_up_price)}` : "—"}</td><td className="num mono text-muted-foreground">{pct(a.gap_pct)}</td>
                <td className="text-muted-foreground" style={{ fontSize: 12 }}>{a.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Totals and baseline</h2>
      <dl className="kv">
        <dt>Annual total</dt><dd className="mono">{rs(t.total)} <span className="text-muted-foreground" style={{ fontFamily: "var(--font-sans)" }}>for {t.allocated} of {t.lines} lines</span></dd>
        {t.vendors.map((v) => <Fragment key={v.name}><dt>{v.name}</dt><dd>{v.lines} lines · <span className="mono">{rs(v.value)}</span> · {v.pct.toFixed(1)}%</dd></Fragment>)}
        <dt>Best single vendor</dt><dd>{m.baseline ? <>{m.baseline.vendor} at <span className="mono">{rs(m.baseline.total)}</span>{m.baseline.note ? ` — ${m.baseline.note}` : ""}</> : "none"}</dd>
        <dt>Saving against it</dt><dd>{m.savings === null ? "—" : <><span className="mono">{rs(m.savings)}</span> a year ({pct(m.savings_pct)})</>}</dd>
        <dt>Unallocated lines</dt><dd>{t.unallocated.length ? t.unallocated.join(", ") : "none"}</dd>
        <dt>Single-source lines</dt><dd>{t.single_source.length ? t.single_source.join(", ") : "none"}</dd>
      </dl>
      <h2>Exclusions</h2>
      {m.exclusions.length ? m.exclusions.map((e, i) => <p key={i}>{e.vendor} — {e.reason}.</p>) : <p>None.</p>}
      <h2>Validity</h2>
      {m.validity.map((v) => <p key={v.vendor}>{v.vendor}: {v.days !== null ? `${v.days} days` : "not stated"}{v.until ? `, until ${longDate(v.until)}` : ""}{v.short && <> <span className="chip amber">shorter than asked</span></>}</p>)}

      <h2>Assumptions applied</h2>
      <Paras text={m.narrative.key_assumptions} />
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table className="t">
          <thead><tr><th>Kind</th><th>Vendor</th><th>Lines</th><th>Assumption</th><th>Basis</th><th>By</th></tr></thead>
          <tbody>{m.ledger.map((l, i) => <tr key={i}><td className="mono" style={{ fontSize: 11.5 }}>{l.kind}</td><td>{l.vendor}</td><td className="mono">{l.lines}</td><td>{l.description}</td><td className="text-muted-foreground">{l.basis}</td><td className="text-muted-foreground">{l.by}</td></tr>)}</tbody>
        </table>
      </div>

      <h2>Open items</h2>
      <Paras text={m.narrative.exclusions_and_risks} />
      {m.open_items.unresolved.length > 0 && <p>{m.open_items.unresolved.length} unresolved cells · {rs(m.open_items.at_stake_total)} a year at stake at the system&apos;s best guess: {m.open_items.unresolved.map((u) => `line ${u.line_no} ${u.vendor} (${STATE[u.state] ?? u.state}${u.at_stake !== null ? `, ${rs(u.at_stake)}` : ""})`).join("; ")}.</p>}
      <p>Manual overrides: {m.open_items.overrides.length ? m.open_items.overrides.map((o) => `line ${o.line_no} → ${o.vendor}${o.instead_of ? ` instead of ${o.instead_of}` : ""} (${o.reason})`).join("; ") : "none"}.</p>
      <h2>Next steps</h2>
      <Paras text={m.narrative.next_steps} />

      <h2>How the allocation was made</h2>
      <p>{m.scenario.rule_text}.{m.scenario.question ? " Saved from an Ask answer; the query below chose the winners, and every price, runner-up and total was recomputed from the comparison." : " A fixed rule over the comparison grid."}</p>
      {m.scenario.sql && <pre>{m.scenario.sql}</pre>}
      {m.narrative_unverified.length > 0 && <p style={{ color: "var(--amber)" }}>Numbers in the narrative not found in the data: {m.narrative_unverified.join(", ")}.</p>}
      <div className="sig">
        <div>Prepared — {m.prepared.name}, {m.prepared.title}</div>
        <div>Approved — {m.approved ? `${m.approved.name}, ${m.approved.title}` : "________________"}</div>
      </div>
    </div>
  );
}
