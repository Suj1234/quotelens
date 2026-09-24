"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Settings } from "@/lib/settings-schema";
import { dateTime, longDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { send } from "./api";

type Change = { id: string; created_at: string; actor_name: string; text: string };
const NEXT_RUN = "Applies from the next stage run; cells already written keep their state and chain.";

/** DESIGN §3.10 settings cards; TRD §17.13 (each save → PUT /api/settings → audit event settings.changed). */
export function SettingsCards({ settings, jevKey, changes }: { settings: Settings; jevKey: boolean; changes: Change[] }) {
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
            <label className="off"><input type="radio" name="em" disabled /> <b>Gmail</b> — SMTP with App Password; IMAP sync <span className="chip grey">not in this build</span></label>
            <label className="off"><input type="radio" name="em" disabled /> <b>Resend</b> — needs a verified domain <span className="chip grey">not configured</span></label>
            <div className="hint">All three raise the same “response received” event.</div>
          </div>
        </div>

        <DecisionCard settings={settings} jevKey={jevKey} busy={busy} save={save} />
        <FxCard rates={settings.fx_rates} busy={busy === "fx_rates"} save={save} />
        <LandedCard settings={settings} busy={busy} save={save} />
      </div>

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
        <label><input type="radio" name="dp" checked={p === "auto"} disabled={busy === "decision_provider"} onChange={() => pick("auto", "Auto")} /> <b>Auto</b> — Jev via OpenRouter when a key is present, else Gemini {jevKey ? <span className="chip green">key found · Jev</span> : <span className="chip amber">no key · Gemini</span>}</label>
        <label><input type="radio" name="dp" checked={p === "gemini"} disabled={busy === "decision_provider"} onChange={() => pick("gemini", "Gemini only")} /> Gemini only <span className="muted xs">“LLM-estimated”</span></label>
        <label className={jevKey ? undefined : "off"}><input type="radio" name="dp" checked={p === "jev"} disabled={!jevKey || busy === "decision_provider"} onChange={() => pick("jev", "Jev only")} /> Jev only <span className="muted xs">“measured”</span>{!jevKey && <span className="chip grey">needs an OpenRouter key</span>}</label>
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

function LandedCard({ settings, busy, save }: { settings: Settings; busy: string | null; save: Save }) {
  const [freight, setFreight] = useState(String(settings.freight_default_inr_per_1000));
  const d = settings.discount_default;
  return (
    <div className="card">
      <div className="hd"><b>Landed cost &amp; discounts</b></div>
      <div className="bd radios">
        <dl className="kv" style={{ alignItems: "center" }}>
          <dt>Freight default</dt>
          <dd style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            ₹<input className="ta mono num-in" type="number" min="0" step="1" value={freight} onChange={(e) => setFreight(e.target.value)} aria-label="Freight default per 1000 pcs" /> / 1000 pcs
            <Button size="sm" disabled={Number(freight) === settings.freight_default_inr_per_1000 || freight === "" || busy === "freight_default_inr_per_1000"}
              onClick={() => save("freight_default_inr_per_1000", Number(freight), `freight default ₹${freight} per 1000. ${NEXT_RUN}`)}>Save</Button>
          </dd>
          <dt>Total-level discounts</dt>
          <dd>
            <div className="seg" role="radiogroup" aria-label="Total-level discounts">
              <button className={d === "gross" ? "on" : undefined} disabled={busy === "discount_default"} onClick={() => d !== "gross" && save("discount_default", "gross", `total-level discounts shown gross. ${NEXT_RUN}`)}>Show gross</button>
              <button className={d === "net" ? "on" : undefined} disabled={busy === "discount_default"} onClick={() => d !== "net" && save("discount_default", "net", `total-level discounts applied to every line. ${NEXT_RUN}`)}>Apply to every line</button>
            </div>
          </dd>
          <dt>Cost of money</dt><dd className="muted">not in this build</dd>
        </dl>
        <div className="hint">Freight is added to the landed price of vendors whose quote excludes it, unless a per-vendor figure was entered. A vendor&apos;s total discount (e.g. 3% on orders above a value) is shown in the ledger; &ldquo;Apply to every line&rdquo; takes it off each of that vendor&apos;s prices. {NEXT_RUN}</div>
      </div>
    </div>
  );
}
