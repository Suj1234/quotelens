"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Action, QueueItem } from "@/lib/review";
import type { Evidence } from "@/lib/evidence";
import { countWord, money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Marked } from "@/components/compare/evidence";
import { SyncRepliedButton } from "@/components/comms/sync-inbox";
import { OpenFile } from "@/components/compare/open-file";
import { plain, short, sourceLabel } from "@/lib/review-text";

// DECISIONS 2026-09-25 "Review tab": six plain-language groups, one column per card, no bulk select, no J/K/C.
// "Replies to sort" first: whose reply it is comes before judging its prices.
// P10 B4: bid-leveling's terms — numbers we filled in (plugs) · vendor conditions (qualifications) · not quoted (exclusions).
const GROUPS = ["Replies to sort", "Prices to check", "Not quoted", "Line matching", "Numbers we filled in", "Vendor conditions", "Questionnaire"];
const TYPE_ORDER = ["vendor_mismatch", "unknown_vendor", "not_a_quote", "total_mismatch", "ambiguous_unit", "price_check", "low_confidence_read", "conflict", "prior_pricing", "missing_line", "unmapped_item", "freight_treatment", "discount_treatment", "fx_assumption", "tax_basis", "validity_short", "questionnaire_ambiguous", "questionnaire_missing", "unknown_vendor", "not_a_quote"];
const PRICE_TYPES = ["ambiguous_unit", "low_confidence_read", "conflict"];
const INFO = ["fx_assumption", "discount_treatment", "freight_treatment", "tax_basis", "validity_short", "missing_line"];
// Confidence is shown only where the system can be unsure of a reading (brief: "what does it show the buyer when it isn't sure?").
const SURE_TYPES = ["ambiguous_unit", "low_confidence_read", "conflict", "price_check", "questionnaire_ambiguous"];
const word = (t: string) => t.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
// DESIGN §5: toasts confirm the verb
const DONE: Record<Action, string> = {
  confirm: "Confirmed — cell now counts", override: "Price entered — cell now counts", exclude: "Excluded — logged in the ledger", map: "Moved — grid updated",
  ignore: "Ignored", "ask-vendor": "Sent — logged under vendor communications", "mark-not-quoted": "Treated as not quoted", dismiss: "Closed",
  "accept-yes": "Answer set to Yes", "treat-no": "Answer set to No", "enter-prices": "Prices entered — cells now count", "set-freight": "Freight changed — landed prices updated",
  "set-fx": "Rate changed — this vendor's prices converted again", "set-gst": "GST changed — this vendor's prices restated", "set-discount": "Discount changed — award totals follow it",
  answer: "Answers entered — the questionnaire is scored again", reassign: "Reply moved — processed again for its vendor",
};
type Draft = { to: string; reply_to: string; clar_n: number; subject: string; body: string; items: { id: string; text: string }[] };
type Pending = { total: number; by_vendor: { vendor: string; count: number; clarification: boolean }[] };
// Cards one clarification email covers (src/lib/clarify.ts ASKABLE).
const SLOW: Action[] = ["ask-vendor", "map", "reassign"];
const ASKABLE = ["ambiguous_unit", "price_check", "low_confidence_read", "prior_pricing", "questionnaire_ambiguous", "questionnaire_missing",
  "missing_line", "conflict", "freight_treatment", "fx_assumption", "discount_treatment", "tax_basis", "validity_short", "vendor_mismatch", "vendor_condition", "total_mismatch"];
const andList = (xs: (string | number)[]) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : String(xs[0] ?? "");

