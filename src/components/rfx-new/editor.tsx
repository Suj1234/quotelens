"use client";

import { useState } from "react";
import type { Draft, DraftVendor } from "@/lib/rfx-draft";
import { addDays, longDate, todayIST } from "@/lib/format";
import { Button } from "@/components/ui/button";

// DESIGN §3.3 editor card: Lines [n] · Terms · Questionnaire [n] · Vendors [n]. Since P9 it opens one section at a time
// (`only`) from the preview's side sheet, saved by that sheet's Done.
export type EditLine = {
  sku: string; description: string; ply: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null;
  gsm_spec: string; burst_factor: number | null; item_type: string; weight_per_piece_g: number | null;
  monthly_qty: number | null; annual_qty: number | null; delivery_location: string; draft: boolean;
};
export type EditQuestion = { text: string; answer_type: "yes_no" | "number" | "text"; mandatory: boolean; disqualify_if: string };
export type Header = Draft["rfx"];
export type Edit = { header: Header; lines: EditLine[]; questions: EditQuestion[]; vendors: DraftVendor[]; newVendors: { name: string; email: string }[] };

export function toEdit(d: Draft): Edit {
  return {
    header: d.rfx,
    lines: d.lines.map((l) => ({
      sku: l.sku, description: l.description, ply: l.ply, length_mm: l.length_mm, width_mm: l.width_mm, height_mm: l.height_mm,
      gsm_spec: l.gsm_spec ?? "", burst_factor: l.burst_factor, item_type: l.item_type ?? "", weight_per_piece_g: l.weight_per_piece_g,
      monthly_qty: l.monthly_qty, annual_qty: l.annual_qty, delivery_location: l.delivery_location, draft: !!(l.spec_attributes as { draft?: boolean })?.draft,
    })),
    questions: d.questions.map((q) => ({ text: q.text, answer_type: q.answer_type, mandatory: q.mandatory, disqualify_if: q.disqualify_if ?? "" })),
    vendors: d.vendors, newVendors: [],
  };
}

const n = (v: string) => (v.trim() === "" ? null : Number(v));
const Num = ({ v, on, w = 64 }: { v: number | null; on: (x: number | null) => void; w?: number }) =>
  <input className="inp mono" style={{ width: w, textAlign: "right" }} inputMode="decimal" value={v ?? ""} onChange={(e) => on(n(e.target.value))} />;
const Txt = ({ v, on, w, mono }: { v: string; on: (x: string) => void; w?: number | string; mono?: boolean }) =>
  <input className={`inp${mono ? " mono" : ""}`} style={{ width: w ?? "100%" }} value={v} onChange={(e) => on(e.target.value)} />;

type Tab = "lines" | "terms" | "questionnaire" | "vendors";

