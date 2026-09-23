import Link from "next/link";
import type { DocRow, QaGrid, TimelineRow } from "@/lib/rfx-tabs";
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

/** DESIGN §3.7: 10 rows × vendors, ◆ disqualifying, red "No", amber for unclear / "—". */
export function QuestionnaireTab({ qa }: { qa: QaGrid }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ overflow: "auto" }}>
        <table className="t">
          <thead><tr><th>#</th><th>Question</th>{qa.vendors.map((v) => <th key={v.code}>{v.name}</th>)}</tr></thead>
          <tbody>
            {qa.rows.map((r) => (
              <tr key={r.q_no}>
                <td className="mono text-muted-foreground">Q{r.q_no}{r.disqualifying ? " ◆" : ""}</td>
                <td style={{ maxWidth: 360 }}>{r.text}</td>
                {qa.vendors.map((v) => {
                  const a = r.answers[v.code];
                  return <td key={v.code} title={a?.tip}>{!a ? <span className="hint">not read</span> : a.tone ? <span className={`chip ${a.tone}`}>{a.show}</span> : a.show}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bd hint">◆ disqualifying · amber = unclear or not answered · hover an answer for the vendor&apos;s words and the probability</div>
    </div>
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
