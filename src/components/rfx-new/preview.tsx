"use client";

import type { Draft } from "@/lib/rfx-draft";
import { longDate, todayIST } from "@/lib/format";
import { lineGaps, type LineRules } from "@/lib/line-rules";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Editor, type Edit } from "./editor";

// P9 B15–B17: the RFx as the co-pilot builds it — read-only, one row per part, ✓ when done. The title is the page heading
// (the co-pilot asks for it), so it has no row here. "View" opens the full
// content in a side sheet with an Edit link (the existing editor fields); the chat stays the way to build it.

export type Section = "scope" | "lines" | "terms" | "deadline" | "questionnaire" | "vendors";
const UNIT: Record<string, string> = { per_1000_pcs: "Per 1000 pcs", per_piece: "Per piece", per_kg: "Per kg", per_box: "Per box" };
const INCO: Record<string, string> = { delivered: "Delivered to plant", ex_works: "Ex-works", fob: "FOB" };
const TAX: Record<string, string> = { excl_gst: "Excl. GST", incl_gst: "Incl. GST" };
const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(" · ");

export function sections(d: Draft | null, rules?: LineRules): { key: Section; label: string; done: boolean; summary: string }[] {
  const r = d?.rfx, ls = d?.lines ?? [], qs = d?.questions ?? [], vs = d?.vendors ?? [];
  const incomplete = rules ? new Set(lineGaps(ls, rules).required.flatMap((g) => g.lines)).size : 0;
  return [
    { key: "scope", label: "Scope", done: !!r?.cover_note, summary: r?.cover_note ?? "Not yet" },
    { key: "lines", label: "Line items", done: ls.length > 0 && !incomplete, summary: ls.length ? `${incomplete ? `${incomplete} of ${ls.length} lines missing required fields · ` : ""}${ls.length} lines · ${count(ls.map((l) => l.item_type ?? "untyped"))} · ${count(ls.map((l) => l.delivery_location))}${ls.some((l) => (l.spec_attributes as { draft?: boolean })?.draft) ? " · Some drafted, to confirm" : ""}` : "Not yet" },
    { key: "terms", label: "Terms", done: !!r?.terms_set, summary: r?.terms_set ? `${r.currency} · ${UNIT[r.quote_unit] ?? r.quote_unit} · ${INCO[r.incoterm] ?? r.incoterm}, freight ${r.freight_included_requested ? "included" : "extra"} · ${TAX[r.tax_basis]} · ${r.payment_terms_days}-day payment · ${r.validity_days_requested}-day validity · ${r.contract_months} months${r.delivery_locations.length ? ` · ${r.delivery_locations.join(", ")}` : ""}` : "Not yet" },
    { key: "deadline", label: "Deadline", done: !!r?.response_deadline, summary: r?.response_deadline ? `Quotes due ${longDate(r.response_deadline)}` : "Not yet" },
    { key: "questionnaire", label: "Questionnaire", done: qs.length > 0, summary: qs.length ? `${qs.length} questions · ${qs.filter((q) => q.disqualify_if).length} disqualifying` : "Not yet" },
    { key: "vendors", label: "Vendors", done: vs.length > 0, summary: vs.length ? vs.map((v) => v.name).join(" · ") : "Not yet" },
  ];
}

export function Preview({ draft, rules, changed, onView }: { draft: Draft | null; rules: LineRules; changed: Section[]; onView: (s: Section) => void }) {
  const rows = sections(draft, rules);
  const done = rows.filter((r) => r.done).length;
  return (
    <div className="card pv">
      <div className="hd"><b>RFx preview</b><span className="hint">{done} of {rows.length} ready</span></div>
      {rows.map((r) => (
        <div key={r.key} className={`pv-row${changed.includes(r.key) ? " changed" : ""}`}>
          <span className={`pv-mark${r.done ? " ok" : ""}`} aria-label={r.done ? "done" : "Not yet"}>{r.done ? "✓" : ""}</span>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{r.label}</div>
            <div className={`pv-sum${r.done ? "" : " text-muted-foreground"}`}>{r.summary}</div>
          </div>
          {draft && <Button size="xs" variant="ghost" onClick={() => onView(r.key)}>View</Button>}
        </div>
      ))}
    </div>
  );
}



