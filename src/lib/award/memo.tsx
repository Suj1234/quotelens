import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { longDate, money } from "@/lib/format";
import type { LedgerRow } from "@/lib/rfx-tabs";
import { discountText } from "@/lib/scenarios/allocate";

// TRD §14.3 award memo (react-pdf). Rendered only from memo_json (awards.memo_json), which holds every number shown;
// all numbers come from the database (scenario lines, grid, ledger) — the model writes only the five narrative paragraphs.

export type Narrative = { recommendation: string; basis_of_award: string; key_assumptions: string; exclusions_and_risks: string; next_steps: string };
export type MemoAlloc = {
  line_no: number; description: string; annual_qty: number; vendor: string | null; price: number | null; annual_value: number | null;
  runner_up: string | null; runner_up_price: number | null; gap_pct: number | null; reason: string; is_override: boolean;
};
export type MemoDiscount = { vendor: string; pct: number; condition: string | null; met: boolean | null; why: string; saving: number };
export type MemoData = {
  rfx: { code: string; title: string; category: string; frozen_at: string | null; deadline: string | null; contract_months: number };
  prepared: { name: string; title: string; at: string };
  approved: { name: string; title: string; at: string } | null;
  scenario: { id: string; name: string; rule_text: string; price_basis: "unit" | "landed"; question: string | null; sql: string | null; fingerprint: string };
  allocation: MemoAlloc[];
  totals: { total: number; allocated: number; lines: number; unallocated: number[]; single_source: number[]; vendors: { name: string; lines: number; value: number; pct: number }[];
    /** P10 D4 (absent on memos made before): after the discounts this award earns, and each vendor's discount explained. */
    total_after?: number; discounts?: MemoDiscount[] };
  baseline: { vendor: string | null; total: number; total_quoted?: number; discount?: MemoDiscount | null; note: string | null } | null;
  savings: number | null; savings_pct: number | null;
  exclusions: { vendor: string; reason: string }[];
  validity: { vendor: string; days: number | null; until: string | null; short: boolean }[];
  ledger: LedgerRow[];
  open_items: {
    unresolved: { line_no: number; vendor: string; state: string; best_guess: number | null; at_stake: number | null }[]; at_stake_total: number;
    overrides: { line_no: number; vendor: string; instead_of: string | null; reason: string }[];
  };
  narrative: Narrative; narrative_unverified: string[]; generated_at: string;
};

const FONTS = path.join(process.cwd(), "src/lib/award/fonts");
Font.register({ family: "Plex", fonts: [{ src: path.join(FONTS, "IBMPlexSans-Regular.woff"), fontWeight: 400 }, { src: path.join(FONTS, "IBMPlexSans-SemiBold.woff"), fontWeight: 600 }] });
Font.register({ family: "PlexMono", src: path.join(FONTS, "IBMPlexMono-Regular.woff") });
Font.registerHyphenationCallback((w) => [w]); // never split numbers or names across lines

