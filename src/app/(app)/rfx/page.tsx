import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listRfx } from "@/lib/rfx";
import { countWord, inrShort, relativeDay } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { RowLink } from "@/components/rfx/row-link";

const LABEL = { draft: "Draft", issued: "Issued", receiving: "Receiving", reviewing: "Reviewing", awarded: "Awarded", closed: "Closed" };

export default async function RfxListPage() {
  const user = await requireUser();
  const buyer = user.role !== "approver";
  const rows = await listRfx();

  // "Four events. One needs review, one is ready to issue." — counts computed (DESIGN.md §3.2)
  const review = rows.filter((r) => r.status === "reviewing").length;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const clauses = [
    review && `${countWord(review).toLowerCase()} ${review === 1 ? "needs" : "need"} review`,
    drafts && `${countWord(drafts).toLowerCase()} ${drafts === 1 ? "is" : "are"} ready to issue`,
  ].filter(Boolean).join(", ");
  const sub = buyer
    ? `${countWord(rows.length)} event${rows.length === 1 ? "" : "s"}.${clauses ? ` ${clauses[0].toUpperCase()}${clauses.slice(1)}.` : ""}`
    : "Events waiting for your questions or approval.";

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1>RFx</h1>
          <p className="text-muted-foreground" style={{ marginTop: 4 }}>{sub}</p>
        </div>
        {buyer && <Button asChild variant="default"><Link href="/rfx/new">New RFx</Link></Button>}
      </div>
      {rows.length === 0 ? (
        <div className="empty"><b>No RFx yet.</b> {buyer ? "Start one with New RFx — the co-pilot drafts the lines, terms and questionnaire with you." : "Events appear here once Sujit issues one."}</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr><th>Code</th><th>Title</th><th>Status</th><th>Responses</th><th className="num">Lines</th><th className="num">Annual value</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = r.status === "draft" && buyer ? `/rfx/new?id=${r.id}` : `/rfx/${r.id}`;
                return (
                  <RowLink key={r.id} href={href}>
                    <td className="mono"><Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{r.code}</Link></td>
                    <td>{r.title}</td>
                    <td><span className={`status ${r.status}`}>{LABEL[r.status]}</span></td>
                    <td className="mono">{r.responded} of {r.invited}</td>
                    <td className="num mono">{r.lines}</td>
                    {/* The approved award's scenario total (P7); "—" until an award is approved */}
                    <td className="num mono">{r.annual_value !== null ? inrShort(r.annual_value) : "—"}</td>
                    <td className="text-muted-foreground">{relativeDay(r.updated)}</td>
                  </RowLink>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