const PURPOSE: Record<Section, string> = {
  scope: "Opens the email each vendor receives: what you're buying, for which plants, for how long.",
  lines: "What vendors price. They receive these rows as an Excel line sheet.",
  terms: "The basis every vendor quotes on, so the quotes compare like for like.",
  deadline: "The last date for quotes, shown in the email and on the line sheet.",
  questionnaire: "Sent as a PDF. The answers decide who qualifies; a disqualifying answer drops the vendor from totals.",
  vendors: "Who receives the RFx. Each vendor gets their own email and reply address.",
};

/** Side sheet for one part: purpose, the full content read-only, and Edit → the editor fields for that part (Done saves). */
export function SectionSheet({ section, draft, edit, set, editing, setEditing, onDone, onCancel, busy, onClose }: {
  section: Section; draft: Draft; edit: Edit; set: (fn: (e: Edit) => Edit) => void; editing: boolean; setEditing: (b: boolean) => void;
  onDone: () => void; onCancel: () => void; busy: boolean; onClose: () => void;
}) {
  const label = sections(draft).find((s) => s.key === section)!.label;
  const wide = section === "lines";
  const deadlineBad = editing && section === "deadline" && !!edit.header.response_deadline && edit.header.response_deadline <= todayIST();
  const close = () => !busy && (editing ? onCancel() : onClose());
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="sheet ssheet" role="dialog" aria-label={label} style={{ width: wide ? "min(1240px, 100vw)" : "min(600px, 100vw)" }}>
        <div className="hd">
          <div style={{ minWidth: 0 }}><b>{editing ? `Edit ${label.toLowerCase()}` : label}</b><div className="hint" style={{ marginTop: 2 }}>{PURPOSE[section]}</div></div>
          <button type="button" className="xbtn" aria-label="Close" onClick={close}><X size={16} aria-hidden /></button>
        </div>
        <div className="bd">
          {editing ? <Editor edit={edit} set={set} draft={draft} only={section} /> : <View section={section} d={draft} />}
        </div>
        <div className="ft ssheet-ft">
          {editing ? <>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="default" onClick={onDone} disabled={busy || deadlineBad}>{busy ? "Saving…" : section === "terms" && !draft.rfx.terms_set ? "Confirm terms" : "Done"}</Button>
          </> : <>
            <span className="hint" style={{ marginRight: "auto" }}>You can also ask the co-pilot to change this.</span>
            <Button size="sm" variant="default" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden /> Edit</Button>
          </>}
        </div>
      </aside>
    </>
  );
}

const RULE = (r: string) => r === "no" ? "if the answer is No" : r === "yes" ? "if the answer is Yes"
  : r.replace(/^lt:/, "if below ").replace(/^lte:/, "if at most ").replace(/^gt:/, "if above ").replace(/^gte:/, "if at least ");
