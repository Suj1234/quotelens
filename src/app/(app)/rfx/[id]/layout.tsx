import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getRfx } from "@/lib/rfx-detail";
import { longDate, shortDate } from "@/lib/format";
import { RfxTabs } from "@/components/rfx/rfx-tabs";

const LABEL = { draft: "Draft", issued: "Issued", receiving: "Receiving", reviewing: "Reviewing", awarded: "Awarded", closed: "Closed" };

// DESIGN.md §2.3. Tabs appear as their screens are built (Overview P5, Review/Comparison P3, Award P7).
export default async function RfxLayout({ children, params }: LayoutProps<"/rfx/[id]">) {
  await requireUser();
  const { id } = await params;
  const rfx = await getRfx(id);
  return (
    <>
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
        </div>
        <RfxTabs id={id} tabs={[{ slug: "responses", label: "Responses" }, { slug: "comparison", label: "Comparison" }]} />
      </div>
      {children}
    </>
  );
}