// DESIGN §1.1 light tokens / §2.16 memo: 19 px title, 11 px uppercase muted headings, table.t, signature grid with a top rule.
const INK = "#1C1E22", MUTED = "#6E727A", HAIR = "#DEDCD5", HAIR2 = "#ECEAE4";
const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 40, fontFamily: "Plex", fontSize: 9, color: INK, lineHeight: 1.45 },
  eyebrow: { fontSize: 7.5, letterSpacing: 0.6, color: MUTED, textTransform: "uppercase", marginBottom: 4 },
  h1: { fontSize: 15, fontWeight: 600, marginBottom: 2 },
  sub: { color: MUTED, marginBottom: 6 },
  h2: { fontSize: 7.5, letterSpacing: 0.6, textTransform: "uppercase", color: MUTED, marginTop: 16, marginBottom: 6 },
  p: { marginBottom: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${HAIR2}`, paddingVertical: 2.5 },
  th: { flexDirection: "row", borderBottom: `0.75 solid ${HAIR}`, paddingBottom: 3, color: MUTED, fontSize: 7, fontWeight: 600 },
  td: { paddingRight: 4, fontSize: 7.5 },
  num: { textAlign: "right", fontFamily: "PlexMono", fontSize: 7.2 },
  kv: { flexDirection: "row", paddingVertical: 2, borderBottom: `0.5 solid ${HAIR2}` },
  k: { width: 170, color: MUTED },
  pre: { fontFamily: "PlexMono", fontSize: 6.8, backgroundColor: "#F1F0EB", padding: 6, color: "#3A3D43" },
  sig: { flexDirection: "row", marginTop: 26, gap: 24 },
  sigcell: { flex: 1, borderTop: `0.75 solid ${INK}`, paddingTop: 5 },
  foot: { position: "absolute", bottom: 22, left: 40, right: 40, color: "#9EA2A9", fontSize: 7, flexDirection: "row", justifyContent: "space-between" },
});

const rs = (v: number | null) => (v === null ? "—" : money(Math.round(v)));
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const qty = (v: number) => v.toLocaleString("en-IN");
const STATE: Record<string, string> = { low_confidence: "low-confidence read", ambiguous: "ambiguous unit", references_prior: "prior pricing", conflict: "conflict" };

type Col<T> = { head: string; w: number; num?: boolean; get: (r: T) => string };
function Table<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <View>
      <View style={s.th} fixed>{cols.map((c) => <Text key={c.head} style={[{ width: c.w }, c.num ? { textAlign: "right" } : {}, { paddingRight: 4 }]}>{c.head}</Text>)}</View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c) => <Text key={c.head} style={[s.td, { width: c.w }, c.num ? s.num : {}]}>{c.get(r)}</Text>)}
        </View>
      ))}
    </View>
  );
}
const KV = ({ k, v }: { k: string; v: string }) => <View style={s.kv} wrap={false}><Text style={s.k}>{k}</Text><Text style={{ flex: 1 }}>{v}</Text></View>;
const Paras = ({ text }: { text: string }) => <>{text.split(/\n+/).filter(Boolean).map((t, i) => <Text key={i} style={s.p}>{t}</Text>)}</>;

const ALLOC: Col<MemoAlloc>[] = [
  { head: "#", w: 16, get: (r) => String(r.line_no) },
  { head: "Line", w: 112, get: (r) => r.description },
  { head: "Annual qty", w: 42, num: true, get: (r) => qty(r.annual_qty) },
  { head: "Vendor", w: 70, get: (r) => r.vendor ?? "unallocated" },
  { head: "₹/1000", w: 44, num: true, get: (r) => rs(r.price) },
  { head: "Annual ₹", w: 54, num: true, get: (r) => rs(r.annual_value) },
  { head: "Runner-up", w: 64, get: (r) => (r.runner_up ? `${r.runner_up} ${rs(r.runner_up_price)}` : "—") },
  { head: "Gap", w: 32, num: true, get: (r) => pct(r.gap_pct) },
  { head: "Reason", w: 81, get: (r) => r.reason },
];

export function renderMemoPdf(m: MemoData): Promise<Buffer> {
  const t = m.totals;
  return renderToBuffer(
    <Document title={`${m.rfx.code} Award memo`} author="Meridian Foods Pvt Ltd" subject={m.scenario.name}>
      <Page size="A4" style={s.page}>
        {/* 1 · Header, recommendation, basis of award */}
        <Text style={s.eyebrow}>Meridian Foods Pvt Ltd · Procurement</Text>
        <Text style={s.h1}>Award recommendation — RFx {m.rfx.code}</Text>
        <Text style={s.sub}>
          {m.rfx.title} · {m.rfx.category}{m.rfx.frozen_at ? ` · issued ${longDate(m.rfx.frozen_at)}` : ""}{m.rfx.deadline ? ` · deadline ${longDate(m.rfx.deadline)}` : ""} · {m.rfx.contract_months}-month contract
          {"\n"}Prepared by {m.prepared.name} on {longDate(m.prepared.at)} · {m.approved ? `approved by ${m.approved.name} on ${longDate(m.approved.at)}` : "awaiting approval"}
        </Text>
        <Text style={s.h2}>Recommendation</Text>
        <Paras text={m.narrative.recommendation} />
        <Text style={s.h2}>Basis of award</Text>
        <Paras text={m.narrative.basis_of_award} />
        <Text style={s.p}>Scenario “{m.scenario.name}”: {m.scenario.rule_text}. Prices are INR per 1000 pieces on {m.scenario.price_basis === "landed" ? "landed cost" : "unit price"}; annual value = price × annual quantity ÷ 1000.</Text>

        {/* 2 · Allocation */}
        <Text style={s.h2} minPresenceAhead={60}>Allocation</Text>
        <Table cols={ALLOC} rows={m.allocation} />

        {/* 3 · Totals, baseline, exclusions, single-source, validity */}
        <Text style={s.h2} minPresenceAhead={80}>Totals and baseline</Text>
        <KV k="Annual total" v={`${rs(t.total)} for ${t.allocated} of ${t.lines} lines`} />
        {t.vendors.map((v) => <KV key={v.name} k={v.name} v={`${v.lines} lines · ${rs(v.value)} · ${v.pct.toFixed(1)}%`} />)}
        {(t.discounts ?? []).map((d) => <KV key={`d-${d.vendor}`} k={`Discount · ${d.vendor}`} v={`${discountText(d)}${d.saving ? ` · −${rs(d.saving)}` : ""}`} />)}
        {t.total_after !== undefined && t.total_after < t.total - 0.5 && <KV k="After discounts" v={rs(t.total_after)} />}
        <KV k="Best single vendor" v={m.baseline ? `${m.baseline.vendor} at ${rs(m.baseline.total)}${m.baseline.discount?.met && m.baseline.total_quoted ? ` (${rs(m.baseline.total_quoted)} quoted; ${discountText(m.baseline.discount)})` : ""}${m.baseline.note ? ` — ${m.baseline.note}` : ""}` : "none (no vendor priced these lines)"} />
        <KV k="Saving against it" v={m.savings === null ? "—" : `${rs(m.savings)} a year (${pct(m.savings_pct)})`} />
        <KV k="Unallocated lines" v={t.unallocated.length ? t.unallocated.join(", ") : "none"} />
        <KV k="Single-source lines" v={t.single_source.length ? `${t.single_source.join(", ")} (only one eligible quote)` : "none"} />
        <Text style={s.h2} minPresenceAhead={40}>Exclusions</Text>
        {m.exclusions.length ? m.exclusions.map((e, i) => <Text key={i} style={s.p}>{e.vendor} — {e.reason}</Text>) : <Text style={s.p}>None.</Text>}
        <Text style={s.h2} minPresenceAhead={40}>Validity of the awarded quotes</Text>
        {m.validity.map((v) => <KV key={v.vendor} k={v.vendor} v={`${v.days !== null ? `${v.days} days` : "not stated"}${v.until ? `, until ${longDate(v.until)}` : ""}${v.short ? " — shorter than the RFx asked" : ""}`} />)}

        {/* 4 · Assumptions ledger (same rows as the Ledger tab) */}
        <Text style={s.h2} minPresenceAhead={60}>Assumptions ledger</Text>
        <Paras text={m.narrative.key_assumptions} />
        <Table<LedgerRow> rows={m.ledger} cols={[
          { head: "Kind", w: 70, get: (r) => r.kind }, { head: "Vendor", w: 78, get: (r) => r.vendor }, { head: "Lines", w: 40, get: (r) => r.lines },
          { head: "Assumption", w: 187, get: (r) => r.description }, { head: "Basis", w: 70, get: (r) => r.basis }, { head: "By", w: 70, get: (r) => r.by }]} />

        {/* 5 · Open items */}
        <Text style={s.h2} minPresenceAhead={60}>Open items</Text>
        <Paras text={m.narrative.exclusions_and_risks} />
        {m.open_items.unresolved.length > 0 && <>
          <Text style={s.p}>{m.open_items.unresolved.length} unresolved cells; {rs(m.open_items.at_stake_total)} a year at the system&apos;s best guess where it has one. They are not in the totals above.</Text>
          <Table rows={m.open_items.unresolved} cols={[
            { head: "#", w: 30, get: (r) => String(r.line_no) }, { head: "Vendor", w: 150, get: (r) => r.vendor }, { head: "State", w: 120, get: (r) => STATE[r.state] ?? r.state },
            { head: "Best guess ₹/1000", w: 100, num: true, get: (r) => rs(r.best_guess) }, { head: "At stake ₹/yr", w: 110, num: true, get: (r) => rs(r.at_stake) }]} />
        </>}
        <Text style={[s.p, { marginTop: 6 }]}>Manual overrides: {m.open_items.overrides.length ? "" : "none."}</Text>
        {m.open_items.overrides.map((o, i) => <Text key={i} style={s.p}>Line {o.line_no} → {o.vendor}{o.instead_of ? ` instead of ${o.instead_of}` : ""}: {o.reason}</Text>)}
        <Text style={s.h2}>Next steps</Text>
        <Paras text={m.narrative.next_steps} />

        {/* 6 · Rule, query, signatures */}
        <Text style={s.h2} minPresenceAhead={60}>How the allocation was made</Text>
        <Text style={s.p}>{m.scenario.rule_text}.{m.scenario.question ? ` Saved from the answer to “${m.scenario.question}”; the query below chose the winners, and every price, runner-up and total was recomputed from the comparison.` : " Computed by a fixed rule over the comparison grid (no model involved)."}</Text>
        {m.scenario.sql && <Text style={s.pre}>{m.scenario.sql}</Text>}
        {m.narrative_unverified.length > 0 && <Text style={[s.p, { color: "#9A6A00" }]}>Numbers in the narrative not found in the data: {m.narrative_unverified.join(", ")}.</Text>}
        <View style={s.sig} wrap={false}>
          <View style={s.sigcell}><Text>Prepared — {m.prepared.name}, {m.prepared.title}</Text><Text style={{ color: MUTED }}>{longDate(m.prepared.at)}</Text></View>
          <View style={s.sigcell}><Text>Approved — {m.approved ? `${m.approved.name}, ${m.approved.title}` : "________________"}</Text><Text style={{ color: MUTED }}>{m.approved ? longDate(m.approved.at) : " "}</Text></View>
        </View>
        <View style={s.foot} fixed>
          <Text>{m.rfx.code} · Award memo · {m.scenario.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>,
  );
}
