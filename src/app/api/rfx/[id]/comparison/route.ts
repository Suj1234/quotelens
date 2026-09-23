import { requireApiUser } from "@/lib/auth";
import { getComparison } from "@/lib/comparison";
import { route } from "@/lib/http";

// TRD §16 GET /api/rfx/{id}/comparison — basis/original are view toggles, applied client-side from the same model.
export const GET = route(async (_req: Request, { params }: RouteContext<"/api/rfx/[id]/comparison">) => {
  await requireApiUser();
  return getComparison((await params).id);
});
