import Link from "next/link";
import type { DocRow, TimelineRow } from "@/lib/rfx-tabs";
import { cap, dateTime } from "@/lib/format";
import { OpenFile } from "./open-file";

export const CMP_TABS = ["prices", "questionnaire", "documents", "ledger"] as const; // Timeline moved to the Audit trail tab (Activity)
export type CmpTab = (typeof CMP_TABS)[number];

/** DESIGN §2.8 row 1: Prices · Questionnaire · Documents · Ledger (Timeline → Audit trail · Activity). */
export function CmpTabs({ rfxId, tab }: { rfxId: string; tab: CmpTab }) {
  return (
    <nav className="tabs" style={{ marginBottom: 10 }}>
      {CMP_TABS.map((t) => <Link key={t} href={`/rfx/${rfxId}/comparison${t === "prices" ? "" : `?tab=${t}`}`} className={t === tab ? "active" : undefined}>{t[0].toUpperCase() + t.slice(1)}</Link>)}
    </nav>
  );
}

/** Every file and email body vendors sent: opens in the viewer; "Used for" goes to the reply, where each extracted item shows its source. */
export function DocumentsTab({ rfxId, docs }: { rfxId: string; docs: DocRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <table className="t">
        <thead><tr><th>Vendor</th><th>Received</th><th>File</th><th>Kind</th><th>Pages</th><th>Used for</th></tr></thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i} style={i && docs[i - 1].vendor !== d.vendor ? { borderTop: "2px solid var(--hair)" } : undefined}>
              <td>{docs[i - 1]?.vendor === d.vendor ? "" : d.vendor}</td>
              <td className="text-muted-foreground" style={{ whiteSpace: "nowrap" }}>{docs[i - 1]?.response_id === d.response_id ? "" : <>{dateTime(d.at)} · {d.reply}</>}</td>
              <td className="mono" style={{ fontSize: 11.5 }}>{d.url || d.text ? <OpenFile url={d.url} text={d.text ?? undefined} name={d.text ? "Email body" : d.file} label={d.file} /> : d.file}</td>
              <td><span className={`chip ${d.kind === "quotation" ? "teal" : d.kind === "unknown" ? "amber" : "grey"}`}>{cap(d.kind)}</span></td>
              <td className="text-muted-foreground">{d.pages}</td>
              <td><Link href={`/rfx/${rfxId}/responses/${d.response_id}`} className="linkish">{d.used}</Link></td>
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
            <span className="ts">{dateTime(r.at)}</span>
            <span className="dir">{r.dir}</span>
            <div>{r.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
