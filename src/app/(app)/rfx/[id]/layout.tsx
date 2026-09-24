import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getRfx } from "@/lib/rfx-detail";
import { db } from "@/lib/db";
import { longDate, shortDate } from "@/lib/format";
import { RfxTabs } from "@/components/rfx/rfx-tabs";
import { AskButton, AskProvider } from "@/components/ask/ask-sheet";
import { SyncInboxButton } from "@/components/comms/sync-inbox";

const LABEL = { draft: "Draft", issued: "Issued", receiving: "Receiving", reviewing: "Reviewing", awarded: "Awarded", closed: "Closed" };

// DESIGN.md §2.3. Tabs appear as their screens are built (Award P7; the approver's Decide P7 / open question).
export default async function RfxLayout({ children, params }: LayoutProps<"/rfx/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [rfx, { count: openItems }, { data: inv }, { data: resp }] = await Promise.all([
    getRfx(id), db().from("review_items").select("id", { count: "exact", head: true }).eq("rfx_id", id).eq("status", "open"),
    db().from("rfx_vendors").select("vendor_id").eq("rfx_id", id),
    db().from("responses").select("vendor_id").eq("rfx_id", id).eq("is_clarification", false).not("vendor_id", "is", null),
  ]);
  const invited = inv?.length ?? 0;
  const responded = new Set((resp ?? []).map((r) => r.vendor_id)).size;
  // DESIGN §2.3 meta: "Reviewing · 5 of 5 responded", "Issued — awaiting 5 responses"
  const statusText = rfx.status === "draft" || rfx.status === "awarded" || rfx.status === "closed" ? LABEL[rfx.status]
    : responded === 0 ? `${LABEL[rfx.status]} — awaiting ${invited} responses` : `${LABEL[rfx.status]} · ${responded} of ${invited} responded`;
  return (
    <AskProvider rfxId={id}>
      <div className="rfxhead">
        <div className="top">
          <div>
            <div className="code"><Link href="/rfx">{rfx.code} ▾</Link><span>{rfx.category}</span></div>
            <h1>{rfx.title}</h1>
            <div className="meta">
              <span className={`status ${rfx.status}`}>{statusText}</span>
              <span>·</span><span>{rfx.lines} lines</span>
              {rfx.frozen_at && <><span>·</span><span>v{rfx.version} frozen {shortDate(rfx.frozen_at)}</span></>}
              {rfx.response_deadline && <><span>·</span><span>Deadline {longDate(rfx.response_deadline)}</span></>}
            </div>
          </div>
          {/* DESIGN §2.3: header buttons are the buyer's (Sync inbox · Ask); the approver asks from the Comparison toolbar. */}
          {user.role !== "approver" && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{rfx.status !== "draft" && <SyncInboxButton rfxId={id} />}<AskButton /></div>}
        </div>
        {/* DESIGN §4: the approver's tabs are Decide · Comparison · Award (Decide/Award arrive in P7); the buyer's Overview (P5) and Award (P7) likewise. */}
        <RfxTabs id={id} tabs={user.role === "approver"
          ? [{ slug: "comparison", label: "Comparison" }]
          : [{ slug: "overview", label: "Overview" }, { slug: "responses", label: "Responses" }, { slug: "review", label: "Review", count: openItems ?? 0 }, { slug: "comparison", label: "Comparison" }]} />
      </div>
      {children}
    </AskProvider>
  );
}
