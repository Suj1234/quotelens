import type { Comm } from "@/lib/comms";

/** DESIGN §2.16 email block: header grid (64px labels) + pre-wrapped body + attachments as file chips below it. */
export function EmailBlock({ c }: { c: Pick<Comm, "from" | "to" | "subject" | "body" | "attachments"> & { reply_to?: string | null } }) {
  return (
    <div className="email">
      <div className="h">
        <span>From</span><b>{c.from?.replaceAll('"', "") ?? "—"}</b>
        <span>To</span><b>{c.to ?? "—"}</b>
        {c.reply_to && <><span>Reply-To</span><b className="mono" style={{ fontWeight: 400 }}>{c.reply_to}</b></>}
        <span>Subject</span><b>{c.subject ?? "—"}</b>
      </div>
      {c.body ? <div className="b">{c.body}</div> : null}
      {c.attachments.length > 0 && (
        <div className="att">
          {c.attachments.map((a) => (
            <div className="filerow" key={a.name}>
              <span className="ext">{a.name.split(".").pop()?.toUpperCase()}</span>
              <span className="mono">{a.name}</span>
              {a.url && <a href={a.url} download={a.name} style={{ fontSize: 12 }}>Download</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