export function ReviewQueue({ rfxId, items: served, canAct, locked = false, focus, vendor: initialVendor = "", pending: initialPending }: { rfxId: string; items: QueueItem[]; canAct: boolean; locked?: boolean; focus: string | null; vendor?: string; pending: Pending | null }) {
  const router = useRouter();
  // The server's count, unless this page polled a newer one since (a refresh brings a new server count and wins again).
  const [polled, setPolled] = useState<{ base: Pending | null; v: Pending } | null>(null);
  const pending = polled && polled.base === initialPending ? polled.v : initialPending;
  const [vendor, setVendor] = useState(initialVendor); const [status, setStatus] = useState<"open" | "waiting" | "resolved">("open");
  const [busy, setBusy] = useState<string | null>(null);
  // Decided here, before the refreshed page arrives (~1 s): the card moves to Decided at once; a failed request puts it back.
  const [decided, setDecided] = useState<Record<string, string>>({});
  const items = useMemo(() => served.map((i) => decided[i.id] && (i.status === "open" || i.status === "asked_vendor") ? { ...i, status: decided[i.id] } : i), [served, decided]);
  const [group, setGroup] = useState<"type" | "vendor">("vendor"); // vendor-wise by default (the buyer works one supplier at a time)
  // Three views: Open · Waiting on vendor (asked, no reply yet — still decidable) · Decided.
  const viewOf = (s: string) => (s === "open" ? "open" : s === "asked_vendor" ? "waiting" : "resolved");
  const shown = useMemo(() => items.filter((i) => (!vendor || i.vendor?.code === vendor) && viewOf(i.status) === status), [items, vendor, status]);
  const keyOf = useCallback((i: QueueItem) => (group === "type" ? i.group : i.vendor?.name ?? "Unknown sender"), [group]);
  const inGroup = (a: QueueItem, b: QueueItem) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.vendor?.name ?? "").localeCompare(b.vendor?.name ?? "") || (a.line_no ?? 0) - (b.line_no ?? 0);
  const ordered = useMemo(() => [...shown].sort((a, b) => group === "type"
    ? GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || inGroup(a, b)
    : keyOf(a).localeCompare(keyOf(b)) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || inGroup(a, b)), [shown, group, keyOf]);
  const open = items.filter((i) => i.status === "open");
  const waiting = items.filter((i) => i.status === "asked_vendor");

  const run = useCallback(async (it: QueueItem, action: Action, body: Record<string, unknown> = {}) => {
    // Actions that re-run pipeline stages take seconds, so they keep the busy state instead.
    const quick = !SLOW.includes(action) && it.type !== "vendor_mismatch";
    const undo = () => setDecided((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== it.id)));
    if (quick) setDecided((d) => ({ ...d, [it.id]: "confirmed" })); else setBusy(it.id);
    try {
      const r = await fetch(`/api/review/${it.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { if (quick) undo(); toast.error(`${j.error ?? "That didn't work."} (${j.code ?? r.status})`); return null; }
      if (action !== "ask-vendor") { toast.success(action === "confirm" && INFO.includes(it.type) ? "Accepted — noted in the ledger" : DONE[action]); router.refresh(); }
      return j as { status: string; draft?: Draft };
    } catch { if (quick) undo(); toast.error("Couldn't reach the server — check the connection and try again (NETWORK)"); return null; }
    finally { setBusy(null); }
  }, [router]);

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
  useEffect(() => { if (focus) document.getElementById(`rq-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus]);
  const vendorName = items.find((i) => i.vendor?.code === vendor)?.vendor?.name;

  return (
    <>
      <p className="lead">
        {open.length
          ? <><b>{countWord(open.length)} {open.length === 1 ? "item needs" : "items need"}</b> a decision{waiting.length ? <>, and <b>{waiting.length}</b> {waiting.length === 1 ? "is" : "are"} waiting on a vendor&apos;s reply</> : null}. Each card says what happens if you leave it; nothing it holds back counts in totals until you decide.</>
          : waiting.length ? <><b>{countWord(waiting.length)} {waiting.length === 1 ? "item is" : "items are"} waiting on a vendor&apos;s reply.</b> You can still decide them without waiting; a reply updates them itself.</>
          : <><b>Nothing waits for you.</b> Every item has a decision; the grid counts all reviewed cells.</>}
      </p>
      <div style={{ display: "flex", gap: 8, margin: "14px 0 18px", alignItems: "center", flexWrap: "wrap" }}>
        
        {canAct && replied.map((p) => <SyncRepliedButton key={p.vendor} rfxId={rfxId} vendor={p.vendor} />)}
        <div className="seg" role="group" aria-label="Show">
          <button className={status === "open" ? "on" : ""} onClick={() => setStatus("open")}>Open{open.length ? ` · ${open.length}` : ""}</button>
          <button className={status === "waiting" ? "on" : ""} onClick={() => setStatus("waiting")}>Waiting on vendor{waiting.length ? ` · ${waiting.length}` : ""}</button>
          <button className={status === "resolved" ? "on" : ""} onClick={() => setStatus("resolved")}>Decided</button>
        </div>
        <div className="seg" role="group" aria-label="Group by">
          <button className={group === "vendor" ? "on" : ""} onClick={() => setGroup("vendor")}>By vendor</button>
          <button className={group === "type" ? "on" : ""} onClick={() => setGroup("type")}>By type</button>
        </div>
        {vendor && <span className="chip">Only {vendorName ?? vendor} <button onClick={() => setVendor("")} aria-label="Show all vendors" style={{ marginLeft: 4 }}>×</button></span>}
      </div>
      {asked.map((a) => <div key={a} className="note" style={{ marginBottom: 12 }}>{a}</div>)}
      <div className="rq">
        {groups.map((g) => (
          <section key={g} className="rq">
            <div className="eyebrow rqgroup">{g} · {ordered.filter((i) => keyOf(i) === g).length}</div>
            {ordered.filter((i) => keyOf(i) === g).map((it) => <Card key={it.id} it={it} rfxId={rfxId} askable={items.filter((x) => x.status === "open" && x.vendor?.id === it.vendor?.id && ASKABLE.includes(x.type)).map((x) => x.id)} canAct={canAct} locked={locked} busy={busy === it.id} run={run} />)}
          </section>
        ))}
        {!shown.length && (items.length && !open.length && status === "open"
          ? <div className="empty"><b>The queue is clear.</b> Every item has a decision — switch to Decided to read them.</div>
          : !items.length ? <div className="empty"><b>Nothing to review.</b> Items appear here when a response is processed and something needs your call.</div>
          : <div className="empty"><b>Nothing here.</b> {status === "open" ? "No open items" : status === "waiting" ? "Nothing is waiting on a vendor" : "No decided items"}{vendor ? ` for ${vendorName ?? vendor}` : ""}.</div>)}
      </div>
    </>
  );
}

