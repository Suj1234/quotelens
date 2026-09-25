import { requireUser } from "@/lib/auth";
import { AskChat } from "@/components/ask/ask-sheet";

// P9: Ask as its own page ("Open in new tab" in the Ask sheet) — the same conversation, the full width for tables and charts.
export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <div className="page"><section className="ask-page card"><AskChat rfxId={id} page /></section></div>;
}
