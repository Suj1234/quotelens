import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { deleteScenario, editScenario } from "@/lib/scenarios";

export const maxDuration = 120; // editing the words re-asks (P-SQL + narrate)

const Body = z.object({ name: z.string().max(200).optional(), question: z.string().max(1000).optional() }).refine((b) => b.name !== undefined || b.question !== undefined, "Send a name or new words.");

// Rename / edit (PATCH) and delete: the buyer any option, the approver the options she created (lib checks; DECISIONS 2026-09-25 "option menu").
export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/scenarios/[id]">) => {
  const user = await requireApiUser();
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", b.error.issues[0]?.message ?? "Invalid request.");
  return editScenario((await ctx.params).id, b.data, user);
});

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/scenarios/[id]">) => {
  const user = await requireApiUser();
  return deleteScenario((await ctx.params).id, user);
});
