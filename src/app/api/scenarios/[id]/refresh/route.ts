import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { refreshScenario } from "@/lib/scenarios";

// A1 (DECISIONS 2026-09-25 Award tab): re-work a saved option on today's grid. Both roles — it changes no decision, only brings the numbers up to date.
export const POST = route(async (_req: Request, ctx: RouteContext<"/api/scenarios/[id]/refresh">) => {
  const user = await requireApiUser();
  return refreshScenario((await ctx.params).id, user);
});