type Form = "change" | "exclude";
const DISCOUNT_KINDS: [string, string][] = [["all_lines", "if all lines are awarded"], ["min_lines", "if at least N lines are awarded"], ["min_value", "if the award is at least ₹N"], ["payment_days", "if we pay within N days"], ["none", "no condition"]];

/** P10 B1: one card = source on the left; on the right what it is, what happens if you leave it, and the four buttons — Accept · Change · Ask vendor · Exclude — in that order, shown by the four rules. */
function Card({ it, rfxId, askable, canAct, locked, busy, run }: {
  it: QueueItem; rfxId: string; askable: string[]; canAct: boolean; locked: boolean; busy: boolean;
  run: (it: QueueItem, a: Action, body?: Record<string, unknown>) => Promise<{ status: string; draft?: Draft } | null>;
}) {
  const b = it.buttons;
  const pv = it.proposed_value;
  const cur = it.current;
  const [form, setForm] = useState<Form | null>(null);
  const [value, setValue] = useState(it.type === "fx_assumption" ? String(cur?.rate ?? "") : it.type === "tax_basis" ? String(cur?.gst_pct ?? 18) : it.type === "discount_treatment" ? String(cur?.discount?.pct ?? pv ?? "") : pv ? String(Math.round(pv)) : "");
  const [gstDir, setGstDir] = useState<"add" | "remove" | "none">("add");
  const [kind, setKind] = useState(cur?.discount?.kind && cur.discount.kind !== "unclear" ? cur.discount.kind : "all_lines");
  const [n, setN] = useState(String(cur?.discount?.min_lines ?? cur?.discount?.min_value_inr ?? cur?.discount?.payment_days ?? ""));
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState("");
  const [asking, setAsking] = useState(false);
  // Waiting on the vendor is not decided: the card keeps its buttons and says when it was asked.
  const waiting = it.status === "asked_vendor";
  const resolved = it.status !== "open" && !waiting;
  const mapped = it.type === "low_confidence_read" && it.group === "Line matching";
  const vendor = short(it.vendor?.name);

  const acceptLabel = (): string => {
    if (it.conflict) return `Accept — keep “${(it.conflict.earlier.answer ?? "").slice(0, 30)}”`;
    if (b.accept === "mark-not-quoted") return "Accept as not quoted";
    if (b.accept === "dismiss") return it.type === "questionnaire_missing" ? "Accept — leave unanswered" : "Accept — not a quote";
    if (it.type === "price_check") return `Accept ${money(pv, "INR", 0)}`;
    if (mapped) return `Accept line ${it.line_no ?? "?"}`;
    if (PRICE_TYPES.includes(it.type) && pv !== null) return `Accept ${money(pv, "INR", 0)}`;
    if (it.type === "freight_treatment") return `Accept ₹${pv} freight`;
    if (it.type === "missing_line") return `Accept — ${pv ?? "those"} not quoted`;
    if (it.type === "validity_short") return `Accept ${pv ?? ""}-day validity`;
    if (it.type === "fx_assumption") return `Accept rate${cur?.rate ? ` ${cur.rate}` : ""}`;
    if (it.type === "discount_treatment") return "Accept this reading";
    if (it.type === "vendor_mismatch") return `Accept as ${vendor}'s`;
    if (it.type === "total_mismatch") return "Accept the line prices";
    return "Accept";
  };
  const changeLabel: Record<string, string> = { price: "Change price…", prices: "Change — enter prices…", line: mapped ? "Change line…" : "Change — place on a line…", freight: "Change freight…",
    rate: "Change rate…", gst: "Change GST…", discount: "Change discount…", yesno: "Change — answer Yes / No…",
    answers: it.conflict ? "Change — use the other answer…" : it.type === "questionnaire_ambiguous" ? "Change — type the answer…" : "Change — type the answers…", vendor: "Change vendor…" };
  const excludeLabel = b.exclude === "ignore" ? "Exclude item" : b.exclude === "dismiss" ? "Exclude reply" : it.type === "discount_treatment" ? "Exclude discount…" : it.type === "vendor_mismatch" ? "Exclude reply…" : mapped ? "Exclude item…" : "Exclude line…";

  // The note under the title, unless the source panel already says the same thing; model scores stay out of the prose.
  const note = it.type === "freight_treatment" || it.type === "prior_pricing" ? null : (it.proposed_note ?? it.detail)?.replace(/\s*\(p=[\d.]+\)/g, "") ?? null;
  const detail = note && !it.evidence?.text?.includes(note.trim()) ? note : null;
  const sure = SURE_TYPES.includes(it.type) && it.probability !== null && it.probability > 0 && it.probability < 0.95 ? it.probability : null;
  const f = b.change?.form;
  const needN = f === "discount" && kind !== "all_lines" && kind !== "none" && cur?.discount?.kind !== "gross_up";
  const canSave = form === "exclude" ? !!reason.trim()
    : f === "line" || f === "vendor" ? !!pick
    : f === "yesno" ? false
    : f === "prices" ? !!reason.trim() && Object.values(prices).some((v) => Number(v) > 0)
    : f === "answers" ? !!reason.trim() && Object.values(answers).some((v) => v.trim())
    : f === "gst" ? !!reason.trim() && (gstDir === "none" || Number(value) > 0)
    : !!reason.trim() && value.trim() !== "" && Number(value) >= (f === "price" || f === "rate" ? 0.0001 : 0) && (!needN || Number(n) > 0);
  const save = async () => {
    if (form === "exclude") { if (await run(it, b.exclude!, { reason })) setForm(null); return; }
    const a = b.change!.actions[0];
    const body = f === "line" ? { line_id: pick } : f === "vendor" ? { vendor_id: pick }
      : f === "prices" ? { reason, prices: Object.fromEntries(Object.entries(prices).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) }
      : f === "answers" ? { reason, answers }
      : f === "gst" ? { reason, value: gstDir === "none" ? 0 : gstDir === "add" ? Number(value) : -Number(value) }
      : f === "discount" ? { reason, value: Number(value), kind, min_lines: kind === "min_lines" ? Number(n) : null, min_value_inr: kind === "min_value" ? Number(n) : null, payment_days: kind === "payment_days" ? Number(n) : null }
      : { value: Number(value), reason };
    if (await run(it, a, body)) setForm(null);
  };
  const direct = async (a: Action) => { await run(it, a); };

  return (
    <div className={`rqcard${resolved ? " resolved" : ""}${it.evidence ? "" : " noev"}`} id={`rq-${it.id}`}>
      {/* Left: where the system read it. Right: what it means and your call (the layout the buyer preferred). */}
      <Source ev={it.evidence} />
      <div className="rqmain">
      <div className="rqmeta">{[it.vendor?.name ?? "Unknown sender", it.line_no && !it.title.match(/^(Line|Item)s?\s/i) ? `Line ${it.line_no}` : null].filter(Boolean).join(" · ")}
        {it.grade && <span className={`chip ${it.grade === "D" ? "amber" : "grey"}`} style={{ marginLeft: 8 }} title="A vendor-stated · B our spec or an official rate · C entered by the buyer · D a default or the AI's inference">Reliability {it.grade}</span>}
        {resolved && <span className="chip green" style={{ marginLeft: 8 }}>{word(it.status)}</span>}
        {waiting && <span className="chip amber" style={{ marginLeft: 8 }}>Asked{it.resolution?.at ? ` ${shortDate(it.resolution.at)}` : ""} — waiting for reply</span>}</div>
      <div className="ttl">{it.title}</div>
      {detail && <div className="rqdetail">{detail}</div>}
      {!resolved && it.if_nothing && <div className="rqnothing"><b>If you do nothing:</b> {it.if_nothing}</div>}
      {(sure !== null || (pv !== null && PRICE_TYPES.includes(it.type) && !mapped)) && (
        <div className="prop">
          {pv !== null && PRICE_TYPES.includes(it.type) && !mapped && <span>Proposed <span className="v">{money(pv, "INR", 0)}</span> <span className="text-muted-foreground" style={{ fontSize: 11 }}>per 1000</span></span>}
          {sure !== null && <span className="text-muted-foreground" style={{ fontSize: 12 }}><span className="pbar"><i style={{ width: `${Math.round(sure * 100)}%` }} /></span> System is {Math.round(sure * 100)}% sure of this reading</span>}
        </div>
      )}
      {resolved && it.resolution && <div className="hint">{[it.resolution.value !== undefined && ["ambiguous_unit", "low_confidence_read", "conflict", "price_check"].includes(it.type) ? money(it.resolution.value, "INR", 0) : null, it.resolution.note, it.resolution.by && `by ${it.resolution.by}`].filter(Boolean).join(" · ")}</div>}

      {!resolved && canAct && !form && !asking && (
        <div className="acts four">
          {b.accept && <Button size="sm" variant="default" disabled={busy} onClick={() => direct(b.accept!)}>{acceptLabel()}</Button>}
          {b.change && <Button size="sm" variant={b.accept ? "outline" : "default"} disabled={busy} onClick={() => setForm("change")}>{changeLabel[b.change.form]}</Button>}
          {b.ask && it.vendor && <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(true)}>Ask {vendor}…</Button>}
          {b.exclude && <Button size="sm" variant="outline" disabled={busy} onClick={() => (b.exclude === "exclude" ? setForm("exclude") : direct(b.exclude!))}>{excludeLabel}</Button>}
        </div>
      )}
      {!resolved && canAct && !it.vendor && it.type !== "unknown_vendor" && it.type !== "not_a_quote" && <div className="hint">Assign this reply to a vendor first (its “Unknown sender” card, under Replies to sort); then this card can be decided.</div>}
      {!resolved && !canAct && <div className="hint">{locked ? "Read-only — the RFx is awarded." : "Waiting for Sujit."}</div>}

      {form && (
        <div className="rqform">
          {form === "change" && f === "prices" && (
            <div className="rqprices">
              {(it.prior_lines ?? []).map((l) => (
                <label key={l.line_no}><span className="mono">L{l.line_no}</span><span className="d">{l.description}</span>
                  <input className="mono inp" inputMode="decimal" placeholder="₹ per 1000" value={prices[l.line_no] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [l.line_no]: e.target.value }))} aria-label={`Line ${l.line_no} price per 1000 pcs`} /></label>
              ))}
              <div className="hint">Lines left blank stay not quoted.</div>
            </div>
          )}
          {form === "change" && f === "answers" && it.conflict && it.missing_questions?.[0] && (
            <div className="acts" style={{ marginTop: 0 }}>
              {[it.conflict.earlier, it.conflict.other].filter((x) => x.answer).map((x, k) => (
                <Button key={k} size="sm" variant="outline" onClick={() => { setAnswers({ [it.missing_questions![0].q_no]: x.answer! }); if (!reason) setReason(`Answer from ${x.from ?? (k ? "the later reply" : "the earlier reply")}`); }}>Use “{x.answer!.slice(0, 40)}”</Button>
              ))}
              <span className="hint">or type the answer below</span>
            </div>
          )}
          {form === "change" && f === "answers" && (
            <div className="rqprices">
              {(it.missing_questions ?? []).map((q) => (
                <label key={q.q_no}><span className="mono">Q{q.q_no}</span><span className="d" title={q.text}>{q.text}</span>
                  {q.answer_type === "yes_no"
                    ? <select className="sel" value={answers[q.q_no] ?? ""} onChange={(e) => setAnswers((x) => ({ ...x, [q.q_no]: e.target.value }))} aria-label={`Q${q.q_no} answer`}><option value="">—</option><option value="Yes">Yes</option><option value="No">No</option></select>
                    : <input className="inp" value={answers[q.q_no] ?? ""} onChange={(e) => setAnswers((x) => ({ ...x, [q.q_no]: e.target.value }))} aria-label={`Q${q.q_no} answer`} />}</label>
              ))}
            </div>
          )}
          {form === "change" && f === "yesno" ? (
            <div className="acts" style={{ marginTop: 0 }}>
              <Button size="sm" variant="default" disabled={busy} onClick={async () => { if (await run(it, "accept-yes")) setForm(null); }}>Answer is Yes</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => { if (await run(it, "treat-no")) setForm(null); }}>Answer is No</Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          ) : (
          <div className="acts" style={{ marginTop: 0 }}>
            {form === "change" && (f === "price" || f === "freight" || f === "rate") && <input className="mono inp" style={{ width: 150 }} inputMode="decimal"
              placeholder={f === "freight" ? "₹ per 1000 (0 = incl.)" : f === "rate" ? "₹ per unit" : "₹ per 1000"} value={value} onChange={(e) => setValue(e.target.value)} aria-label={f === "rate" ? "Exchange rate" : f === "freight" ? "Freight per 1000 pcs" : "Price per 1000 pcs"} />}
            {form === "change" && f === "gst" && <>
              <select className="sel" value={gstDir} onChange={(e) => setGstDir(e.target.value as typeof gstDir)} aria-label="GST"><option value="add">Add GST to their prices</option><option value="remove">Take GST out of their prices</option><option value="none">Compare as written</option></select>
              {gstDir !== "none" && <input className="mono inp" style={{ width: 70 }} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="GST %" />}{gstDir !== "none" && <span className="hint">%</span>}
            </>}
            {form === "change" && f === "discount" && <>
              <input className="mono inp" style={{ width: 70 }} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Discount %" /><span className="hint">%</span>
              {cur?.discount?.kind !== "gross_up" && <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Condition">{DISCOUNT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
              {needN && <input className="mono inp" style={{ width: 110 }} inputMode="decimal" placeholder="N" value={n} onChange={(e) => setN(e.target.value)} aria-label="Condition number" />}
            </>}
            {form === "change" && f === "line" && <select className="sel" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="RFx line"><option value="">Pick a line…</option>
              {it.candidates?.some((c) => c.likely) && <optgroup label="Likely">{it.candidates.filter((c) => c.likely).map((c) => <option key={c.line_id} value={c.line_id}>L{c.line_no} {c.description}</option>)}</optgroup>}
              <optgroup label="All lines">{it.candidates?.filter((c) => !c.likely).map((c) => <option key={c.line_id} value={c.line_id}>L{c.line_no} {c.description}</option>)}</optgroup></select>}
            {form === "change" && f === "vendor" && <select className="sel" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Vendor"><option value="">Pick the vendor it came from…</option>
              {it.vendor_options?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
            {!(form === "change" && (f === "line" || f === "vendor")) && <input className="inp" style={{ flex: 1, minWidth: 220 }} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"
              placeholder={f === "prices" || f === "answers" ? "Where is this from? e.g. last year's PO, a call on 25 Sep (goes in the ledger)" : "Reason (goes in the ledger)"} />}
            <Button size="sm" variant="default" disabled={busy || !canSave} onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>)}
        </div>
      )}
      {asking && it.vendor && <ClarifyBlock rfxId={rfxId} vendor={it.vendor} itemIds={[...new Set([it.id, ...askable])]} onDone={() => setAsking(false)} />}
      </div>
    </div>
  );
}

/** Where the system read this: text as a plain quote (no parser markers), photos and PDF pages as they are. */
function Source({ ev }: { ev: Evidence | null }) {
  if (!ev) return null;
  return (
    <div className="rqsrc">
      <div className="h"><span>{sourceLabel(ev.caption)}</span>{ev.open_url && <OpenFile url={ev.open_url} name={ev.open_name ?? ev.caption.split(" · ")[0]} />}</div>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL, nothing to optimise */}
      {ev.kind === "image" && ev.url && <img src={ev.url} alt={ev.caption} />}
      {ev.kind === "pdf" && ev.url && <iframe src={ev.url} title={ev.caption} />}
      {ev.text && <blockquote><Marked text={plain(ev.text)} mark={ev.mark ? plain(ev.mark) : undefined} /></blockquote>}
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
