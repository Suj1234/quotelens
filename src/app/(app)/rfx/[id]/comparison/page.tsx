import { requireUser } from "@/lib/auth";
import { getComparison } from "@/lib/comparison";
import { getDocuments, getLedger, getQuestionnaireGrid, getTimeline } from "@/lib/rfx-tabs";
import { ComparisonView } from "@/components/compare/comparison-view";
import { CMP_TABS, CmpTabs, DocumentsTab, QuestionnaireTab, TimelineTab, type CmpTab } from "@/components/compare/tabs";
import { LedgerTab } from "@/components/compare/ledger-tab";

// DESIGN §3.7 / TRD §17.9
export default async function ComparisonPage({ params, searchParams }: PageProps<"/rfx/[id]/comparison">) {
  const user = await requireUser();
  const { id } = await params;
  const q = (await searchParams).tab;
  const tab: CmpTab = CMP_TABS.includes(q as CmpTab) ? (q as CmpTab) : "prices";
  return (
    <div className="cmpwrap">
      <CmpTabs rfxId={id} tab={tab} />
      {tab === "prices" && <Prices id={id} canReview={user.role !== "approver"} />}
      {tab === "questionnaire" && <QuestionnaireTab qa={await getQuestionnaireGrid(id)} />}
      {tab === "documents" && <DocumentsTab docs={await getDocuments(id)} />}
      {tab === "ledger" && <LedgerTab rows={await getLedger(id)} />}
      {tab === "timeline" && <TimelineTab rows={await getTimeline(id)} />}
    </div>
  );
}

async function Prices({ id, canReview }: { id: string; canReview: boolean }) {
  const grid = await getComparison(id);
  return grid.cells.length
    ? <ComparisonView rfxId={id} grid={grid} canReview={canReview} />
    : <div className="empty" style={{ marginTop: 24 }}><b>No prices yet.</b> Load or add responses and run the stages; cells appear here as each vendor is normalised.</div>;
}
