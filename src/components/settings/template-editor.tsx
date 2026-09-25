"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CategoryTemplate, LineField, Settings, TemplatePart } from "@/lib/settings-schema";
import { LINE_FIELDS } from "@/lib/settings-schema";
import { FIELD_LABEL } from "@/lib/line-rules";
import { Button } from "@/components/ui/button";
import { send } from "./api";

// P9: the category template — the company's standard for a category, what the co-pilot proposes and what Issue requires.
// Settings → Masters shows it as three sub-tabs plus the approved ticks in the Vendor directory (DECISIONS 2026-09-25); each edits its own part and saves the whole template.
// Industry equivalent: sourcing/event template + supplier-qualification question library + approved vendor list.

type Level = "required" | "recommended" | "optional";

// Approved vendors are ticked in the Vendor directory (one row per vendor), not here.
export type EditorPart = Exclude<TemplatePart, "approved">;
const PART: Record<EditorPart, [string, string]> = {
  terms: ["Naming & terms", "The co-pilot suggests titles in this shape and proposes these terms as the company standard; a price outside the usual band gets a “Check unit” card."],
  lines: ["Line fields", "Issue is blocked while a line misses a required field; the co-pilot asks for recommended ones."],
  questions: ["Question library", "The co-pilot offers these questions (by L-number) with their answer types, mandatory flags and disqualify rules."],
};

