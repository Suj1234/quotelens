import { PageSkeleton } from "@/components/shell/skeleton";

// Nested inside the RFx layout: the header and tabs stay, the tab body shows its shape while it loads.
export default function Loading() {
  return <PageSkeleton title={false} cards={2} rows={5} />;
}
