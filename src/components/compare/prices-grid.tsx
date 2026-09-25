"use client";

import { useMemo, useState } from "react";
import type { CellState, Grid, GridCell } from "@/lib/comparison";
import { inrShort, money } from "@/lib/format";
import { AskButton } from "@/components/ask/ask-sheet";
import { DownloadButton } from "@/components/download-button";
import { Conditions } from "./conditions";

type View = "unit" | "landed" | "orig";
const COUNTED: CellState[] = ["confirmed", "inferred", "reviewed"];
// DESIGN §2.8 legend order
const LEGEND: [CellState, string][] = [
  ["confirmed", "Confirmed"], ["inferred", "Inferred"], ["reviewed", "Reviewed"], ["low_confidence", "Low-confidence"],
  ["ambiguous", "Ambiguous"], ["not_quoted", "Not quoted"], ["references_prior", "Prior pricing"], ["excluded", "Excluded"],
];
const inr = (v: number) => Math.round(v).toLocaleString("en-IN");

/** DESIGN §2.6–2.8: sticky grid, vendor headers, state-rendered cells, lowest-eligible edge, legend. */
export function PricesGrid({ rfxId, grid, onOpen, selected, onBasis, approver }: { rfxId: string; grid: Grid; approver?: boolean; onOpen?: (line: number, vendor: string) => void; selected?: string | null; onBasis?: (b: "unit" | "landed") => void }) {
  const [view, setViewState] = useState<View>("unit");
  const setView = (v: View) => { setViewState(v); onBasis?.(v === "landed" ? "landed" : "unit"); };
  const [inclDq, setInclDq] = useState(false);
  const cellAt = useMemo(() => new Map(grid.cells.map((c) => [`${c.line_no}:${c.vendor}`, c])), [grid.cells]);
  const vendors = grid.vendors.filter((v) => inclDq || v.cleared !== false);
  const basis = view === "landed" ? "landed" : "unit";
  const price = (c: GridCell) => (basis === "landed" ? c.landed : c.unit);
  const eligible = (c: GridCell) => {
    const v = grid.vendors.find((x) => x.code === c.vendor)!;
    return (inclDq || v.cleared === true) && COUNTED.includes(c.state) && price(c) !== null;
  };
  const counts = grid.cells.reduce<Record<string, number>>((a, c) => ({ ...a, [c.state]: (a[c.state] ?? 0) + 1 }), {});

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          <button className={view === "unit" ? "on" : ""} onClick={() => setView("unit")}>Unit price</button>
          <button className={view === "landed" ? "on" : ""} onClick={() => setView("landed")}>Landed cost</button>
          <button className={view === "orig" ? "on" : ""} onClick={() => setView("orig")}>As written</button>
        </div>
        <label className="text-muted-foreground" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={inclDq} onChange={(e) => setInclDq(e.target.checked)} /> show disqualified vendors
        </label>
        <span style={{ flex: 1 }} />
        {approver && <AskButton />}
        {/* DESIGN §2.8 Export (TRD: XLSX/CSV); the workbook uses the basis on screen */}
        <DownloadButton href={`/api/export/comparison?rfx=${rfxId}&format=xlsx&basis=${basis}`}>Export</DownloadButton>
        <DownloadButton href={`/api/export/comparison?rfx=${rfxId}&format=csv&basis=${basis}`} variant="ghost" size="sm">CSV</DownloadButton>
      </div>
      <div className="gridbox">
        <table className="cmp">
          <thead>
            <tr>
              <th className="line"><div className="vh"><div className="nm">Line</div><div className="m">{view === "orig" ? "as the vendor wrote it · units differ" : `₹ per 1000 pcs · ${basis === "landed" ? "landed" : "unit price"}`}</div></div></th>
              {vendors.map((v) => (
                <th key={v.code}>
                  <div className="vh">
                    <div className="nm">{v.name}<span className={`chip ${v.cleared === true ? "green" : v.cleared === false ? "red" : "amber"}`} title={v.cleared_note}>{v.cleared === true ? "✓" : v.cleared === false ? "✗" : "?"}</span></div>
                    <div className="m">
                      <span className="mono">{v.priced}/{grid.lines.length} priced</span>
                    </div>
                    <Conditions list={v.conditions} />
                    <div className="tot">{inrShort(basis === "landed" ? v.total_landed : v.total_unit)} a year{view === "orig" ? " at unit price" : ""}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.lines.map((l) => {
              const row = vendors.map((v) => cellAt.get(`${l.line_no}:${v.code}`));
              const prices = row.filter((c): c is GridCell => !!c && eligible(c)).map((c) => price(c)!);
              const min = prices.length ? Math.min(...prices) : null;
              return (
                <tr key={l.id}>
                  <td className="line">
                    <div className="d"><span className="mono text-muted-foreground" style={{ fontSize: 11 }}>{String(l.line_no).padStart(2, "0")}</span> {l.description}</div>
                    <div className="s">{l.sku} · {inr(l.annual_qty)}/yr · {l.delivery_location}</div>
                  </td>
                  {row.map((c, i) => {
                    if (!c) return <td key={vendors[i].code}><div className="cell">—</div></td>;
                    const isMin = view !== "orig" && min !== null && eligible(c) && price(c) === min; // as written mixes units: nothing to rank
                    const k = `${c.line_no}:${c.vendor}`;
                    return (
                      <td key={k}>
                        <div className={`cell ${c.state}${isMin ? " min" : ""}${selected === k ? " sel" : ""}`} data-tip={c.tip || undefined}
                          onClick={() => onOpen?.(c.line_no, c.vendor)} role="button" tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter") onOpen?.(c.line_no, c.vendor); }}>
                          <CellText c={c} view={view} price={price(c)} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="legend" style={{ margin: "10px 0 20px" }}>
        {LEGEND.map(([s, label]) => <span key={s}><i className={`sw cell ${s}`} />{label} <span className="mono">{counts[s] ?? 0}</span></span>)}
        {!!counts.conflict && <span><i className="sw cell conflict" />Conflict <span className="mono">{counts.conflict}</span></span>}
        <span className="hint">· hover a cell for its source, click for the chain · {view === "orig" ? "vendors\u2019 own units, not comparable — switch to Unit price to rank" : "teal edge = lowest eligible on the line"}</span>
      </div>
    </>
  );
}

function CellText({ c, view, price }: { c: GridCell; view: View; price: number | null }) {
  if (view === "orig" && c.original?.value != null) {
    return <>{money(c.original.value, c.original.currency?.match(/\$|usd/i) ? "USD" : "INR")}<span className="flag">{c.original.unit}</span></>;
  }
  switch (c.state) {
    case "ambiguous": return <><span className="flag">{c.best_guess !== null ? `${inr(c.best_guess)}?` : "?"}</span><span className="flag">unit</span></>;
    case "low_confidence": return <><span className="flag">{c.best_guess !== null ? `${inr(c.best_guess)}?` : "?"}</span><span className="flag">read</span></>;
    case "not_quoted": return <>not quoted</>;
    case "references_prior": return <>prior pricing</>;
    case "conflict": return <>{c.best_guess !== null ? `${inr(c.best_guess)}?` : "?"}</>;
    default: return <>{price !== null ? inr(price) : "—"}</>;
  }
}
