import Link from "next/link";
import type { DocRow, TimelineRow } from "@/lib/rfx-tabs";
import { shortDate } from "@/lib/format";

export const CMP_TABS = ["prices", "questionnaire", "documents", "ledger", "timeline"] as const;
export type CmpTab = (typeof CMP_TABS)[number];

/** DESIGN §2.8 row 1: Prices · Questionnaire · Documents · Ledger · Timeline. */
export function CmpTabs({ rfxId, tab }: { rfxId: string; tab: CmpTab }) {
  return (
    <nav className="tabs" style={{ marginBottom: 10 }}>
      {CMP_TABS.map((t) => <Link key={t} href={`/rfx/${rfxId}/comparison${t === "prices" ? "" : `?tab=${t}`}`} className={t === tab ? "active" : undefined}>{t[0].toUpperCase() + t.slice(1)}</Link>)}
    </nav>
  );
}

export function DocumentsTab({ docs }: { docs: DocRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <table className="t">
        <thead><tr><th>Vendor</th><th>File</th><th>Kind</th><th>Pages</th><th>Used for</th></tr></thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i}>
              <td>{d.vendor}</td>
              <td className="mono" style={{ fontSize: 11.5 }}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{d.file}</a> : d.file}</td>
              <td><span className={`chip ${d.kind === "quotation" ? "teal" : d.kind === "unknown" ? "amber" : "grey"}`}>{d.kind.replace("_", " ")}</span></td>
              <td className="text-muted-foreground">{d.pages}</td>
              <td className="text-muted-foreground">{d.used}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && <div className="bd"><div className="empty"><b>No documents yet.</b> Files appear here as vendors reply.</div></div>}
    </div>
  );
}

export function TimelineTab({ rows }: { rows: TimelineRow[] }) {
  if (!rows.length) return <div className="empty"><b>Nothing has happened yet.</b> Replies, pipeline runs and your decisions are logged here.</div>;
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="bd tl">
        {rows.map((r, i) => (
          <div className="ev" key={i}>
            <span className="ts">{shortDate(r.at)} {new Date(r.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>
            <span className="dir">{r.dir}</span>
            <div>{r.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
