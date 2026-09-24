import { requireUser } from "@/lib/auth";
import { listReview } from "@/lib/review";
import { ReviewQueue } from "@/components/review/review-queue";
import { pendingReplies } from "@/lib/email/sync";
import { isLocked } from "@/lib/lock";

// DESIGN §3.6 / TRD §17.8
export default async function ReviewPage({ params, searchParams }: PageProps<"/rfx/[id]/review">) {
  const user = await requireUser();
  const { id } = await params;
  const { item, vendor } = await searchParams;
  const locked = await isLocked(id);
  const canAct = user.role !== "approver" && !locked;
  const [items, pending] = await Promise.all([listReview(id), canAct ? pendingReplies(id) : Promise.resolve(null)]);
  return (
    <div className="page">
      <ReviewQueue rfxId={id} items={items} pending={pending} canAct={canAct} locked={locked} focus={typeof item === "string" ? item : null} vendor={typeof vendor === "string" ? vendor : ""} />
    </div>
  );
}
