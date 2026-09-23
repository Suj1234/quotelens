import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { loadSeedResponses } from "@/lib/responses";

export const maxDuration = 120;

export const POST = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]/seed-responses">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  const set = new URL(req.url).searchParams.get("set") === "realistic" ? "realistic" : "clean";
  return { response_ids: await loadSeedResponses(id, set, user.id) };
});
