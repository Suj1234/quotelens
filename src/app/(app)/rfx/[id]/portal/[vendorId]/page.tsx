import { requireUser } from "@/lib/auth";
import { listComms } from "@/lib/comms";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { EmailBlock } from "@/components/comms/email-block";
import { PortalReply } from "@/components/comms/portal-reply";

// TRD §17.6 Vendor Portal Simulator (mock mode): the RFx as this vendor received it, and a reply box.
export default async function PortalPage({ params }: PageProps<"/rfx/[id]/portal/[vendorId]">) {
  await requireUser(["buyer", "admin"]);
  const { id, vendorId } = await params;
  const [{ data: v }, comms] = await Promise.all([
    db().from("vendors").select("name, email").eq("id", vendorId).maybeSingle(),
    listComms(id, { direction: "outbound", vendorId, kind: "rfx_dispatch" }),
  ]);
  const mail = comms.at(-1);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="eyebrow">Vendor portal (mock) · inbox of {v?.name ?? "vendor"}</div>
      <p className="lead" style={{ marginTop: 6 }}>This is what <b>{v?.name ?? "the vendor"}</b> received. Reply as them — attach their quotation in any format or paste their email.</p>
      {!mail ? (
        <div className="empty" style={{ marginTop: 16 }}><b>Nothing sent to {v?.name ?? "this vendor"} yet.</b> Issue the RFx and its email appears here.</div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="hd"><b>From Sujit Menon</b><span className="hint mono">{dateTime(mail.at)}</span></div>
            <div className="bd"><EmailBlock c={mail} /></div>
          </div>
          <PortalReply rfxId={id} vendorId={vendorId} vendorName={v?.name ?? "Vendor"} subject={mail.subject ?? ""} />
        </>
      )}
    </div>
  );
}
