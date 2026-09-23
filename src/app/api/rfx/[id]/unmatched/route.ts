import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getUnmatched } from "@/lib/unmatched";

// TRD §16 GET /api/rfx/{id}/unmatched — items with their best candidate line.
export const GET = route(async (_req: Request, { params }: RouteContext<"/api/rfx/[id]/unmatched">) => {
  await requireApiUser();
  return getUnmatched((await params).id);
});
