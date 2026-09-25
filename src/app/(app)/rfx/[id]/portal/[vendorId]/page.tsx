import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { vendorInbox } from "@/lib/email/mailbox";
import { dateTime } from "@/lib/format";
import { EmailBlock } from "@/components/comms/email-block";
import { PortalReply } from "@/components/comms/portal-reply";

// TRD §17.6 Vendor Portal Simulator, now the vendor's mock mailbox (P6): every email we sent them, newest first,
// each with the vendor's replies under it and Reply. A reply waits unread until the buyer syncs the inbox — the same path a Gmail reply would take.
export default async function PortalPage({ params }: PageProps<"/rfx/[id]/portal/[vendorId]">) {
  await requireUser(["buyer", "admin"]);
  const { id, vendorId } = await params;
  const [{ data: v }, inbox] = await Promise.all([db().from("vendors").select("name, email").eq("id", vendorId).maybeSingle(), vendorInbox(id, vendorId)]);
  const name = v?.name ?? "the vendor";
  return (
    <div className="page">
      <div className="eyebrow">Vendor portal (mock) · mailbox of {name}{v?.email ? ` · ${v.email}` : ""}</div>
      <p className="lead" style={{ marginTop: 6 }}>
        {inbox.length ? <><b>{inbox.length} {inbox.length === 1 ? "email" : "emails"}</b> from Meridian Foods in {name}&apos;s mailbox. Reply as them — the reply waits in the buyer&apos;s inbox until someone clicks Sync inbox.</> : <>Nothing in {name}&apos;s mailbox yet.</>}
      </p>
      {!inbox.length && <div className="empty" style={{ marginTop: 16 }}><b>Nothing sent to {name} yet.</b> Issue the RFx or ask them a clarification and the email appears here.</div>}
      {inbox.map((m) => (
        <div className="card" style={{ marginTop: 16 }} key={m.id}>
          <div className="hd">
            <b>From Sujit Menon · {m.kind === "clarification" ? "clarification" : m.kind === "rfx_dispatch" ? "RFx" : m.kind.replace("_", " ")}</b>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>{m.replies.length > 0 && <span className="chip green">Replied</span>}<span className="hint mono">{dateTime(m.at)}</span></span>
          </div>
          <div className="bd">
            <EmailBlock c={m} />
            {m.replies.map((rp) => (
              <div className="sentreply" key={rp.id}>
                <div className="eyebrow">Your reply · {dateTime(rp.at)} · {rp.seen ? "collected by the buyer" : "waiting for the buyer to sync"}</div>
                <EmailBlock c={rp} />
              </div>
            ))}
            <PortalReply rfxId={id} vendorId={vendorId} vendorName={v?.name ?? "Vendor"} mailboxId={m.mailbox_id} subject={m.subject ?? ""} to={m.reply_to ?? m.from ?? ""} again={m.replies.length > 0} />
          </div>
        </div>
      ))}
    </div>
  );
}
