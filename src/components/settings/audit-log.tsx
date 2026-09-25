"use client";

import { useRouter } from "next/navigation";
import type { TimelineRow } from "@/lib/rfx-tabs";
import { dateTime } from "@/lib/format";

/** Settings → Activity → Audit log: who changed what, when — settings, masters, vendors and every RFx. Filters live in the URL. */
export function AuditLog({ rows, rfx, users, f }: {
  rows: TimelineRow[]; rfx: { id: string; code: string }[]; users: { id: string; name: string }[]; f: { rfx: string; who: string };
}) {
  const router = useRouter();
  const code = new Map(rfx.map((r) => [r.id, r.code]));
  const go = (next: Partial<typeof f>) => {
    const qs = new URLSearchParams({ tab: "audit", ...Object.fromEntries(Object.entries({ ...f, ...next }).filter(([, v]) => v)) });
    router.push(`/settings/activity?${qs}`, { scroll: false });
  };
  return (
    <div className="card">
      <div className="hd">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="sel" aria-label="Where" value={f.rfx} onChange={(e) => go({ rfx: e.target.value })}>
            <option value="">Everything</option>
            <option value="workspace">Settings, masters and vendors</option>
            {rfx.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select>
          <select className="sel" aria-label="Who" value={f.who} onChange={(e) => go({ who: e.target.value })}>
            <option value="">Anyone</option>
            <option value="people">People only</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            <option value="system">QuoteLens (automatic)</option>
          </select>
        </div>
        <span className="hint">{rows.length} {rows.length === 1 ? "entry" : "entries"}{rows.length >= 500 ? " (latest 500 events)" : ""} · newest first · entries can&apos;t be edited or deleted</span>
      </div>
      {rows.length ? (
        <div className="bd tl audit">
          {rows.map((r, i) => (
            <div className="ev" key={i}>
              <span className="ts">{dateTime(r.at)}</span>
              <span className="mono xs muted">{r.rfx_id ? code.get(r.rfx_id) ?? "RFx" : "Workspace"}</span>
              <div>{r.text}</div>
            </div>
          ))}
        </div>
      ) : <div className="bd"><div className="empty"><b>Nothing matches.</b> Change a filter to see more.</div></div>}
    </div>
  );
}
