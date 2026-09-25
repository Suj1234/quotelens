import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOverview } from "@/lib/overview";
import { countWord, inrShort, longDate, shortDate, cap } from "@/lib/format";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { LoadSeed } from "@/components/rfx/load-seed";
import { ReadReplies } from "@/components/rfx/read-replies";
import { AssignVendor } from "@/components/rfx/assign-vendor";
import { RowLink } from "@/components/rfx/row-link";
import { Conditions } from "@/components/compare/conditions";

const word = (n: number) => countWord(n).toLowerCase();
// "Q6: No – BRC audit planned for Q1 2027 · Q3: …" → ["Q6", "Q3"] (only the labels, not a "Q1" inside an answer).
const failedQs = (note: string) => [...new Set(note.split(" · ").map((s) => s.match(/^Q\d+(?=:)/)?.[0]).filter((q): q is string => !!q))];

// DESIGN §3.4 Overview (buyer's default tab), one column: no Event card, the header carries its facts (DECISIONS.md). No buttons that duplicate the tabs (DESIGN §0.8).
export default async function OverviewPage({ params }: PageProps<"/rfx/[id]/overview">) {
  const user = await requireUser();
  const { id } = await params;
  if (user.role === "approver") redirect(`/rfx/${id}/decide`);
  const o = await getOverview(id);
  const r = o.rfx;
  const invited = o.vendors.length;
  const locked = r.status === "awarded";

  if (r.status === "draft") {
    return (
      <div className="page read">
        <div className="empty"><b>This RFx is still a draft.</b><div style={{ margin: "6px 0 12px", fontSize: 12.5 }}>Finish the lines, terms, questionnaire and vendors, then issue it.</div><Button asChild variant="default" size="sm"><Link href={`/rfx/new?id=${id}`}>Open in New RFx</Link></Button></div>
      </div>
    );
  }

  // Replies received but not through the six stages: nothing about them is known yet, so nothing may be called complete.
  const unread = o.vendors.filter((v) => v.reading && v.reading.state !== "read");
  // Waiting/processing replies need nobody; only a stopped or abandoned one gets a button.
  const busy = unread.filter((v) => v.reading!.state === "queued" || v.reading!.state === "reading");
  const stuck = unread.filter((v) => v.reading!.state === "failed" || v.reading!.state === "unread");
  const retryable = stuck.map((v) => v.responseId!);
  const days = o.lastReply && r.frozen_at ? Math.max(1, Math.ceil((new Date(o.lastReply).getTime() - new Date(r.frozen_at).getTime()) / 86_400_000)) : null;
  const { data: allVendors } = o.strays.length ? await db().from("vendors").select("id, name").order("name") : { data: [] };
  return (
    <div className="page read">
      <div className="eyebrow">Where this stands</div>
      <p className="lead" style={{ marginTop: 6 }}>
        {o.replied === 0 ? <>Issued {r.frozen_at ? longDate(r.frozen_at) : ""} to {word(invited)} vendors. <b>No replies yet</b>{r.response_deadline ? <> — the deadline is {longDate(r.response_deadline)}</> : null}. <Link href={`/rfx/${id}/outbox`}>View sent emails</Link>{o.mode === "mock" && !locked ? <span className="hint"> · reply as a vendor with Portal (mock) below</span> : null}</>
          : <>
            {o.replied === invited ? <>All {word(invited)} vendors replied{days ? ` within ${days === 1 ? "a day" : `${word(days)} days`}` : ""}. </> : <>{countWord(o.replied)} of {invited} vendors have replied. </>}
            {unread.length ? <>
              {busy.length > 0 && <><b>{busy.length === o.replied ? (o.replied === 1 ? "It is" : "All are") : `${countWord(busy.length)} ${busy.length === 1 ? "is" : "are"}`} being processed</b> — prices, questionnaire answers and flags appear as each one finishes.</>}
              {stuck.length > 0 && <> <b>{countWord(stuck.length)} {stuck.length === 1 ? "reply" : "replies"} couldn&apos;t be processed</b> — retry below.</>}
              {o.openItems ? <> <b>{o.openItems} {o.openItems === 1 ? "item" : "items"}</b> already {o.openItems === 1 ? "needs" : "need"} your call.</> : null}
            </> : <>
              {o.clearedCount ? `${countWord(o.clearedCount)} cleared the questionnaire. ` : "None has cleared the questionnaire yet. "}
              {o.openItems ? <><b>{o.openItems} {o.openItems === 1 ? "item needs" : "items need"}</b> your call before the grid is complete</> : <>Nothing needs your call</>}
              {o.covered ? <>; awarding each line to the cheapest qualified vendor currently comes to <b>{inrShort(o.cheapest)}</b> a year{o.covered < r.lines ? ` for ${o.covered} of ${r.lines} lines` : ""}{o.discounts.length ? (o.cheapest < o.cheapestQuoted - 0.5 ? ` after the discounts it earns (${inrShort(o.cheapestQuoted)} as quoted)` : `; ${o.discounts.length === 1 ? "the vendor discount on offer isn't" : "the vendor discounts on offer aren't"} earned by that split — see Decide / Award`) : ""}.</> : "."}
            </>}
          </>}
      </p>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="hd"><b>Needs you</b><span style={{ display: "flex", gap: 10, alignItems: "center" }}>{retryable.length > 1 && !locked && <ReadReplies ids={retryable} label={`Process all ${retryable.length}`} />}{o.openItems > 0 && <Link className="small" style={{ fontSize: 12 }} href={`/rfx/${id}/review`}>Open the queue</Link>}</span></div>
        {unread.length || o.needs.length
          ? <table className="t"><tbody>
            {unread.map((v) => {
              const rd = v.reading!;
              return <tr key={v.id}><td style={{ width: 190 }}><b>{v.name}</b></td><td><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>{rd.state === "reading" ? "Processing…" : rd.state === "queued" ? <span className="text-muted-foreground">Waiting — replies are processed two at a time</span> : rd.state === "failed" ? <>Stopped at {cap(rd.stage!)}{rd.error ? <span className="text-muted-foreground"> — {rd.error.slice(0, 90)}</span> : null}</> : "Not processed — nothing picked it up"}</span>
                {(rd.state === "failed" || rd.state === "unread") && !locked && <ReadReplies ids={[v.responseId!]} label={rd.state === "failed" ? "Retry" : "Process now"} />}
              </div></td></tr>;
            })}
            {o.needs.map((n, i) => <tr key={i}><td style={{ width: 190 }}>{i === 0 || o.needs[i - 1].vendor !== n.vendor ? <b>{n.vendor}</b> : null}</td><td>{n.text}</td></tr>)}
          </tbody></table>
          : <div className="bd text-muted-foreground" style={{ fontSize: 12 }}>{o.replied ? "Nothing pending — the grid is complete." : "Nothing yet — replies raise their questions here."}</div>}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="hd"><b>Vendors</b><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="hint">{o.mode === "mock" ? "Mock email" : o.mode === "gmail" ? "Gmail" : o.mode} · <Link href="/settings">change</Link> · click a row for the response</span>{o.mode === "mock" && !locked && <LoadSeed rfxId={id} />}</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead><tr><th>Vendor</th><th>Reply format</th><th>Received</th><th className="num">Priced</th><th>Valid to</th><th>Questionnaire</th><th className="num">Needs you</th><th /></tr></thead>
            <tbody>
              {o.vendors.map((v) => {
                const cells = <>
                  <td><b>{v.name}</b>{(v.status === "clarification_sent" || v.status === "clarified") && <> <span className={`chip ${v.status === "clarified" ? "green" : "amber"}`} style={{ height: 15 }}>{cap(v.status)}</span></>}<div className="text-muted-foreground" style={{ fontSize: 11 }}>{v.city ?? ""}</div><Conditions list={v.conditions} /></td>
                  <td className="text-muted-foreground">{v.sentAs ?? "—"}</td>
                  <td className="mono">{v.received ? shortDate(v.received) : "—"}</td>
                  <td className="num mono">{!v.received ? "—" : v.reading?.state === "read" ? `${v.priced}/${v.lines}` : <span className="text-muted-foreground">{v.reading?.state === "reading" ? "processing…" : v.reading?.state === "queued" ? "waiting" : v.reading?.state === "failed" ? "stopped" : "not processed"}</span>}</td>
                  <td className="mono">{v.validUntil ? shortDate(v.validUntil) : "—"}{v.validityShort && <> <span className="chip amber" style={{ height: 15 }}>{v.validityDays}d</span></>}</td>
                  <td>{v.received && v.reading && v.reading.state !== "read" ? <span className={`chip ${v.reading.state === "failed" ? "red" : "grey"}`}>{v.reading.state === "reading" ? "Processing…" : v.reading.state === "queued" ? "Waiting" : v.reading.state === "failed" ? `Stopped at ${cap(v.reading.stage!)}` : "Not processed"}</span> : !v.received ? <span className="chip grey">{v.status === "invited" ? "Awaiting reply" : v.status[0].toUpperCase() + v.status.slice(1).replace("_", " ")}</span> : v.cleared === true ? <span className="chip green">Cleared</span> : v.cleared === false ? <span className="chip red" title={v.clearedNote}>{failedQs(v.clearedNote).length ? `Failed ${failedQs(v.clearedNote).join(", ")}` : "Not cleared"}</span> : <span className="chip amber" title={v.clearedNote}>{(v.clearedNote.split(" · ")[0].slice(0, 28) || "pending").replace(/^./, (c) => c.toUpperCase())}</span>}</td>
                  <td className="num mono">{v.needs || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {v.responseId && <Button asChild size="xs" variant="ghost"><Link href={`/rfx/${id}/responses/${v.responseId}`}>Open response</Link></Button>}
                    {o.mode === "mock" && !locked && <Button asChild size="xs" variant="ghost"><Link href={`/rfx/${id}/portal/${v.id}`}>Portal (mock)</Link></Button>}
                  </td>
                </>;
                return v.responseId ? <RowLink key={v.id} href={`/rfx/${id}/responses/${v.responseId}`}>{cells}</RowLink> : <tr key={v.id}>{cells}</tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {o.strays.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="hd"><b>Unmatched</b><span className="hint">replies the system couldn&apos;t tie to an invited vendor</span></div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {o.strays.map((s) => (
              <div className="filerow" key={s.id}>
                <span className="ext">{s.files[0]?.split(".").pop()?.toUpperCase() ?? "TXT"}</span>
                <span style={{ flex: 1 }}>{s.files.join(", ") || "email body"} · {s.from ?? "unknown sender"}</span>
                <span className="chip amber">Unknown vendor</span>
                {!locked && <AssignVendor responseId={s.id} vendors={allVendors ?? []} />}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
