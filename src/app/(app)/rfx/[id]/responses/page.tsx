import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listVendorResponses } from "@/lib/rfx-detail";
import { countWord, shortDate } from "@/lib/format";
import { ext, formatLabel } from "@/lib/file-labels";
import { Button } from "@/components/ui/button";
import { LoadSeed } from "@/components/rfx/load-seed";
import { AssignVendor } from "@/components/rfx/assign-vendor";
import { getUnmatchedResponses } from "@/lib/unmatched";
import { db } from "@/lib/db";
import { STAGES } from "@/types/db";

export default async function ResponsesPage({ params }: PageProps<"/rfx/[id]/responses">) {
  const user = await requireUser();
  const buyer = user.role !== "approver";
  const { id } = await params;
  const [rows, strays, { data: allVendors }] = await Promise.all([listVendorResponses(id), getUnmatchedResponses(id), db().from("vendors").select("id, name").order("name")]);
  const replied = rows.filter((r) => r.response).length;
  const running = rows.filter((r) => r.response && STAGES.some((s) => r.response!.pipeline_status[s] === "running")).length;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <p className="lead">
          {replied === rows.length
            ? <><b>All {countWord(rows.length).toLowerCase()}</b> vendors have replied</>
            : <><b>{replied} of {rows.length}</b> vendors have replied</>}
          {running ? `, ${countWord(running).toLowerCase()} still processing` : ""}.
          {replied > 0 && " Open one to see what was read and where."}
        </p>
        {buyer && replied > 0 && <LoadSeed rfxId={id} />}
      </div>

      {replied === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <p><b>No responses yet.</b></p>
          <p style={{ margin: "4px 0 14px" }}>Load the five sample replies from the dataset to run them through the pipeline.</p>
          {buyer && <div style={{ display: "inline-flex" }}><LoadSeed rfxId={id} primary /></div>}
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          {rows.map((r) => (
            <div className="vrow" key={r.vendor_id}>
              <div>
                <div className="nm">{r.name}</div>
                <div className="sub">{r.city}{r.response ? ` · ${formatLabel(r.response.files, !!r.response.email_text)}` : ""}</div>
              </div>
              <div className="sub">
                {r.response
                  ? <>received {shortDate(r.response.received_at)} · <span className="mono">{r.response.priced}</span> prices read{r.more_replies ? ` · +${r.more_replies} more ${r.more_replies === 1 ? "reply" : "replies"} (Documents tab)` : ""}</>
                  : "no reply yet"}
              </div>
              <div className="sub">
                {r.response?.files.map((f) => (
                  <span key={f.id} className={`chip ${f.file_kind === "quotation" ? "teal" : "grey"}`} style={{ margin: "2px 2px 2px 0" }}>{ext(f.original_name)}</span>
                ))}
                {r.response?.email_text && (
                  <span className={`chip ${(r.response.summary.classify as { email?: { kind: string } } | undefined)?.email?.kind === "quotation" ? "teal" : "grey"}`} style={{ margin: "2px 2px 2px 0" }}>EMAIL</span>
                )}
              </div>
              <div className="sub" />
              <div>
                {r.response && <Button asChild size="sm"><Link href={`/rfx/${id}/responses/${r.response.id}`}>Open</Link></Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {strays.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="hd"><b>Unmatched senders <span className="mono text-muted-foreground">{strays.length}</span></b><span className="hint">replies we couldn&apos;t tie to a vendor — pricing waits until you assign one</span></div>
          {strays.map((s) => (
            <div className="vrow" key={s.id}>
              <div><div className="nm">{s.from ?? "Unknown sender"}</div><div className="sub">{s.source.replace("_", " ")} · received {shortDate(s.received_at)}</div></div>
              <div className="sub">{s.files.join(", ") || (s.email ? "email body" : "—")}</div>
              <div className="sub"><span className="mono">{s.items}</span> items read</div>
              <div className="sub" />
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {buyer && <AssignVendor responseId={s.id} vendors={allVendors ?? []} />}
                <Button asChild size="sm"><Link href={`/rfx/${id}/responses/${s.id}`}>Open</Link></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
