import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listRfx } from "@/lib/rfx";
import { Button } from "@/components/ui/button";
import { RfxList } from "@/components/rfx/rfx-list";

// DECISIONS 2026-09-25: "Sourcing events" with a purpose line, status tabs, search and filters (replaces the DESIGN §3.2 count sentence).
export default async function RfxListPage({ searchParams }: PageProps<"/rfx">) {
  const user = await requireUser();
  const buyer = user.role !== "approver";
  const [rows, sp] = await Promise.all([listRfx(), searchParams]);

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1>Sourcing events</h1>
          <p className="text-muted-foreground" style={{ marginTop: 4 }}>
            {buyer ? "Every request for quotation you've raised: track replies, review extracted prices, and award." : "Events waiting for your questions or approval."}
          </p>
        </div>
        {buyer && <Button asChild variant="default"><Link href="/rfx/new">New RFx</Link></Button>}
      </div>
      {rows.length === 0 ? (
        <div className="empty"><b>No RFx yet.</b> {buyer ? "Start one with New RFx — the co-pilot drafts the lines, terms and questionnaire with you." : "Events appear here once Sujit issues one."}</div>
      ) : (
        // Remount on real navigations (sidebar links) so the search box shows the URL's query; filter edits use replaceState and keep it mounted.
        <RfxList key={JSON.stringify(sp)} rows={rows} buyer={buyer} />
      )}
    </div>
  );
}
