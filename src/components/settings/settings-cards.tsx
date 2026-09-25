"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Settings } from "@/lib/settings-schema";
import { dateTime, longDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { send } from "./api";
import { CategoryTemplateCard } from "./category-template-card";

type Change = { id: string; created_at: string; actor_name: string; text: string };
const NEXT_RUN = "Applies from the next stage run; cells already written keep their state and chain.";

/** DESIGN §3.10 settings cards; TRD §17.13 (each save → PUT /api/settings → audit event settings.changed). */
export function SettingsCards({ settings, jevKey, changes, category, vendors }: { settings: Settings; jevKey: boolean; changes: Change[]; category: string; vendors: { id: string; name: string; city: string | null }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function save(key: keyof Settings, value: unknown, done: string) {
    setBusy(key);
    const r = await send("/api/settings", "PUT", { key, value });
    setBusy(null);
    if (r) { toast(`Saved — ${done}`); router.refresh(); }
    return !!r;
  }

  return (
    <>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="hd"><b>Email transport</b></div>
          <div className="bd radios">
            <label><input type="radio" name="em" checked readOnly /> <b>Mock</b> — outbox page, add-response sheet, vendor portal</label>
            <label className="off"><input type="radio" name="em" disabled /> <b>Gmail</b> — SMTP with App Password; IMAP sync <span className="chip grey">Not in this build</span></label>
            <label className="off"><input type="radio" name="em" disabled /> <b>Resend</b> — needs a verified domain <span className="chip grey">Not configured</span></label>
            <div className="hint">All three raise the same “response received” event.</div>
          </div>
        </div>

        <DecisionCard settings={settings} jevKey={jevKey} busy={busy} save={save} />
        <FxCard rates={settings.fx_rates} busy={busy === "fx_rates"} save={save} />
        <PriceCheckCard p={settings.price_check} busy={busy === "price_check"} save={save} />
      </div>

      <CategoryTemplateCard category={category} templates={settings.category_templates} vendors={vendors} busy={busy === "category_templates"} save={save} />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="hd"><b>Recent changes</b><span className="hint">settings apply to every RFx, so their changes are listed here</span></div>
        {changes.length ? (
          <div className="tl" style={{ padding: "4px 14px" }}>
            {changes.map((c) => (
              <div className="ev" key={c.id}><span className="ts mono">{dateTime(c.created_at)}</span><span className="dir" /><span>{c.text} <span className="hint">· {c.actor_name}</span></span></div>
            ))}
          </div>
        ) : <div className="bd hint">No changes yet — every value above is the seeded default.</div>}
      </div>
    </>
  );
}

type Save = (key: keyof Settings, value: unknown, done: string) => Promise<boolean>;

function DecisionCard({ settings, jevKey, busy, save }: { settings: Settings; jevKey: boolean; busy: string | null; save: Save }) {
  const [act, setAct] = useState(String(settings.thresholds.act));
  const [review, setReview] = useState(String(settings.thresholds.review));
  const dirty = Number(act) !== settings.thresholds.act || Number(review) !== settings.thresholds.review;
  const p = settings.decision_provider;
  const pick = (v: Settings["decision_provider"], word: string) => v !== p && save("decision_provider", v, `decision provider: ${word}. ${NEXT_RUN}`);
  return (
    <div className="card">
      <div className="hd"><b>Decision layer</b></div>
      <div className="bd radios">
        <div className="small">Classification, line mapping and questionnaire judgments go through a typed-decision interface — choice, score, yes/no, each with a probability.</div>
        <label><input type="radio" name="dp" checked={p === "auto"} disabled={busy === "decision_provider"} onChange={() => pick("auto", "Auto")} /> <b>Auto</b> — Jev via OpenRouter when a key is present, else Gemini {jevKey ? <span className="chip green">Key found · Jev</span> : <span className="chip amber">No key · Gemini</span>}</label>
        <label><input type="radio" name="dp" checked={p === "gemini"} disabled={busy === "decision_provider"} onChange={() => pick("gemini", "Gemini only")} /> Gemini only <span className="muted xs">“LLM-estimated”</span></label>
        <label className={jevKey ? undefined : "off"}><input type="radio" name="dp" checked={p === "jev"} disabled={!jevKey || busy === "decision_provider"} onChange={() => pick("jev", "Jev only")} /> Jev only <span className="muted xs">“measured”</span>{!jevKey && <span className="chip grey">Needs an OpenRouter key</span>}</label>
        <dl className="kv" style={{ marginTop: 6, alignItems: "center" }}>
          <dt>Act threshold</dt><dd><input className="ta mono num-in" type="number" step="0.01" min="0.01" max="1" value={act} onChange={(e) => setAct(e.target.value)} aria-label="Act threshold" /></dd>
          <dt>Review threshold</dt><dd><input className="ta mono num-in" type="number" step="0.01" min="0.01" max="1" value={review} onChange={(e) => setReview(e.target.value)} aria-label="Review threshold" /></dd>
        </dl>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="sm" disabled={!dirty || busy === "thresholds"} onClick={() => save("thresholds", { act: Number(act), review: Number(review) }, `thresholds ${act} / ${review}. ${NEXT_RUN}`)}>{busy === "thresholds" ? "Saving…" : "Save thresholds"}</Button>
          <span className="hint">At or above act: used as is. Between: marked for a look. Below review: not used. {NEXT_RUN}</span>
        </div>
      </div>
    </div>
  );
}

/** P9 D2: when a price gets a "Check unit" card. */
function PriceCheckCard({ p, busy, save }: { p: Settings["price_check"]; busy: boolean; save: Save }) {
  const [ratio, setRatio] = useState(String(p.median_ratio));
  const dirty = Number(ratio) !== p.median_ratio;
  return (
    <div className="card">
      <div className="hd"><b>Price check</b></div>
      <div className="bd radios">
        <div className="small">A price far from the other vendors&apos; prices for the same line, or one that works out to an unusual rupees-per-kg, is usually a unit slip. It gets a &ldquo;Check unit&rdquo; card; the cell keeps its state until you decide. The median needs at least 2 other vendors on the line. The usual ₹ per kg depends on the category, so it is set in the category template below.</div>
        <dl className="kv" style={{ marginTop: 6, alignItems: "center" }}>
          <dt>Median ratio</dt><dd className="unit"><input className="ta mono num-in" type="number" step="0.1" min="1.2" max="10" value={ratio} onChange={(e) => setRatio(e.target.value)} aria-label="Median ratio" /> × the others&apos; median, up or down</dd>
        </dl>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="sm" disabled={!dirty || busy} onClick={() => save("price_check", { median_ratio: Number(ratio) }, `price check ${ratio}×. ${NEXT_RUN}`)}>{busy ? "Saving…" : "Save price check"}</Button>
          <span className="hint">{NEXT_RUN}</span>
        </div>
      </div>
    </div>
  );
}

function FxCard({ rates, busy, save }: { rates: Settings["fx_rates"]; busy: boolean; save: Save }) {
  const today = new Date().toISOString().slice(0, 10);
  const [edit, setEdit] = useState<{ code: string; rate: string; date: string; source: string; isNew: boolean } | null>(null);
  const rows = Object.entries(rates).sort(([a], [b]) => a.localeCompare(b));
  async function commit() {
    if (!edit) return;
    const code = edit.code.trim().toUpperCase();
    if (edit.isNew && rates[code]) return toast.error(`${code} is already in the table — edit that row (DUPLICATE)`);
    const ok = await save("fx_rates", { ...rates, [code]: { rate: Number(edit.rate), date: edit.date, source: edit.source.trim() } }, `${code} at ${edit.rate}. Re-run normalise to use it; old cells keep their chain.`);
    if (ok) setEdit(null);
  }
  async function remove() {
    if (!edit) return;
    const rest = Object.fromEntries(Object.entries(rates).filter(([c]) => c !== edit.code));
    if (await save("fx_rates", rest, `${edit.code} removed. Quotes in ${edit.code} become ambiguous on the next normalise run.`)) setEdit(null);
  }
  const editor = edit && (
    <tr>
      <td>{edit.isNew ? <input className="ta mono" style={{ width: 64 }} maxLength={3} placeholder="EUR" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} aria-label="Currency" /> : edit.code}</td>
      <td className="num"><input className="ta mono num-in" type="number" step="0.01" min="0" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} aria-label="Rate" /></td>
      <td><input className="ta mono" type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} aria-label="Date" /></td>
      <td><input className="ta" style={{ width: 90 }} value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} aria-label="Source" /></td>
      <td style={{ whiteSpace: "nowrap" }}><Button size="sm" variant="default" disabled={busy} onClick={commit}>{busy ? "Saving…" : "Save"}</Button> <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
        {!edit.isNew && <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>Remove</Button>}</td>
    </tr>
  );
  return (
    <div className="card">
      <div className="hd"><b>FX rates</b>{!edit && <Button size="sm" variant="ghost" onClick={() => setEdit({ code: "", rate: "", date: today, source: "manual", isNew: true })}>Add currency</Button>}</div>
      <div className="bd" style={{ overflowX: "auto" }}>
        <table className="t fx">
          <thead><tr><th>Currency</th><th className="num">Rate (₹)</th><th>Date</th><th>Source</th><th /></tr></thead>
          <tbody>
            {rows.map(([code, r]) => edit && !edit.isNew && edit.code === code ? <Fragment key={code}>{editor}</Fragment> : (
              <tr key={code}>
                <td className="mono">{code}</td><td className="num">{r.rate}</td><td>{longDate(r.date)}</td><td className="muted">{r.source}</td>
                <td><Button size="sm" variant="ghost" disabled={!!edit} onClick={() => setEdit({ code, rate: String(r.rate), date: r.date, source: r.source, isNew: false })}>Edit</Button></td>
              </tr>
            ))}
            {edit?.isNew && editor}
            {!rows.length && !edit && <tr><td colSpan={5} className="muted">No rates yet — quotes in other currencies stay ambiguous until one is added.</td></tr>}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 6 }}>Changing a rate writes a new ledger entry; old cells keep their chain.</div>
      </div>
    </div>
  );
}

