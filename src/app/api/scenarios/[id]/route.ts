import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { deleteScenario } from "@/lib/scenarios";

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/scenarios/[id]">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  return deleteScenario((await ctx.params).id, user);
});
