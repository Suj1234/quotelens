import type { Comm } from "@/lib/comms";

/** DESIGN §2.16 email block: header grid (64px labels) + pre-wrapped body + attachment links. */
export function EmailBlock({ c }: { c: Comm }) {
  return (
    <div className="email">
      <div className="h">
        <span>From</span><b>{c.from ?? "—"}</b>
        <span>To</span><b>{c.to ?? "—"}</b>
        {c.reply_to && <><span>Reply-To</span><b className="mono" style={{ fontWeight: 400 }}>{c.reply_to}</b></>}
        <span>Subject</span><b>{c.subject ?? "—"}</b>
        {c.attachments.length > 0 && <><span>Attached</span><span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.attachments.map((a) => a.url
          ? <a key={a.name} href={a.url} download={a.name} className="mono" style={{ fontSize: 12 }}>{a.name}</a>
          : <span key={a.name} className="mono" style={{ fontSize: 12 }}>{a.name}</span>)}</span></>}
      </div>
      <div className="b">{c.body ?? ""}</div>
    </div>
  );
}