const daysFrom = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`)) / 864e5);

function View({ section, d }: { section: Section; d: Draft }) {
  const r = d.rfx;
  if (section === "scope") return r.cover_note
    ? <><blockquote className="sv-quote">{r.cover_note}</blockquote><div className="hint">{r.cover_note.trim().split(/\s+/).length} words · appears first in each vendor&apos;s email</div></>
    : <Empty text="No scope paragraph yet. The co-pilot writes one once it knows the items, plants and contract period." />;
  if (section === "deadline") {
    if (!r.response_deadline) return <Empty text="No deadline yet. Tell the co-pilot a date (e.g. “quotes due in two weeks”), or press Edit." />;
    const n = daysFrom(r.response_deadline), dt = new Date(`${r.response_deadline}T00:00:00Z`);
    return (
      <div className="sv-date">
        <div className="big">{dt.getUTCDate()}</div>
        <div><b>{dt.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</b><div className="hint">{dt.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</div></div>
        <span className={`chip ${n > 0 ? "teal" : "red"}`} style={{ marginLeft: "auto" }}>{n > 1 ? `In ${n} days` : n === 1 ? "Tomorrow" : "In the past — change it"}</span>
      </div>
    );
  }
  if (section === "terms") return !r.terms_set ? <Empty text="Not confirmed yet. Ask the co-pilot for your standard terms, or press Edit — it opens with them filled in." /> : (
    <div className="fstack">
      <Group title="Price basis" rows={[["Currency", r.currency], ["Quote unit", UNIT[r.quote_unit] ?? r.quote_unit], ["GST", r.tax_basis === "incl_gst" ? "Included in the price" : "Excluded — vendors state the rate"]]} />
      <Group title="Delivery" rows={[["Basis", INCO[r.incoterm] ?? r.incoterm], ["Freight", r.freight_included_requested ? "Included in the price" : "Quoted separately"], ["Plants", r.delivery_locations.join(", ") || "—"]]} />
      <Group title="Commercial" rows={[["Payment", `${r.payment_terms_days} days from invoice`], ["Quote validity", `${r.validity_days_requested} days`], ["Contract", `${r.contract_months} months`]]} />
    </div>
  );
  if (section === "lines") return !d.lines.length ? <Empty text="No line items yet. Attach last year's line sheet in the chat, or describe the items." /> : (
    <div style={{ overflow: "auto" }}>
      <table className="t" style={{ minWidth: 1000 }}>
        <thead><tr><th>#</th><th>SKU</th><th>Description</th><th>Ply</th><th className="num">L × W × H mm</th><th>GSM</th><th className="num">BF</th><th>Type</th><th className="num">Wt g</th><th className="num">Monthly</th><th>Deliver to</th></tr></thead>
        <tbody>{d.lines.map((l) => (
          <tr key={l.id}>
            <td className="mono text-muted-foreground">{l.line_no}{(l.spec_attributes as { draft?: boolean })?.draft && <div><span className="chip amber">Draft — confirm</span></div>}</td>
            <td className="mono">{l.sku}</td><td>{l.description}</td><td>{l.ply ?? <span className="chip amber">Missing</span>}</td>
            <td className="num mono">{[l.length_mm, l.width_mm, l.height_mm].map((x) => x ?? "—").join(" × ")}</td>
            <td className="mono">{l.gsm_spec ?? <span className="chip amber">Missing</span>}</td><td className="num mono">{l.burst_factor ?? "—"}</td><td>{l.item_type ?? "—"}</td>
            <td className="num mono">{l.weight_per_piece_g ?? <span className="chip grey">—</span>}</td>
            <td className="num mono">{l.monthly_qty ? l.monthly_qty.toLocaleString("en-IN") : <span className="chip amber">Missing</span>}</td><td>{l.delivery_location}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  if (section === "questionnaire") {
    if (!d.questions.length) return <Empty text="No questionnaire yet. Ask the co-pilot for your question library." />;
    const dq = d.questions.filter((q) => q.disqualify_if).length, must = d.questions.filter((q) => q.mandatory).length;
    return (
      <div className="fstack">
        <div className="sv-stats"><span><b>{d.questions.length}</b> questions</span><span><b>{dq}</b> disqualifying</span><span><b>{must}</b> must be answered</span></div>
        {d.questions.map((q) => (
          <div key={q.id} className={`qcard${q.disqualify_if ? " dq" : ""}`}>
            <div className="qtop"><span className="mono qno">Q{q.q_no}</span><div style={{ flex: 1 }}>{q.text}</div></div>
            <div className="qchips">
              <span className="chip grey">{q.answer_type === "yes_no" ? "Yes / No" : q.answer_type === "number" ? "Number" : "Text"}</span>
              {q.mandatory && <span className="chip">Must answer</span>}
              {q.disqualify_if && <span className="chip red">Disqualifies {RULE(q.disqualify_if)}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return !d.vendors.length ? <Empty text="No vendors yet. Ask the co-pilot to invite your approved vendors." /> : (
    <div className="vlist">
      {d.vendors.map((v) => <div key={v.vendor_id} className="vitem"><span className="avatar">{v.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span><div><b>{v.name}</b><div className="hint">{v.city ?? "—"} · <span className="mono">{v.email}</span></div></div></div>)}
    </div>
  );
}

const Group = ({ title, rows }: { title: string; rows: [string, string][] }) => (
  <div className="fgroup"><div className="eyebrow">{title}</div>
    <dl className="sv-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  </div>
);
const Empty = ({ text }: { text: string }) => <div className="empty">{text}</div>;
