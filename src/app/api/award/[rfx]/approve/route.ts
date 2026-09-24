import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { approveAward } from "@/lib/award";

export const maxDuration = 60; // re-renders the PDF with the signature

// TRD §16 POST /api/award/{rfx}/approve — approver only; RFx → awarded (locked).
export const POST = route(async (_req: Request, ctx: RouteContext<"/api/award/[rfx]/approve">) => {
  const user = await requireApiUser(["approver"]);
  return { award: await approveAward((await ctx.params).rfx, user) };
});
