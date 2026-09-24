import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { overrideLine } from "@/lib/scenarios";

// TRD §16 POST /api/scenarios/{id}/override {rfx_line_id, vendor_id, reason} | {rfx_line_id, revert: true} — buyer only (DESIGN §4).
export const POST = route(async (req: Request, ctx: RouteContext<"/api/scenarios/[id]/override">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  return overrideLine((await ctx.params).id, await req.json().catch(() => ({})), user);
});
