import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { loadSeedResponses } from "@/lib/responses";

export const maxDuration = 120;

export const POST = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]/seed-responses">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  await assertOpen({ rfx: id });
  const set = new URL(req.url).searchParams.get("set") === "realistic" ? "realistic" : "clean";
  const body = await req.json().catch(() => ({}));
  const vendorIds = Array.isArray(body?.vendor_ids) ? body.vendor_ids.filter((v: unknown): v is string => typeof v === "string") : undefined;
  const { ids, rerun } = await loadSeedResponses(id, set, user.id, vendorIds);
  return { response_ids: ids, rerun_ids: rerun };
});
