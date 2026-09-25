import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listVendorResponses } from "@/lib/rfx-detail";
import { countWord, shortDate } from "@/lib/format";
import { ext, formatLabel } from "@/lib/file-labels";
import { Button } from "@/components/ui/button";
import { LoadSeed } from "@/components/rfx/load-seed";
import { AssignVendor } from "@/components/rfx/assign-vendor";
import { AddResponse } from "@/components/rfx/add-response";
import { isLocked } from "@/lib/lock";
import { getUnmatchedResponses } from "@/lib/unmatched";
import { db } from "@/lib/db";
import { outstandingClarifications } from "@/lib/clarify";
import { STAGES } from "@/types/db";

export default async function ResponsesPage({ params }: PageProps<"/rfx/[id]/responses">) {
  const user = await requireUser();
  const { id } = await params;
  const buyer = user.role !== "approver" && !(await isLocked(id)); // DESIGN §4 + PRD #33: no adding or re-running once awarded
  const [rows, strays, { data: allVendors }, { data: status }, clars, { data: clarReplies }] = await Promise.all([
    listVendorResponses(id), getUnmatchedResponses(id), db().from("vendors").select("id, name").order("name"),
    db().from("v_vendor_status").select("vendor_id, lines_priced, lines_total, cleared_questionnaire").eq("rfx_id", id),
    outstandingClarifications(id),
    db().from("responses").select("id, vendor_id, received_at").eq("rfx_id", id).eq("is_clarification", true).order("received_at"),
  ]);
  const clarOf = (vid: string) => (clarReplies ?? []).filter((c) => c.vendor_id === vid);
  const st = (vid: string) => status?.find((x) => x.vendor_id === vid);
  const replied = rows.filter((r) => r.response).length;
  const running = rows.filter((r) => r.response && STAGES.some((s) => r.response!.pipeline_status[s] === "running")).length;
  const unprocessed = rows.filter((r) => r.response && STAGES.some((s) => r.response!.pipeline_status[s] !== "done")).length;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        {/* DESIGN §3.5: "Five responses in, all processed. Open one to see what was read and where, or add a response by hand — …" (counts computed) */}
        <p className="lead">
          {replied === 0 ? <><b>No responses yet</b> from the {countWord(rows.length).toLowerCase()} invited vendors.</>
            : <><b>{countWord(replied)} {replied === 1 ? "response" : "responses"} in</b>{replied < rows.length ? ` of ${rows.length}` : ""}, {unprocessed === 0 ? "all processed" : running ? `${countWord(running).toLowerCase()} still processing` : `${countWord(unprocessed).toLowerCase()} not fully processed`}.</>}
          {" "}Open one to see what was read and where, or add a response by hand — it runs through the same six stages as a Gmail reply.
        </p>
        {buyer && replied > 0 && <LoadSeed rfxId={id} />}
      </div>

      {replied === 0 && buyer && (
        <div className="empty" style={{ marginTop: 16 }}>
          <p><b>No responses yet.</b></p>
          <p style={{ margin: "4px 0 14px" }}>Add a reply by hand on a vendor&apos;s row, or load the five sample replies from the dataset.</p>
          <div style={{ display: "inline-flex" }}><LoadSeed rfxId={id} primary /></div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          {rows.map((r) => (
            <div className="vrow" key={r.vendor_id}>
              <div>
                <div className="nm">{r.name}</div>
                <div className="sub">{r.city}{r.response ? ` · ${formatLabel(r.response.files, !!r.response.email_text)}` : ""}</div>
              </div>
              <div className="sub">
                {r.response
                  ? STAGES.some((s) => r.response!.pipeline_status[s] === "running") ? <span className="chip teal">Processing…</span>
                    : <>received {shortDate(r.response.received_at)} · <span className="mono">{st(r.vendor_id)?.lines_priced ?? 0}/{st(r.vendor_id)?.lines_total ?? 0}</span> priced{r.more_replies ? ` · +${r.more_replies} more ${r.more_replies === 1 ? "reply" : "replies"} (Documents tab)` : ""}
                      {clarOf(r.vendor_id).map((c) => <span key={c.id}> · <Link href={`/rfx/${id}/responses/${c.id}`}>clarification reply {shortDate(c.received_at)}</Link></span>)}</>
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
              <div className="sub">{r.response && (() => { const c = st(r.vendor_id)?.cleared_questionnaire; return c === true ? <span className="chip green">Cleared</span> : c === false ? <span className="chip red">Not cleared</span> : <span className="chip amber">Questionnaire pending</span>; })()}</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                {r.response && <Button asChild size="sm"><Link href={`/rfx/${id}/responses/${r.response.id}`}>Open</Link></Button>}
                {buyer && <AddResponse rfxId={id} vendorId={r.vendor_id} vendorName={r.name} clarification={clars.get(r.vendor_id) ?? null} />}
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
