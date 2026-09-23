import { requireUser } from "@/lib/auth";
import { getComparison } from "@/lib/comparison";
import { PricesGrid } from "@/components/compare/prices-grid";

// DESIGN §3.7 / TRD §17.9 — Prices tab (other tabs: P3-T4).
export default async function ComparisonPage({ params }: PageProps<"/rfx/[id]/comparison">) {
  await requireUser();
  const { id } = await params;
  const grid = await getComparison(id);
  return (
    <div className="cmpwrap">
      {grid.cells.length
        ? <PricesGrid rfxId={id} grid={grid} />
        : <div className="empty" style={{ marginTop: 24 }}><b>No prices yet.</b> Load or add responses and run the stages; cells appear here as each vendor is normalised.</div>}
    </div>
  );
}
