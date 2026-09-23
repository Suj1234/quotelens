import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getTimeline } from "@/lib/rfx-tabs";

// TRD §16 GET /api/rfx/{id}/timeline
export const GET = route(async (_req: Request, { params }: RouteContext<"/api/rfx/[id]/timeline">) => {
  await requireApiUser();
  return getTimeline((await params).id);
});
