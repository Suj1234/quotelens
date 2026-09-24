import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { runStage } from "@/lib/pipeline/run";
import type { Stage } from "@/types/db";

export const maxDuration = 300; // TRD §21 (design for ≤ 60 s per stage)

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/responses/[id]/stage/[stage]">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id, stage } = await ctx.params;
  await assertOpen({ response: id });
  return runStage(id, stage as Stage, user.id);
});
