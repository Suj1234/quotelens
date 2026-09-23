"use client";

import { useState } from "react";
import type { LedgerRow } from "@/lib/rfx-tabs";

/** DESIGN §3.7 Ledger: Kind · Vendor · Lines · Assumption · Basis · By, with a kind / vendor filter (TRD §17.9). */
export function LedgerTab({ rows }: { rows: LedgerRow[] }) {
  const [kind, setKind] = useState(""); const [vendor, setVendor] = useState("");
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!vendor || r.vendor === vendor));
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="hd">
        <b>Assumptions <span className="mono text-muted-foreground">{shown.length}</span></b>
        <span style={{ display: "flex", gap: 8 }}>
          <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{[...new Set(rows.map((r) => r.kind))].map((k) => <option key={k} value={k}>{k}</option>)}</select>
          <select className="sel" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="">All vendors</option>{[...new Set(rows.map((r) => r.vendor))].map((v) => <option key={v}>{v}</option>)}</select>
        </span>
      </div>
      <table className="t">
        <thead><tr><th>Kind</th><th>Vendor</th><th>Lines</th><th>Assumption</th><th>Basis</th><th>By</th></tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <td className="mono" style={{ fontSize: 11.5 }}>{r.kind}</td><td>{r.vendor}</td><td className="mono">{r.lines}</td>
              <td style={{ maxWidth: 460 }}>{r.description}</td><td className="text-muted-foreground">{r.basis}</td><td className="text-muted-foreground">{r.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!shown.length && <div className="bd"><div className="empty"><b>No assumptions yet.</b> Every conversion that isn&apos;t vendor-stated lands here.</div></div>}
    </div>
  );
}
