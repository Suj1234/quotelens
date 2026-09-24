import { requireUser } from "@/lib/auth";
import { listComms } from "@/lib/comms";
import { countWord } from "@/lib/format";
import { OutboxList } from "@/components/comms/outbox-list";

// TRD §15.2 mock mode Outbox: every outbound email with its attachments (PRD §14 screen 5).
export default async function OutboxPage({ params }: PageProps<"/rfx/[id]/outbox">) {
  await requireUser(["buyer", "admin"]);
  const { id } = await params;
  const comms = await listComms(id, { direction: "outbound" });
  const sent = comms.filter((c) => c.status === "sent").length;
  return (
    <div className="page">
      <p className="lead">
        {comms.length ? <><b>{countWord(sent)} {sent === 1 ? "email" : "emails"}</b> sent{comms.length > sent ? `, ${comms.length - sent} not sent` : ""}. In mock mode nothing leaves the system — open one to read it as the vendor will, or reply from the vendor portal.</> : <>Nothing sent yet. Issue the RFx and its dispatch emails appear here.</>}
      </p>
      {comms.length > 0 && <div style={{ marginTop: 16 }}><OutboxList comms={comms} /></div>}
    </div>
  );
}
