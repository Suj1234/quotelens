import { requireUser } from "@/lib/auth";
import { getComparison } from "@/lib/comparison";
import { ComparisonView } from "@/components/compare/comparison-view";

// DESIGN §3.7 / TRD §17.9 — Prices tab (other tabs: P3-T4).
export default async function ComparisonPage({ params }: PageProps<"/rfx/[id]/comparison">) {
  const user = await requireUser();
  const { id } = await params;
  const grid = await getComparison(id);
  return (
    <div className="cmpwrap">
      {grid.cells.length
        ? <ComparisonView rfxId={id} grid={grid} canReview={user.role !== "approver"} />
        : <div className="empty" style={{ marginTop: 24 }}><b>No prices yet.</b> Load or add responses and run the stages; cells appear here as each vendor is normalised.</div>}
    </div>
  );
}
