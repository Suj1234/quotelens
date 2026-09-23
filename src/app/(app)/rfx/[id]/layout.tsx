import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getRfx } from "@/lib/rfx-detail";
import { db } from "@/lib/db";
import { longDate, shortDate } from "@/lib/format";
import { RfxTabs } from "@/components/rfx/rfx-tabs";
import { AskButton, AskProvider } from "@/components/ask/ask-sheet";

const LABEL = { draft: "Draft", issued: "Issued", receiving: "Receiving", reviewing: "Reviewing", awarded: "Awarded", closed: "Closed" };

// DESIGN.md §2.3. Tabs appear as their screens are built (Overview P5, Review/Comparison P3, Award P7).
export default async function RfxLayout({ children, params }: LayoutProps<"/rfx/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [rfx, { count: openItems }] = await Promise.all([getRfx(id), db().from("review_items").select("id", { count: "exact", head: true }).eq("rfx_id", id).eq("status", "open")]);
  return (
    <AskProvider rfxId={id}>
      <div className="rfxhead">
        <div className="top">
          <div>
            <div className="code"><Link href="/rfx">{rfx.code} ▾</Link><span>{rfx.category}</span></div>
            <h1>{rfx.title}</h1>
            <div className="meta">
              <span className={`status ${rfx.status}`}>{LABEL[rfx.status]}</span>
              <span>·</span><span>{rfx.lines} lines</span>
              {rfx.frozen_at && <><span>·</span><span>v{rfx.version} frozen {shortDate(rfx.frozen_at)}</span></>}
              {rfx.response_deadline && <><span>·</span><span>Deadline {longDate(rfx.response_deadline)}</span></>}
            </div>
          </div>
          {/* DESIGN §2.3: header buttons are the buyer's; the approver asks from the Comparison toolbar. Sync inbox arrives with Gmail (P6). */}
          {user.role !== "approver" && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><AskButton /></div>}
        </div>
        {/* DESIGN §4: the approver's tabs are Decide · Comparison · Award (Decide/Award arrive in P7); the buyer's Overview (P5) and Award (P7) likewise. */}
        <RfxTabs id={id} tabs={user.role === "approver"
          ? [{ slug: "comparison", label: "Comparison" }]
          : [{ slug: "responses", label: "Responses" }, { slug: "review", label: "Review", count: openItems ?? 0 }, { slug: "comparison", label: "Comparison" }]} />
      </div>
      {children}
    </AskProvider>
  );
}