export function Editor({ edit, set, draft, sourceFile, onAttach, only }: {
  edit: Edit; set: (fn: (e: Edit) => Edit) => void; draft: Draft | null; sourceFile?: string | null; onAttach?: () => void; only?: Tab | "scope" | "deadline";
}) {
  const [picked, setTab] = useState<Tab>("lines");
  // The preview opens scope, deadline and commercial terms as separate sheets; all three live in the Terms tab.
  const tab: Tab = only === "scope" || only === "deadline" ? "terms" : only ?? picked;
  const part = only === "scope" || only === "deadline" || only === "terms" ? only : "all";
  const [pick, setPick] = useState("");
  const [nv, setNv] = useState({ name: "", email: "" });
  const h = edit.header;
  const setH = (p: Partial<Header>) => set((e) => ({ ...e, header: { ...e.header, ...p } }));
  const setLine = (i: number, p: Partial<EditLine>) => set((e) => ({ ...e, lines: e.lines.map((l, j) => (j === i ? { ...l, ...p, draft: false } : l)) }));
  const setQ = (i: number, p: Partial<EditQuestion>) => set((e) => ({ ...e, questions: e.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const vendorCount = edit.vendors.length + edit.newVendors.length;
  const book = (draft?.addressBook ?? []).filter((b) => !edit.vendors.some((v) => v.vendor_id === b.vendor_id));

  return (
    <div className={only ? "" : "card"} style={{ display: "flex", flexDirection: "column", minHeight: only ? 0 : 520, minWidth: 0 }}>
      {!only && <div className="tabs" style={{ padding: "0 12px" }}>
        {([["lines", "Lines", edit.lines.length], ["terms", "Terms", null], ["questionnaire", "Questionnaire", edit.questions.length], ["vendors", "Vendors", vendorCount]] as const).map(([k, label, count]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}{count !== null && <> <span className="mono text-muted-foreground">{count}</span></>}</button>
        ))}
      </div>}

      {tab === "lines" && (edit.lines.length === 0 ? (
        <div className="bd" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="empty" style={{ maxWidth: 420 }}>
            <b>No lines yet.</b>
            <div className="small" style={{ marginTop: 6, fontSize: 12 }}>Attach last year&apos;s sheet (xlsx/csv) or paste rows in the co-pilot. Lines are never invented — you confirm every one.</div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
              {onAttach && <Button size="sm" onClick={onAttach}>Attach last year&apos;s sheet</Button>}
              <Button size="sm" variant="ghost" onClick={() => set((e) => ({ ...e, lines: [blankLine(h.delivery_locations[0])] }))}>Add a line by hand</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ overflow: "auto", maxHeight: 560 }}>
            <table className="t" style={{ minWidth: 1180 }}>
              <thead><tr><th>#</th><th>SKU</th><th>Description</th><th>Ply</th><th className="num">L</th><th className="num">W</th><th className="num">H</th><th>GSM</th><th className="num">BF</th><th>Type</th><th className="num">Wt g</th><th className="num">Monthly</th><th className="num">Annual</th><th>Deliver to</th><th /></tr></thead>
              <tbody>
                {edit.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="mono text-muted-foreground">{i + 1}{l.draft && <div><button className="chip amber" title="Drafted from your description — click to confirm" onClick={() => setLine(i, {})}>Draft — confirm</button></div>}</td>
                    <td><Txt v={l.sku} on={(sku) => setLine(i, { sku })} w={118} mono /></td>
                    <td><Txt v={l.description} on={(description) => setLine(i, { description })} w={230} /></td>
                    <td><Num v={l.ply} on={(ply) => setLine(i, { ply })} w={40} /></td>
                    <td><Num v={l.length_mm} on={(length_mm) => setLine(i, { length_mm })} w={54} /></td>
                    <td><Num v={l.width_mm} on={(width_mm) => setLine(i, { width_mm })} w={54} /></td>
                    <td><Num v={l.height_mm} on={(height_mm) => setLine(i, { height_mm })} w={54} /></td>
                    <td><Txt v={l.gsm_spec} on={(gsm_spec) => setLine(i, { gsm_spec })} w={128} mono /></td>
                    <td><Num v={l.burst_factor} on={(burst_factor) => setLine(i, { burst_factor })} w={42} /></td>
                    <td><select className="sel" value={l.item_type} onChange={(e) => setLine(i, { item_type: e.target.value })}>{["", "box", "sheet", "partition", "other"].map((t) => <option key={t} value={t}>{t ? t[0].toUpperCase() + t.slice(1) : "—"}</option>)}</select></td>
                    <td><Num v={l.weight_per_piece_g} on={(weight_per_piece_g) => setLine(i, { weight_per_piece_g })} w={62} /></td>
                    <td><Num v={l.monthly_qty} w={70} on={(monthly_qty) => setLine(i, { monthly_qty, annual_qty: l.annual_qty === null || l.annual_qty === (l.monthly_qty ?? 0) * 12 ? (monthly_qty ?? 0) * 12 : l.annual_qty })} /></td>
                    <td><Num v={l.annual_qty} on={(annual_qty) => setLine(i, { annual_qty })} w={80} /></td>
                    <td><Txt v={l.delivery_location} on={(delivery_location) => setLine(i, { delivery_location })} w={104} /></td>
                    <td><Button size="xs" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => set((e) => ({ ...e, lines: e.lines.filter((_, j) => j !== i) }))}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--hair2)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="hint">{sourceFile ? <>Parsed from <span className="mono">{sourceFile}</span></> : "Entered by hand"} · edit inline · weight per piece converts per-kg quotes later · annual = monthly × 12 unless you change it</span>
            <Button size="sm" variant="ghost" onClick={() => set((e) => ({ ...e, lines: [...e.lines, blankLine(h.delivery_locations[0])] }))}>Add line</Button>
          </div>
        </>
      ))}

      {tab === "terms" && part === "scope" && (
        <div className="bd fstack">
          <label className="flabel" htmlFor="scope-ta">Scope paragraph</label>
          <textarea id="scope-ta" className="ta" style={{ minHeight: 200, lineHeight: 1.6 }} value={h.cover_note ?? ""} onChange={(e) => setH({ cover_note: e.target.value || null })} />
          <div className="fnote"><span>Opens the email each vendor receives. Say what is bought, for which plants and for how long; the terms and lines are sent separately.</span><span className="mono">{(h.cover_note ?? "").trim().split(/\s+/).filter(Boolean).length} words</span></div>
        </div>
      )}

      {tab === "terms" && part === "deadline" && (
        <div className="bd fstack">
          <label className="flabel" htmlFor="deadline-in">Quotes due by</label>
          <input id="deadline-in" type="date" className="inp mono" style={{ width: 200 }} min={addDays(todayIST(), 1)} value={h.response_deadline ?? ""} onChange={(e) => setH({ response_deadline: e.target.value || null })} />
          {h.response_deadline && h.response_deadline <= todayIST() && <div className="ferr">The deadline must be after today. Pick a later date.</div>}
          <div className="fquick">{[7, 14, 21].map((n) => <button key={n} type="button" onClick={() => setH({ response_deadline: addDays(todayIST(), n) })}>In {n / 7} week{n > 7 ? "s" : ""} · {longDate(addDays(todayIST(), n))}</button>)}</div>
          <div className="fnote"><span>Vendors see this date in the email and on the line sheet. Quotes that arrive later are still read, and marked late.</span></div>
        </div>
      )}

      {tab === "terms" && (part === "terms" || part === "all") && (
        <div className="bd fstack">
          {part === "all" && <dl className="kv terms-form"><dt>Title</dt><dd><Txt v={h.title} on={(title) => setH({ title })} /></dd></dl>}
          <div className="fgroup"><div className="eyebrow">Price basis</div>
            <dl className="kv terms-form">
              <dt>Currency</dt><dd><Txt v={h.currency} on={(currency) => setH({ currency: currency.toUpperCase().slice(0, 3), terms_set: true })} w={80} mono /></dd>
              <dt>Quote unit</dt><dd><select className="sel" value={h.quote_unit} onChange={(e) => setH({ quote_unit: e.target.value, terms_set: true })}>{[["per_1000_pcs", "Per 1000 pieces"], ["per_piece", "Per piece"], ["per_kg", "Per kg"], ["per_box", "Per box"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></dd>
              <dt>GST</dt><dd><select className="sel" value={h.tax_basis} onChange={(e) => setH({ tax_basis: e.target.value as Header["tax_basis"], terms_set: true })}><option value="excl_gst">Prices exclude GST (vendor states the rate)</option><option value="incl_gst">Prices include GST</option></select></dd>
            </dl>
          </div>
          <div className="fgroup"><div className="eyebrow">Delivery</div>
            <dl className="kv terms-form">
              <dt>Basis</dt><dd><select className="sel" value={h.incoterm} onChange={(e) => setH({ incoterm: e.target.value, terms_set: true })}>{[["delivered", "Delivered to plant"], ["ex_works", "Ex-works"], ["fob", "FOB"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></dd>
              <dt>Freight</dt><dd><label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={h.freight_included_requested} onChange={(e) => setH({ freight_included_requested: e.target.checked, terms_set: true })} /> Included in the price</label></dd>
              <dt>Plants</dt><dd><Txt v={h.delivery_locations.join(", ")} on={(v) => setH({ delivery_locations: v.split(",").map((x) => x.trim()).filter(Boolean), terms_set: true })} /><div className="hint" style={{ marginTop: 4 }}>Separate plants with commas.</div></dd>
            </dl>
          </div>
          <div className="fgroup"><div className="eyebrow">Commercial</div>
            <dl className="kv terms-form">
              <dt>Payment</dt><dd className="unit"><Num v={h.payment_terms_days} on={(v) => setH({ payment_terms_days: v ?? 0, terms_set: true })} w={80} /> days from invoice</dd>
              <dt>Quote validity</dt><dd className="unit"><Num v={h.validity_days_requested} on={(v) => setH({ validity_days_requested: v ?? 0, terms_set: true })} w={80} /> days</dd>
              <dt>Contract</dt><dd className="unit"><Num v={h.contract_months} on={(v) => setH({ contract_months: v ?? 0, terms_set: true })} w={80} /> months</dd>
            </dl>
          </div>
          {part === "all" && <dl className="kv terms-form">
            <dt>Response deadline</dt><dd><input type="date" className="inp mono" min={addDays(todayIST(), 1)} value={h.response_deadline ?? ""} onChange={(e) => setH({ response_deadline: e.target.value || null })} /></dd>
            <dt>Scope paragraph</dt><dd><textarea className="ta" style={{ minHeight: 90 }} value={h.cover_note ?? ""} onChange={(e) => setH({ cover_note: e.target.value || null })} /></dd>
          </dl>}
          {!h.terms_set && <div className="fnote"><span>Not confirmed yet. These are your standard terms for this category (Settings → Masters). Press Done to confirm them, or change any field first.</span></div>}
        </div>
      )}

      {tab === "questionnaire" && (
        <div className="bd fstack">
          {edit.questions.length === 0 && <div className="empty"><b>No questionnaire yet.</b><div style={{ fontSize: 12, marginTop: 6 }}>Ask the co-pilot for your question library, or add questions here.</div></div>}
          {edit.questions.map((q, i) => (
            <div key={i} className={`qcard${q.disqualify_if ? " dq" : ""}`}>
              <div className="qtop">
                <span className="mono qno">Q{i + 1}</span>
                <textarea className="ta" rows={2} value={q.text} placeholder="Question for the vendor" aria-label={`Question ${i + 1}`} onChange={(e) => setQ(i, { text: e.target.value })} />
                <button type="button" className="qdel" aria-label={`Remove question ${i + 1}`} onClick={() => set((e) => ({ ...e, questions: e.questions.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
              <div className="qctl">
                <label>Answer <select className="sel" value={q.answer_type} onChange={(e) => setQ(i, { answer_type: e.target.value as EditQuestion["answer_type"], disqualify_if: "" })}><option value="yes_no">Yes / No</option><option value="number">Number</option><option value="text">Text</option></select></label>
                <label><input type="checkbox" checked={q.mandatory} onChange={(e) => setQ(i, { mandatory: e.target.checked })} /> Must answer</label>
                <RuleInput type={q.answer_type} rule={q.disqualify_if} on={(disqualify_if) => setQ(i, { disqualify_if })} />
              </div>
            </div>
          ))}
          <div className="fnote">
            <span>Sent to every vendor as a PDF. A disqualifying answer takes the vendor out of totals and best prices.</span>
            <Button size="sm" variant="ghost" onClick={() => set((e) => ({ ...e, questions: [...e.questions, { text: "", answer_type: "yes_no", mandatory: true, disqualify_if: "" }] }))}>Add question</Button>
          </div>
        </div>
      )}

      {tab === "vendors" && (
        <div className="bd fstack">
          {vendorCount === 0 && <div className="empty"><b>No vendors yet.</b><div style={{ fontSize: 12, marginTop: 6 }}>Add them from the address book below, or ask the co-pilot.</div></div>}
          {vendorCount > 0 && (
            <div className="vlist">
              {edit.vendors.map((v) => <div key={v.vendor_id} className="vitem"><span className="avatar">{v.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span><div><b>{v.name}</b><div className="hint">{v.city ?? "—"} · <span className="mono">{v.email}</span></div></div><Button size="xs" variant="ghost" onClick={() => set((e) => ({ ...e, vendors: e.vendors.filter((x) => x.vendor_id !== v.vendor_id) }))}>Remove</Button></div>)}
              {edit.newVendors.map((v, i) => <div key={`n${i}`} className="vitem"><span className="avatar">{v.name.slice(0, 2)}</span><div><b>{v.name}</b> <span className="chip grey">New</span><div className="hint mono">{v.email}</div></div><Button size="xs" variant="ghost" onClick={() => set((e) => ({ ...e, newVendors: e.newVendors.filter((_, j) => j !== i) }))}>Remove</Button></div>)}
            </div>
          )}
          <div className="fgroup">
            <div className="eyebrow">Add a vendor</div>
            <div className="frow">
              <select className="sel" style={{ flex: 1 }} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">From the address book…</option>{book.map((b) => <option key={b.vendor_id} value={b.vendor_id}>{b.name}{b.city ? ` · ${b.city}` : ""}</option>)}</select>
              <Button size="sm" disabled={!pick} onClick={() => { const b = book.find((x) => x.vendor_id === pick); if (b) set((e) => ({ ...e, vendors: [...e.vendors, b] })); setPick(""); }}>Add</Button>
            </div>
            <div className="frow">
              <input className="inp" style={{ flex: 1 }} placeholder="New vendor name" value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} />
              <input className="inp" style={{ flex: 1 }} placeholder="Email" type="email" value={nv.email} onChange={(e) => setNv({ ...nv, email: e.target.value })} />
              <Button size="sm" disabled={!nv.name.trim() || !/^\S+@\S+\.\S+$/.test(nv.email)} onClick={() => { set((e) => ({ ...e, newVendors: [...e.newVendors, { name: nv.name.trim(), email: nv.email.trim() }] })); setNv({ name: "", email: "" }); }}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Disqualify if" as choices instead of the stored rule text ("no", "yes", "lt:200", "gt:30"). */
function RuleInput({ type, rule, on }: { type: EditQuestion["answer_type"]; rule: string; on: (r: string) => void }) {
  if (type === "text") return <span className="hint">Text answers can&apos;t disqualify</span>;
  if (type === "yes_no") return (
    <label>Disqualify <select className="sel" value={rule} onChange={(e) => on(e.target.value)}><option value="">Never</option><option value="no">If the answer is No</option><option value="yes">If the answer is Yes</option></select></label>
  );
  const m = /^(lt|lte|gt|gte):(.+)$/.exec(rule);
  const op = m?.[1] ?? "", val = m?.[2] ?? "";
  return (
    <label>Disqualify <select className="sel" value={op} onChange={(e) => on(e.target.value ? `${e.target.value}:${val || 0}` : "")}><option value="">Never</option><option value="lt">If below</option><option value="gt">If above</option></select>
      {op && <input className="inp mono" style={{ width: 80, textAlign: "right" }} inputMode="decimal" value={val} aria-label="Threshold" onChange={(e) => on(`${op}:${e.target.value.replace(/[^\d.]/g, "")}`)} />}
    </label>
  );
}

const blankLine = (loc?: string): EditLine => ({ sku: "", description: "", ply: null, length_mm: null, width_mm: null, height_mm: null, gsm_spec: "", burst_factor: null, item_type: "", weight_per_piece_g: null, monthly_qty: null, annual_qty: null, delivery_location: loc ?? "", draft: false });
