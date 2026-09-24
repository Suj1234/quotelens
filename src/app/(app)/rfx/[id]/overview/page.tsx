import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOverview } from "@/lib/overview";
import { countWord, dateTime, inrShort, longDate, shortDate } from "@/lib/format";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { LoadSeed } from "@/components/rfx/load-seed";
import { AssignVendor } from "@/components/rfx/assign-vendor";
import { RowLink } from "@/components/rfx/row-link";
import { SyncPoller } from "@/components/comms/sync-inbox";

const UNIT: Record<string, string> = { per_1000_pcs: "per 1000 pcs", per_piece: "per piece", per_kg: "per kg", per_box: "per box" };
const word = (n: number) => countWord(n).toLowerCase();
// "Q6: No – BRC audit planned for Q1 2027 · Q3: …" → ["Q6", "Q3"] (only the labels, not a "Q1" inside an answer).
const failedQs = (note: string) => [...new Set(note.split(" · ").map((s) => s.match(/^Q\d+(?=:)/)?.[0]).filter((q): q is string => !!q))];

// DESIGN §3.4 Overview (buyer's default tab). No buttons that duplicate the tabs (DESIGN §0.8).
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
      <div className="page">
        <div className="empty"><b>This RFx is still a draft.</b><div style={{ margin: "6px 0 12px", fontSize: 12.5 }}>Finish the lines, terms, questionnaire and vendors, then issue it.</div><Button asChild variant="default" size="sm"><Link href={`/rfx/new?id=${id}`}>Open in New RFx</Link></Button></div>
      </div>
    );
  }

  const days = o.lastReply && r.frozen_at ? Math.max(1, Math.ceil((new Date(o.lastReply).getTime() - new Date(r.frozen_at).getTime()) / 86_400_000)) : null;
  const { data: allVendors } = o.strays.length ? await db().from("vendors").select("id, name").order("name") : { data: [] };
  return (
    <div className="page">
      {o.mode === "mock" && !locked && <SyncPoller rfxId={id} />}
      <div className="grid2" style={{ gridTemplateColumns: "1.25fr 1fr", alignItems: "start" }}>
        <div>
          <div className="eyebrow">Where this stands</div>
          <p className="lead" style={{ marginTop: 6 }}>
            {o.replied === 0 ? <>Issued {r.frozen_at ? longDate(r.frozen_at) : ""} to {word(invited)} vendors. <b>No replies yet</b>{r.response_deadline ? <> — the deadline is {longDate(r.response_deadline)}</> : null}.</>
              : <>
                {o.replied === invited ? <>All {word(invited)} vendors replied{days ? ` within ${days === 1 ? "a day" : `${word(days)} days`}` : ""}. </> : <>{countWord(o.replied)} of {invited} vendors have replied. </>}
                {o.clearedCount ? `${countWord(o.clearedCount)} cleared the questionnaire. ` : "None has cleared the questionnaire yet. "}
                {o.openItems ? <><b>{o.openItems} {o.openItems === 1 ? "item needs" : "items need"}</b> your call before the grid is complete</> : <>Nothing needs your call</>}
                {o.covered ? <>; awarding each line to the cheapest qualified vendor currently comes to <b>{inrShort(o.cheapest)}</b> a year{o.covered < r.lines ? ` for ${o.covered} of ${r.lines} lines` : ""}.</> : "."}
              </>}
          </p>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="hd"><b>Needs you</b>{o.openItems > 0 && <Link className="small" style={{ fontSize: 12 }} href={`/rfx/${id}/review`}>Open the queue</Link>}</div>
            {o.needs.length
              ? <table className="t"><tbody>{o.needs.map((n, i) => <tr key={i}><td style={{ width: 190 }}>{i === 0 || o.needs[i - 1].vendor !== n.vendor ? <b>{n.vendor}</b> : null}</td><td>{n.text}</td></tr>)}</tbody></table>
              : <div className="bd text-muted-foreground" style={{ fontSize: 12 }}>{o.replied ? "Nothing pending — the grid is complete." : "Nothing yet — replies raise their questions here."}</div>}
          </div>
        </div>
        <div className="card">
          <div className="hd"><b>The event</b></div>
          <div className="bd">
            <dl className="kv">
              <dt>Issued</dt><dd>{r.frozen_at ? `${longDate(r.frozen_at)} · v${r.version} frozen` : "—"}</dd>
              <dt>Deadline</dt><dd>{r.response_deadline ? longDate(r.response_deadline) : "—"}</dd>
              <dt>Scope</dt><dd>{r.lines} lines · {invited} vendors invited{o.range ? ` · ${inrShort(o.range[0])}–${inrShort(o.range[1])} a year` : ""}</dd>
              <dt>Terms</dt><dd>{r.currency} {UNIT[r.quote_unit] ?? r.quote_unit} · {r.incoterm === "delivered" ? "delivered" : r.incoterm.replace("_", "-")}{r.freight_included_requested ? ", freight included" : ""} · {r.payment_terms_days} days · {r.validity_days_requested}-day validity</dd>
              <dt>Plants</dt><dd>{r.delivery_locations.join(", ")}</dd>
              <dt>Questionnaire</dt><dd>{o.questions} questions{o.disqualifying.length ? ` · ${o.disqualifying.join(", ")} disqualifying` : ""}</dd>
              <dt>Transport</dt><dd>{o.mode === "mock" ? "Mock email" : o.mode === "gmail" ? "Gmail" : o.mode} · <Link href="/settings">change</Link></dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="hd"><b>Vendors</b><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="hint">click a row for the response</span>{o.mode === "mock" && !locked && <LoadSeed rfxId={id} />}</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead><tr><th>Vendor</th><th>Sent as</th><th>Received</th><th className="num">Priced</th><th>Valid to</th><th>Questionnaire</th><th className="num">Needs you</th><th /></tr></thead>
            <tbody>
              {o.vendors.map((v) => {
                const cells = <>
                  <td><b>{v.name}</b>{(v.status === "clarification_sent" || v.status === "clarified") && <> <span className={`chip ${v.status === "clarified" ? "green" : "amber"}`} style={{ height: 15 }}>{v.status.replace("_", " ")}</span></>}<div className="text-muted-foreground" style={{ fontSize: 11 }}>{v.city ?? ""}</div></td>
                  <td className="text-muted-foreground">{v.sentAs ?? "—"}</td>
                  <td className="mono">{v.received ? shortDate(v.received) : "—"}</td>
                  <td className="num mono">{v.received ? `${v.priced}/${v.lines}` : "—"}</td>
                  <td className="mono">{v.validUntil ? shortDate(v.validUntil) : "—"}{v.validityShort && <> <span className="chip amber" style={{ height: 15 }}>{v.validityDays}d</span></>}</td>
                  <td>{!v.received ? <span className="chip grey">{v.status === "invited" ? "awaiting reply" : v.status.replace("_", " ")}</span> : v.cleared === true ? <span className="chip green">cleared</span> : v.cleared === false ? <span className="chip red" title={v.clearedNote}>{failedQs(v.clearedNote).length ? `failed ${failedQs(v.clearedNote).join(", ")}` : "not cleared"}</span> : <span className="chip amber" title={v.clearedNote}>{v.clearedNote.split(" · ")[0].slice(0, 28) || "pending"}</span>}</td>
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
                <span className="chip amber">unknown vendor</span>
                {!locked && <AssignVendor responseId={s.id} vendors={allVendors ?? []} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="hd"><b>Vendor communications</b><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="hint">every send and receive, with ids</span>{o.comms.some((c) => c.direction === "outbound") && <Link href={`/rfx/${id}/outbox`} style={{ fontSize: 12 }}>Outbox</Link>}</span></div>
        <div className="bd tl">
          {o.comms.length === 0 && <div className="text-muted-foreground" style={{ fontSize: 12 }}>No emails yet.</div>}
          {o.comms.map((c) => {
            // The email this one answers (In-Reply-To), linked to its row in this timeline.
            const answers = c.in_reply_to ? o.comms.find((x) => x.message_id === c.in_reply_to) : null;
            const files = c.attachments.map((a) => a.url ? <a key={a.name} href={a.url} download={a.name} className="mono" style={{ fontSize: 11.5 }}>{a.name}</a> : <span key={a.name} className="mono" style={{ fontSize: 11.5 }}>{a.name}</span>);
            return (
              <div className="ev" key={c.id} id={`comm-${c.id}`}>
                <span className="ts">{dateTime(c.at)}</span>
                <span className="dir">{c.direction === "outbound" ? "→" : "←"}</span>
                <div>
                  <div>{c.direction === "outbound" ? `${c.vendor ?? c.to} · ${c.subject ?? ""}` : `${c.vendor ?? c.from ?? "Unknown sender"} · ${c.subject ?? (c.kind === "vendor_reply" ? "reply" : c.kind)}`}</div>
                  <div className="text-muted-foreground" style={{ fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>{files.length ? files : c.direction === "inbound" ? <span>email body only</span> : null}</div>
                  <div className="text-muted-foreground" style={{ fontSize: 11 }}>
                    {c.kind.replace("_", " ")} · {c.mode} · {c.status}{c.message_id ? <> · <span className="mono">{c.message_id}</span></> : null}
                    {c.in_reply_to && <> · in reply to {answers ? <a href={`#comm-${answers.id}`}>{answers.direction === "outbound" ? "our" : "their"} {answers.kind === "clarification" ? "clarification" : answers.kind === "rfx_dispatch" ? "RFx email" : "email"} of {dateTime(answers.at)}</a> : <span className="mono">{c.in_reply_to}</span>}</>}
                    {c.response_id && <> · <Link href={`/rfx/${id}/responses/${c.response_id}`}>response</Link></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
