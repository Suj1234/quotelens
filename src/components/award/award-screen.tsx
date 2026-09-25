"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ScenarioView } from "@/lib/scenarios";
import type { AwardView } from "@/lib/award";
import type { Filter, Rule, SubRule } from "@/lib/scenarios/allocate";
import { inrShort, money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MemoView } from "./memo-view";
import { DiscountLines } from "./discount-lines";

// DESIGN §3.9 Award (both roles) + TRD §14.2 / §17.11 scenario comparison, overrides and the New scenario rule builder (DECISIONS P7: on this tab).
type Opt = { id: string; name: string; price: number };
type Props = {
  rfxId: string; code: string; buyer: boolean; locked: boolean; scenarios: ScenarioView[]; award: AwardView | null;
  options: Record<string, Record<string, Opt[]>>; groupValues: { ply: number[]; item_type: string[]; delivery_location: string[] };
};
const rs = (v: number | null) => (v === null ? "—" : money(Math.round(v)));
const pctOf = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(1)}%`;

async function call(url: string, body?: unknown, method = "POST") {
  try {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(`${j.error ?? "That didn't work."} (${j.code ?? r.status})`); return null; }
    return j;
  } catch { toast.error("Couldn't reach the server — check the connection and try again (NETWORK)"); return null; }
}

export function AwardScreen(p: Props) {
  const router = useRouter();
  const { scenarios, award, buyer, locked } = p;
  const st = award?.status ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pick, setPick] = useState(award?.scenario_id ?? scenarios[0]?.id ?? "");
  const [back, setBack] = useState(false); const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [building, setBuilding] = useState(false);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); const t = setInterval(() => setElapsed(Date.now() - t0), 250); return () => clearInterval(t); }, [busy]);
  const picked = scenarios.find((s) => s.id === pick) ? pick : scenarios[0]?.id ?? "";

  async function run(key: string, url: string, body: unknown, done: string, method = "POST") {
    setBusy(key); setElapsed(0);
    const j = await call(url, body, method);
    setBusy(null);
    if (j) { toast.success(done); router.refresh(); }
    return j;
  }
  const generate = () => run("gen", `/api/award/${p.rfxId}/generate`, { scenario_id: picked }, "Memo generated — Priya can approve");
  const memoFrom = scenarios.find((s) => s.id === award?.scenario_id)?.name ?? award?.memo.scenario.name;

  const lead = st === "approved" || locked ? <><b>Approved.</b> The grid is locked and the memo is on file.</>
    : st === "draft" ? <>Memo drafted from <b>{memoFrom}</b>. {buyer ? "Waiting for Priya's approval." : "Read it and approve, or send it back."}</>
    : st === "sent_back" ? (buyer ? <>Priya sent the memo back. Read the note, adjust the scenario and <b>generate it again</b>.</> : <>You sent the memo back to Sujit. It returns here when Sujit generates it again.</>)
    : !scenarios.length ? (buyer ? <>No scenario saved yet. Save one from an Ask answer, or build one below with <b>New scenario</b>.</> : <>No scenario saved yet. Ask a question on Decide that allocates lines to vendors, then save it as a scenario.</>)
    : buyer ? <>Pick a scenario and generate the memo. Every number in it comes from the grid and the ledger.</>
    : <>Sujit hasn&apos;t drafted the memo yet. Compare the scenarios below; the memo appears here when Sujit generates it.</>;

  const genControls = buyer && !locked && scenarios.length > 0 && (
    <>
      <select className="sel" value={picked} onChange={(e) => setPick(e.target.value)} disabled={!!busy} aria-label="Scenario for the memo" style={{ maxWidth: 280 }}>
        {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <Button variant="default" disabled={!!busy || !picked} onClick={generate}>{busy === "gen" ? `Generating… ${(elapsed / 1000).toFixed(0)} s` : st === "draft" ? "Generate again" : "Generate memo"}</Button>
    </>
  );
  const pdf = award && <Button asChild><a href={award.pdf_url} target="_blank" rel="noreferrer">Download PDF</a></Button>;

  return (
    <div className="page read">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <p className="lead">{lead}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(st === null || st === "sent_back") && genControls}
          {st === "draft" && buyer && <>{pdf}{award?.stale && genControls}<span className="chip amber">Awaiting Priya</span></>}
          {st === "draft" && !buyer && !locked && <>{pdf}<Button onClick={() => { setBack(!back); setConfirm(false); }}>Send back</Button><Button variant="default" disabled={!!award?.stale} onClick={() => { setConfirm(true); setBack(false); }}>Approve</Button></>}
          {(st === "approved" || st === "sent_back") && pdf}
        </div>
      </div>

      {award?.stale && st === "draft" && <div className="lock" style={{ marginTop: 12, color: "var(--amber)" }}>The scenario changed after this memo was drafted — {buyer ? "generate it again so the memo matches." : "Sujit needs to generate it again before you can approve."}</div>}
      {st === "sent_back" && award?.sent_back_note && <div className="card" style={{ marginTop: 12, borderColor: "var(--amber)" }}><div className="bd"><div className="eyebrow">Sent back by {award.sent_back_by ?? "the approver"}{award.sent_back_at ? ` · ${shortDate(award.sent_back_at)}` : ""}</div><p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{award.sent_back_note}</p></div></div>}
      {confirm && (
        <div className="card" style={{ marginTop: 12, padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 240 }}>Approving locks {p.code}: the grid, the review queue and the scenarios become read-only, and the memo is signed with your name.</span>
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
          <b style={{ fontSize: 13 }}>Scenarios{scenarios.length ? ` · ${scenarios.length}` : ""}</b>
          {buyer && !locked && <Button size="sm" onClick={() => setBuilding(!building)}>{building ? "Close" : "New scenario"}</Button>}
        </div>
        {building && <Builder rfxId={p.rfxId} values={p.groupValues} onDone={() => { setBuilding(false); router.refresh(); }} />}
        {scenarios.length === 0 ? (
          <div className="bd"><div className="empty"><b>No scenarios yet.</b> {buyer ? "Ask “cheapest vendor per line among qualified vendors” and use Save as scenario on the answer, or build one with New scenario." : "Save one from an answer on Decide."}</div></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead><tr><th>Scenario</th><th>Rule</th><th className="num">Annual total<div className="hint" style={{ fontWeight: 400 }}>as quoted · after discounts</div></th><th className="num">Vendors</th><th className="num">Lines</th><th className="num">Single-source</th><th className="num">vs first</th><th className="num">vs best single</th><th>Share</th><th /></tr></thead>
              <tbody>
                {scenarios.map((s, j) => (
                  <Fragment key={s.id}>
                    <tr onClick={() => setOpenId(openId === s.id ? null : s.id)} style={{ cursor: "pointer" }} aria-expanded={openId === s.id}>
                      <td><b style={{ fontWeight: 600 }}>{s.name}</b>{award?.scenario_id === s.id && <> <span className="chip green">Selected</span></>}<div className="hint">{s.created_by ?? ""}{s.rule.type === "from_query" ? " · from an answer" : " · by rule"}</div></td>
                      <td className="text-muted-foreground" style={{ fontSize: 12, maxWidth: 260 }}>{s.rule_text}</td>
                      <td className="num mono" title={rs(s.total)}>{inrShort(s.total)}{s.total_after < s.total - 0.5 && <div style={{ color: "var(--green)" }} title={rs(s.total_after)}>{inrShort(s.total_after)}</div>}</td>
                      <td className="num mono">{s.vendor_count}</td>
                      <td className="num mono">{s.allocated}/{s.lines.length}{s.unallocated.length > 0 && <div><span className="chip amber">{s.unallocated.length} unallocated</span></div>}{s.expiring.length > 0 && <div><span className={`chip ${s.expiring.some((e) => e.days_left < 0) ? "red" : "amber"}`} title={s.expiring.map((e) => `${e.vendor}: ${e.days_left < 0 ? "expired" : "valid until"} ${e.until}`).join(" · ")}>{s.expiring.some((e) => e.days_left < 0) ? "Quote expired" : "Quote expiring"}</span></div>}</td>
                      <td className="num mono">{s.single_source_lines}</td>
                      <td className="num mono">{j ? pctOf(s.total_after, scenarios[0].total_after) : "—"}</td>
                      <td className="num mono" title={s.baseline ? `${s.baseline.vendor} ${rs(s.baseline.total)}` : undefined}>{s.baseline ? pctOf(s.total_after, s.baseline.total) : "—"}</td>
                      <td><span className="stack" role="img" aria-label={s.share.map((x) => `${x.vendor} ${x.pct.toFixed(0)}%`).join(", ")}>{s.share.map((x) => <i key={x.vendor} style={{ width: `${x.pct}%` }} title={`${x.vendor} · ${x.lines} lines · ${x.pct.toFixed(1)}%`} />)}</span></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpenId(openId === s.id ? null : s.id); }}>{openId === s.id ? "Hide lines" : "Lines"}</Button>
                        {buyer && !locked && award?.scenario_id !== s.id && <Button size="xs" variant="ghost" disabled={!!busy} onClick={async (e) => { e.stopPropagation(); await run(`del${s.id}`, `/api/scenarios/${s.id}`, undefined, `Deleted — ${s.name}`, "DELETE"); }}>Delete</Button>}
                      </td>
                    </tr>
                    {openId === s.id && <tr><td colSpan={10} style={{ background: "var(--paper)", padding: "12px 14px" }}><Lines s={s} opts={p.options[s.id] ?? {}} canEdit={buyer && !locked} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {award && <MemoView m={award.memo} />}
    </div>
  );
}

/** One scenario's lines (TRD §14.2 / §17.11): winner, price, runner-up, gap, reason; buyer overrides with a reason, or reverts. */
function Lines({ s, opts, canEdit }: { s: ScenarioView; opts: Record<string, Opt[]>; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [vendor, setVendor] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  async function save(line: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    const j = await call(`/api/scenarios/${s.id}/override`, { rfx_line_id: line, ...body });
    setBusy(false);
    if (j) { toast.success(done); setEdit(null); router.refresh(); }
  }
  return (
    <div>
      <div className="small" style={{ fontSize: 12.5, marginBottom: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{s.baseline ? <>Everything to the best single vendor: <b>{s.baseline.vendor}</b> at <span className="mono">{rs(s.baseline.total)}</span>{s.baseline.discount?.met ? <> (<span className="mono">{rs(s.baseline.total_quoted)}</span> quoted, −{s.baseline.discount.pct}% because it wins all its lines)</> : null} · this scenario is <span className="mono">{rs(Math.abs(s.savings_vs_baseline ?? 0))}</span> {(s.savings_vs_baseline ?? 0) >= 0 ? "lower" : "higher"}</> : "No single-vendor baseline."}{s.baseline?.note ? ` ${s.baseline.note}` : ""}</span>
        <span className="text-muted-foreground">{s.share.map((x) => `${x.vendor} ${x.lines} lines · ${x.pct.toFixed(1)}%`).join(" · ")}</span>
      </div>
      {s.expiring.map((e) => <div key={e.vendor} className="note" style={{ marginBottom: 8, borderLeftColor: e.days_left < 0 ? "var(--red)" : "var(--amber)" }}>
        <b>{e.vendor}</b>&apos;s quote {e.days_left < 0 ? <>expired on {shortDate(e.until)}</> : <>is valid only until {shortDate(e.until)} ({e.days_left} {e.days_left === 1 ? "day" : "days"} left)</>} — before this award is approved, ask them to extend it.{" "}
        <a href={`review?vendor=${e.vendor_code}`}>Ask {e.vendor} to extend →</a></div>)}
      {s.discounts.length > 0 && <div style={{ marginBottom: 10 }}><div className="small" style={{ fontSize: 12.5, marginBottom: 4 }}>This scenario: <span className="mono">{rs(s.total)}</span> as quoted{s.total_after < s.total - 0.5 ? <> · <b className="mono">{rs(s.total_after)}</b> after the discounts it earns</> : " · it earns no vendor discount"}</div><DiscountLines discounts={s.discounts} /></div>}
      <table className="t" style={{ background: "var(--surface)" }}>
        <thead><tr><th>#</th><th>Line</th><th>Vendor</th><th className="num">₹/1000</th><th className="num">Annual ₹</th><th>Runner-up</th><th className="num">Gap</th><th>Reason</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {s.lines.map((l) => (
            <Fragment key={l.rfx_line_id}>
              <tr>
                <td className="mono text-muted-foreground">{l.line_no}</td>
                <td>{l.description}</td>
                <td>{l.vendor ?? <span className="chip amber">Unallocated</span>}{l.is_override && <> <span className="chip green">Override</span></>}</td>
                <td className="num mono">{rs(l.price)}</td><td className="num mono">{rs(l.annual_value)}</td>
                <td className="text-muted-foreground">{l.runner_up ? <>{l.runner_up} <span className="mono">{rs(l.runner_up_price)}</span></> : "—"}</td>
                <td className="num mono text-muted-foreground">{l.gap_pct === null ? "—" : `${l.gap_pct.toFixed(2)}%`}</td>
                <td className="text-muted-foreground" style={{ fontSize: 12 }}>{l.reason}</td>
                {canEdit && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {l.is_override
                    ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => save(l.rfx_line_id, { revert: true }, `Override reverted — line ${l.line_no} back to ${l.auto_vendor ?? "the rule's pick"}`)}>Revert</Button>
                    : <Button size="xs" variant="ghost" onClick={() => { setEdit(edit === l.rfx_line_id ? null : l.rfx_line_id); setVendor(""); setReason(""); }}>Override…</Button>}
                </td>}
              </tr>
              {edit === l.rfx_line_id && (
                <tr><td colSpan={9}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
                    <select className="sel" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor for this line">
                      <option value="">Give line {l.line_no} to…</option>
                      {(opts[l.rfx_line_id] ?? []).filter((o) => o.id !== l.vendor_id).map((o) => <option key={o.id} value={o.id}>{o.name} · {rs(o.price)}</option>)}
                    </select>
                    <input className="ta" style={{ flex: 1, minWidth: 220, height: 28 }} placeholder="Reason (goes into the memo), e.g. incumbent tooling" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button size="sm" variant="default" disabled={!vendor || !reason.trim() || busy} onClick={() => save(l.rfx_line_id, { vendor_id: vendor, reason }, `Line ${l.line_no} now goes to ${(opts[l.rfx_line_id] ?? []).find((o) => o.id === vendor)?.name}`)}>{busy ? "Saving…" : "Override"}</Button>
                    <Button size="sm" onClick={() => setEdit(null)}>Cancel</Button>
                    {!(opts[l.rfx_line_id] ?? []).some((o) => o.id !== l.vendor_id) && <span className="hint">No other vendor has an eligible price on this line under this scenario&apos;s rule.</span>}
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
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
