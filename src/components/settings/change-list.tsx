import Link from "next/link";
import type { TimelineRow } from "@/lib/rfx-tabs";
import { dateTime } from "@/lib/format";

/** The latest changes to one sub-tab (settings, masters and vendors belong to no RFx), with a link to the full Audit log. */
export function ChangeList({ rows, empty }: { rows: TimelineRow[]; empty: string }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="hd"><b>Change history</b><Link href="/settings/activity?tab=audit&rfx=workspace" style={{ fontSize: 12 }}>Full audit log</Link></div>
      {rows.length ? (
        <div className="tl" style={{ padding: "4px 14px" }}>
          {rows.slice(0, 8).map((r, i) => <div className="ev" key={i}><span className="ts mono">{dateTime(r.at)}</span><span className="dir" /><span>{r.text}</span></div>)}
        </div>
      ) : <div className="bd hint">{empty}</div>}
    </div>
  );
}
