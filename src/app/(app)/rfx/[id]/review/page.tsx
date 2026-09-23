import { requireUser } from "@/lib/auth";
import { listReview } from "@/lib/review";
import { ReviewQueue } from "@/components/review/review-queue";

// DESIGN §3.6 / TRD §17.8
export default async function ReviewPage({ params, searchParams }: PageProps<"/rfx/[id]/review">) {
  const user = await requireUser();
  const { id } = await params;
  const { item, vendor } = await searchParams;
  const items = await listReview(id);
  return (
    <div className="page">
      <ReviewQueue items={items} canAct={user.role !== "approver"} focus={typeof item === "string" ? item : null} vendor={typeof vendor === "string" ? vendor : ""} />
    </div>
  );
}
