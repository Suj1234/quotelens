import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listComms } from "@/lib/comms";
import { dateTime } from "@/lib/format";
import { getTimeline } from "@/lib/rfx-tabs";
import { TimelineTab } from "@/components/compare/tabs";

// Audit trail tab: Emails = every send and receive (moved off the Overview); Activity = what happened to the data —
// replies processed, stages failed, the buyer's decisions (was the Comparison's Timeline tab). DECISIONS 2026-09-25.
export default async function AuditPage({ params, searchParams }: PageProps<"/rfx/[id]/audit">) {
  await requireUser(["buyer", "admin"]);
  const { id } = await params;
  const activity = (await searchParams).view === "activity";
  const nav = (
    <nav className="tabs" style={{ marginBottom: 10 }}>
      <Link href={`/rfx/${id}/audit`} className={activity ? undefined : "active"}>Emails</Link>
      <Link href={`/rfx/${id}/audit?view=activity`} className={activity ? "active" : undefined}>Activity</Link>
    </nav>
  );
  if (activity) return <div className="page read">{nav}<TimelineTab rows={await getTimeline(id)} /></div>;
  const comms = await listComms(id);
  return (
    <div className="page read">
      {nav}
      <div className="card">
        <div className="hd"><b>Audit trail</b><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="hint">every send and receive, with ids</span>{comms.some((c) => c.direction === "outbound") && <Link href={`/rfx/${id}/outbox`} style={{ fontSize: 12 }}>Outbox</Link>}</span></div>
        <div className="bd tl">
          {comms.length === 0 && <div className="text-muted-foreground" style={{ fontSize: 12 }}>No emails yet.</div>}
          {comms.map((c) => {
            // The email this one answers (In-Reply-To), linked to its row in this timeline.
            const answers = c.in_reply_to ? comms.find((x) => x.message_id === c.in_reply_to) : null;
            const files = c.attachments.map((a) => a.url ? <a key={a.name} href={a.url} download={a.name} className="mono" style={{ fontSize: 11.5 }}>{a.name}</a> : <span key={a.name} className="mono" style={{ fontSize: 11.5 }}>{a.name}</span>);
            return (
              <div className="ev" key={c.id} id={`comm-${c.id}`}>
                <span className="ts">{dateTime(c.at)}</span>
                <span className="dir">{c.direction === "outbound" ? "→" : "←"}</span>
                <div>
                  <div>{c.direction === "outbound" ? `${c.vendor ?? c.to} · ${c.subject ?? ""}` : `${c.vendor ?? c.from ?? "Unknown sender"} · ${c.subject ?? (c.kind === "vendor_reply" ? "reply" : c.kind)}`}</div>
                  <div className="text-muted-foreground" style={{ fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>{files.length ? files : c.direction === "inbound" ? <span>email body only</span> : null}</div>
                  <div className="text-muted-foreground" style={{ fontSize: 11 }}>
                    {c.kind.replace("_", " ")} · {c.mode} · {c.status}{c.message_id ? <> · <span className="mono">{c.message_id}</span></> : null}
                    {c.in_reply_to && <> · in reply to {answers ? <a href={`#comm-${answers.id}`}>{answers.direction === "outbound" ? "our" : "their"} {answers.kind === "clarification" ? "clarification" : answers.kind === "rfx_dispatch" ? "RFx email" : "email"} of {dateTime(answers.at)}</a> : <span className="mono">{c.in_reply_to}</span>}</>}
                    {c.response_id && <> · <Link href={`/rfx/${id}/responses/${c.response_id}`}>response</Link></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