export function TemplateEditor({ part, category, templates }: {
  part: EditorPart; category: string; templates: Settings["category_templates"];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function save(key: keyof Settings, value: unknown, done: string) {
    setBusy(true);
    const r = await send("/api/settings", "PUT", { key, value });
    setBusy(false);
    if (r) { toast(`Saved — ${done}`); router.refresh(); }
    return !!r;
  }
  const saved = templates[category] ?? null;
  const [t, setT] = useState<CategoryTemplate | null>(saved);
  const dirty = JSON.stringify(t) !== JSON.stringify(saved);
  const set = (p: Partial<CategoryTemplate>) => setT((x) => (x ? { ...x, ...p } : x));

  if (!t) return (
    <div className="card">
      <div className="hd"><b>{PART[part][0]} · {category}</b></div>
      <div className="bd hint">No masters for {category} yet: the co-pilot asks the buyer for every term and question. Run <span className="mono">npm run seed:template</span> to create them from MER-0417.</div>
    </div>
  );

  const s = t.standard_terms;
  const setS = (p: Partial<CategoryTemplate["standard_terms"]>) => set({ standard_terms: { ...s, ...p } });
  const level = (f: LineField): Level => (t.line_rules.required.includes(f) ? "required" : t.line_rules.recommended.includes(f) ? "recommended" : "optional");
  const setLevel = (f: LineField, l: Level) => set({ line_rules: {
    ...t.line_rules,
    required: [...t.line_rules.required.filter((x) => x !== f), ...(l === "required" ? [f] : [])],
    recommended: [...t.line_rules.recommended.filter((x) => x !== f), ...(l === "recommended" ? [f] : [])],
  } });
  const q = t.question_library;
  const setQ = (i: number, p: Partial<CategoryTemplate["question_library"][number]>) => set({ question_library: q.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  return (
    <div className="card">
      <div className="hd">
        <div><b>{PART[part][0]} · {category}</b><div className="hint" style={{ marginTop: 2 }}>{PART[part][1]}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setT(saved)}>Discard</Button>}
          <Button size="sm" variant="default" disabled={!dirty || busy} onClick={() => save("category_templates", { ...templates, [category]: t }, `${PART[part][0].toLowerCase()} for ${category}. New drafts and the co-pilot use it from the next message.`)}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      <div className="bd tpl">
        <p className="hint">Source: {t.source}</p>

        {part === "terms" && <><section style={{ gridColumn: "1 / -1" }}>
          <div className="eyebrow">Naming convention</div>
          <input className="inp" style={{ width: "100%", maxWidth: 520 }} value={t.title_pattern} onChange={(e) => set({ title_pattern: e.target.value })} aria-label="Title naming convention" />
          <p className="hint" style={{ marginTop: 4 }}>Filled from what the buyer says; the co-pilot asks for any part it doesn&apos;t know.</p>
        </section>

        <section style={{ gridColumn: "1 / -1", maxWidth: 760 }}>
          <div className="eyebrow">Standard terms</div>
          <dl className="kv terms-form">
            <dt>Currency</dt><dd><input className="inp mono" style={{ width: 80 }} value={s.currency} onChange={(e) => setS({ currency: e.target.value.toUpperCase().slice(0, 3) })} /></dd>
            <dt>Quote unit</dt><dd><select className="sel" value={s.quote_unit} onChange={(e) => setS({ quote_unit: e.target.value as typeof s.quote_unit })}>{[["per_1000_pcs", "Per 1000 pieces"], ["per_piece", "Per piece"], ["per_kg", "Per kg"], ["per_box", "Per box"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></dd>
            <dt>Delivery basis</dt><dd><select className="sel" value={s.incoterm} onChange={(e) => setS({ incoterm: e.target.value as typeof s.incoterm })}>{[["delivered", "Delivered to plant"], ["ex_works", "Ex-works"], ["fob", "FOB"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></dd>
            <dt>Freight</dt><dd><label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={s.freight_included} onChange={(e) => setS({ freight_included: e.target.checked })} /> Included in the price</label></dd>
            <dt>GST</dt><dd><select className="sel" value={s.tax_basis} onChange={(e) => setS({ tax_basis: e.target.value as typeof s.tax_basis })}><option value="excl_gst">Prices exclude GST (vendor states the rate)</option><option value="incl_gst">Prices include GST</option></select></dd>
            <dt>Payment</dt><dd className="unit"><Int v={s.payment_terms_days} on={(v) => setS({ payment_terms_days: v })} /> days</dd>
            <dt>Quote validity</dt><dd className="unit"><Int v={s.validity_days} on={(v) => setS({ validity_days: v })} /> days</dd>
            <dt>Contract</dt><dd className="unit"><Int v={s.contract_months} on={(v) => setS({ contract_months: v })} /> months</dd>
            <dt>Usual price</dt><dd className="unit">₹<Int v={t.price_band?.rs_per_kg_min ?? 0} on={(v) => set({ price_band: { rs_per_kg_min: v, rs_per_kg_max: t.price_band?.rs_per_kg_max ?? v + 1 } })} /> to ₹<Int v={t.price_band?.rs_per_kg_max ?? 0} on={(v) => set({ price_band: { rs_per_kg_min: t.price_band?.rs_per_kg_min ?? 0, rs_per_kg_max: v } })} /> per kg <span className="hint">— a price outside this gets a &ldquo;Check unit&rdquo; card</span></dd>
          </dl>
        </section></>}

        {part === "lines" && <section style={{ gridColumn: "1 / -1", maxWidth: 760 }}>
          <div className="eyebrow">Line fields</div>
          <table className="t" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Field</th><th>Required</th><th>Recommended</th><th>Optional</th></tr></thead>
            <tbody>{LINE_FIELDS.map((f) => (
              <tr key={f}><td>{FIELD_LABEL[f]}</td>
                {(["required", "recommended", "optional"] as const).map((l) => <td key={l}><input type="radio" name={`lf-${f}`} aria-label={`${FIELD_LABEL[f]} ${l}`} checked={level(f) === l} disabled={f === "description"} onChange={() => setLevel(f, l)} /></td>)}
              </tr>
            ))}</tbody>
          </table>
          <div className="unit" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="hint">Allowed ply</span>
            <input className="inp mono" style={{ width: 90 }} value={t.line_rules.allowed_ply.join(", ")}
              onChange={(e) => set({ line_rules: { ...t.line_rules, allowed_ply: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0) } })} />
          </div>
        </section>}

        {part === "questions" && <section style={{ gridColumn: "1 / -1" }}>
          <div className="eyebrow">Question library <span className="mono">{q.length}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {q.map((x, i) => (
              <div key={i} className="tpl-q">
                <span className="mono text-muted-foreground">L{i + 1}</span>
                <input className="inp" value={x.text} onChange={(e) => setQ(i, { text: e.target.value })} aria-label={`Question L${i + 1}`} />
                <select className="sel" value={x.answer_type} onChange={(e) => setQ(i, { answer_type: e.target.value as typeof x.answer_type })}><option value="yes_no">yes / no</option><option value="number">number</option><option value="text">text</option></select>
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={x.mandatory} onChange={(e) => setQ(i, { mandatory: e.target.checked })} /> mandatory</label>
                <input className="inp mono" placeholder="disqualify if…" title='"no" / "yes" for yes-no; "lt:200" / "gt:30" for numbers; empty = never' value={x.disqualify_if ?? ""} onChange={(e) => setQ(i, { disqualify_if: e.target.value.trim() || null })} />
                <Button size="xs" variant="ghost" onClick={() => set({ question_library: q.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
            ))}
            <div><Button size="sm" variant="ghost" onClick={() => set({ question_library: [...q, { text: "", answer_type: "yes_no", mandatory: true, disqualify_if: null }] })}>Add question</Button></div>
          </div>
        </section>}
      </div>
    </div>
  );
}

const Int = ({ v, on }: { v: number; on: (n: number) => void }) =>
  <input className="inp mono" style={{ width: 80, textAlign: "right" }} inputMode="numeric" value={Number.isFinite(v) ? v : ""} onChange={(e) => on(Math.round(Number(e.target.value) || 0))} />;
