"use client";

import { useState } from "react";
import type { LedgerRow } from "@/lib/rfx-tabs";
import { shortDate } from "@/lib/format";

// Plain names for the assumption kinds (schema values stay in the export).
const KIND: Record<string, string> = {
  weight_per_piece: "Weight per piece", pack_size: "Pack size", unit_conversion: "Unit conversion", fx_rate: "Currency rate",
  discount_treatment: "Discount", freight_treatment: "Freight", tax_treatment: "GST", validity: "Validity", prior_pricing: "Earlier pricing",
  mapping_override: "Line match changed", value_override: "Price changed", exclusion: "Excluded", other: "Other",
};
// Where the number came from, most to least trustworthy (P10 B5 grades).
const SOURCE: Record<LedgerRow["grade"], string> = { A: "the vendor said so", B: "our spec or an official rate", C: "entered by a buyer", D: "a default or the AI's inference — check" };

/** DESIGN §3.7 Ledger: every number the comparison uses that isn't the vendor's own price, and exactly what it did to each line. */
export function LedgerTab({ rows }: { rows: LedgerRow[] }) {
  const [kind, setKind] = useState(""); const [vendor, setVendor] = useState("");
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!vendor || r.vendor === vendor))
    .sort((a, b) => b.grade.localeCompare(a.grade)); // D first: those are the ones to check
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="hd">
        <span><b>Assumptions <span className="mono text-muted-foreground">{shown.length}</span></b> <span className="hint">· every figure we used that isn&apos;t the vendor&apos;s own price</span></span>
        <span style={{ display: "flex", gap: 8 }}>
          <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">All types</option>{[...new Set(rows.map((r) => r.kind))].map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}</select>
          <select className="sel" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="">All vendors</option>{[...new Set(rows.map((r) => r.vendor))].map((v) => <option key={v}>{v}</option>)}</select>
        </span>
      </div>
      {/* what the Source letters mean, and what can't be done here yet */}
      <div className="bd" style={{ display: "flex", gap: "8px 20px", flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--ink2)", background: "var(--tint)", borderBottom: "1px solid var(--hair)", paddingTop: 10, paddingBottom: 10 }}>
        <b style={{ color: "var(--ink)", fontWeight: 600 }}>What the Source letters mean</b>
        {(Object.keys(SOURCE) as LedgerRow["grade"][]).map((g) => <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className={`chip ${g === "D" ? "amber" : "grey"}`} style={{ fontWeight: 600, background: g === "D" ? undefined : "var(--surface)" }}>{g}</span>{SOURCE[g]}</span>)}
        <span className="text-muted-foreground" style={{ flexBasis: "100%", fontSize: 12 }}>Rate, freight, discount and GST figures are changed on their Review cards. Changing a weight or pack size taken from our spec is on the roadmap.</span>
      </div>
      <table className="t">
        <thead><tr><th>Type</th><th>Vendor</th><th>Lines</th><th>What we did</th><th>Source</th><th>Recorded</th></tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>{KIND[r.kind] ?? r.kind}</td>
              <td>{r.vendor}</td>
              <td className="mono">{r.lines}</td>
              <td>
                {r.description}
                {r.calcs.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary className="linkish" style={{ fontSize: 12 }}>Show the conversion{r.calcs.length > 1 ? ` for ${r.calcs.length} lines` : ""}</summary>
                    <table className="t" style={{ marginTop: 6, background: "var(--paper)" }}>
                      <thead><tr><th>Line</th><th>Vendor wrote</th><th>What we did</th><th>Price used</th></tr></thead>
                      <tbody>
                        {r.calcs.map((c, j) => (
                          <tr key={j}><td className="mono">{c.line}</td><td className="mono" style={{ whiteSpace: "nowrap" }}>{c.written}</td><td>{c.did}</td><td className="mono" style={{ whiteSpace: "nowrap" }}>{c.result}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </td>
              <td style={{ minWidth: 170 }}><span className={`chip ${r.grade === "D" ? "amber" : "grey"}`}>{r.grade}</span> <span className="text-muted-foreground" style={{ fontSize: 12 }}>{SOURCE[r.grade]}</span></td>
              <td className="text-muted-foreground" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.by} · <span className="mono">{shortDate(r.at)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!shown.length && <div className="bd"><div className="empty"><b>No assumptions yet.</b> Every conversion that isn&apos;t vendor-stated lands here.</div></div>}
    </div>
  );
}
