import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { issueRfx } from "@/lib/dispatch";

export const maxDuration = 120;

// TRD §16 POST /api/rfx/{id}/issue — buyer only (DESIGN §4).
export const POST = route(async (_req: Request, ctx: RouteContext<"/api/rfx/[id]/issue">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  return issueRfx((await ctx.params).id, user);
});
