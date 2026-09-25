"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/lib/query/result";
import { inrShort, isMoneyColumn, money } from "@/lib/format";

// P11 #12 (overrides DESIGN §2.15 "one colour, no library" — DECISIONS 2026-09-25): the chart forms an Ask answer can take.
// Vendors keep one colour everywhere (--v1…--v8 in grid order); text stays in text tokens; every chart sits above the answer's
// table, which is its table view. Grouped and line use Recharts; share, diverging and heatmap are plain HTML.

type VendorRef = { name: string; code: string }[];
const colourOf = (vendors: VendorRef) => (name: string) => {
  const i = vendors.findIndex((v) => v.name === name || v.code === name);
  return i >= 0 && i < 8 ? `var(--v${i + 1})` : "var(--faint)"; // a 9th vendor isn't a new hue
};
const num = (y: string, v: number) => (isMoneyColumn(y) ? inrShort(v) : v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const AXIS = { fontSize: 11, fill: "var(--muted)" };
const TIP = { contentStyle: { background: "var(--surface)", border: "1px solid var(--hair)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }, cursor: { fill: "var(--tint)" } };

function Title({ t }: { t: string }) {
  return <div className="text-muted-foreground" style={{ fontSize: 11, marginBottom: 6 }}>{t}</div>;
}

/** DESIGN §2.15 bars: label · track · value, one colour (one series needs no legend). */
function Bars({ spec }: { spec: Extract<ChartSpec, { type: "bar" | "line" }> }) {
  const y = spec.series[0].y;
  const max = Math.max(...spec.data.map((d) => Math.abs(Number(d[y]) || 0)), 1);
  const moneyish = isMoneyColumn(y) || y === "value";
  return (
    <div>
      {spec.data.map((d, i) => {
        const v = Number(d[y]) || 0;
        return (
          <div className="bar tip" key={i} data-tip={`${d[spec.x]}: ${moneyish ? inrShort(v) : v.toLocaleString("en-IN")}`}>
            <span className="lbl" title={String(d[spec.x])}>{String(d[spec.x])}</span>
            <span className="trk"><span className="fill" style={{ width: `${(Math.abs(v) / max * 100).toFixed(1)}%` }} /></span>
            <span className="v">{moneyish ? inrShort(v) : v.toLocaleString("en-IN")}</span>
          </div>
        );
      })}
    </div>
  );
}

function Lines({ spec }: { spec: Extract<ChartSpec, { type: "bar" | "line" }> }) {
  const y = spec.series[0].y;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={spec.data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--hair2)" vertical={false} />
        <XAxis dataKey={spec.x} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--hair)" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => num(y, v)} />
        <Tooltip {...TIP} formatter={(v) => num(y, Number(v))} />
        <Line type="monotone" dataKey={y} stroke="var(--v1)" strokeWidth={2} dot={{ r: 4, fill: "var(--v1)", stroke: "var(--surface)", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Vendors side by side per line. */
function Grouped({ spec, vendors }: { spec: Extract<ChartSpec, { type: "grouped" }>; vendors: VendorRef }) {
  const colour = colourOf(vendors);
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, 34 * spec.data.length + 60)}>
      <BarChart data={spec.data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="18%">
        <CartesianGrid stroke="var(--hair2)" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => num(spec.y, v)} />
        <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--hair)" }} width={56} />
        <Tooltip {...TIP} formatter={(v, n) => [v === null ? "not priced" : num(spec.y, Number(v)), String(n)]} />
        <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, color: "var(--ink2)" }} />
        {spec.series.map((v) => <Bar key={v} dataKey={v} fill={colour(v)} maxBarSize={12} radius={[0, 4, 4, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** How a split divides across vendors: one bar, 2px gaps, the legend carries names and values. */
function Share({ spec, vendors }: { spec: Extract<ChartSpec, { type: "share" }>; vendors: VendorRef }) {
  const colour = colourOf(vendors);
  return (
    <div>
      <div className="share-bar">
        {spec.data.map((d) => <span key={d.vendor} className="tip" style={{ flexGrow: Math.max(d.pct, 0.5), background: colour(d.vendor) }}
          data-tip={`${d.vendor}: ${inrShort(d.value)} (${d.pct}%)${d.lines ? ` · ${d.lines} lines` : ""}`} />)}
      </div>
      <div className="share-legend">
        {spec.data.map((d) => (
          <div key={d.vendor}><i style={{ background: colour(d.vendor) }} /><span className="nm">{d.vendor}</span>
            <span className="mono">{inrShort(d.value)}</span><span className="text-muted-foreground mono">{d.pct}%{d.lines ? ` · ${d.lines} lines` : ""}</span></div>
        ))}
      </div>
    </div>
  );
}

/** A signed change per row, from a zero baseline in the middle: blue above, red below. */
function Diverging({ spec }: { spec: Extract<ChartSpec, { type: "diverging" }> }) {
  const max = Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  return (
    <div>
      {spec.data.map((d, i) => {
        const w = `${(Math.abs(d.value) / max * 50).toFixed(1)}%`;
        return (
          <div className="bar div tip" key={i} data-tip={`${d.label}: ${d.value > 0 ? "+" : ""}${num(spec.y, d.value)}`}>
            <span className="lbl" title={d.label}>{d.label}</span>
            <span className="trk div">
              <span className="mid" />
              <span className="fill" style={d.value >= 0 ? { left: "50%", width: w, background: "var(--div-pos)", borderRadius: "0 4px 4px 0" } : { right: "50%", width: w, background: "var(--div-neg)", borderRadius: "4px 0 0 4px" }} />
            </span>
            <span className="v">{d.value > 0 ? "+" : ""}{num(spec.y, d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Lines × vendors: each price shaded by how far above the line's lowest it is (one hue, light = close to lowest). */
function Heatmap({ spec }: { spec: Extract<ChartSpec, { type: "heatmap" }> }) {
  // The scale stops at +50% (or the largest gap, if smaller) so one outlier doesn't wash out the rest.
  const top = Math.min(50, Math.max(...spec.lines.flatMap((l) => l.cells.map((c) => c.over_pct ?? 0)), 1));
  const fill = (p: number | null) => (p === null ? "transparent" : p === 0 ? "var(--surface)" : `color-mix(in oklab, var(--seq-hi) ${Math.round(Math.min(p / top, 1) * 100)}%, var(--seq-lo))`);
  const price = (v: number) => (isMoneyColumn(spec.y) ? money(Math.round(v)) : v.toLocaleString("en-IN")); // one format down a column
  return (
    <div className="heat">
      <table>
        <thead><tr><th>Line</th>{spec.vendors.map((v) => <th key={v} title={v}>{v}</th>)}</tr></thead>
        <tbody>{spec.lines.map((l) => (
          <tr key={l.label}><td className="ln">{l.label.replace("Line ", "")}</td>
            {l.cells.map((c, i) => (
              <td key={i} className={`mono${c.over_pct === 0 ? " low" : ""}`} style={{ background: fill(c.over_pct) }}
                title={c.price === null ? `${spec.vendors[i]}: not priced` : `${spec.vendors[i]}: ${price(c.price)}${c.over_pct ? ` · +${c.over_pct}% over the lowest` : " · lowest"}`}>
                {c.price === null ? "—" : price(c.price)}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <div className="hint" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        Lowest on the line <span className="heat-key" /> +{top}%{top === 50 ? " or more" : ""} over the lowest · hover a cell for the gap
      </div>
    </div>
  );
}

export function AskChart({ spec, vendors }: { spec: ChartSpec; vendors: VendorRef }) {
  return (
    <div style={{ marginTop: 10 }}>
      <Title t={spec.title} />
      {spec.type === "bar" && <Bars spec={spec} />}
      {spec.type === "line" && <Lines spec={spec} />}
      {spec.type === "grouped" && <Grouped spec={spec} vendors={vendors} />}
      {spec.type === "share" && <Share spec={spec} vendors={vendors} />}
      {spec.type === "diverging" && <Diverging spec={spec} />}
      {spec.type === "heatmap" && <Heatmap spec={spec} />}
    </div>
  );
}
