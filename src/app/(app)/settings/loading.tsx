import { PageSkeleton } from "@/components/shell/skeleton";

export default function Loading() {
  return <PageSkeleton cards={3} rows={4} />;
}
