import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getDraft, patchDraftByHand, PatchBody } from "@/lib/rfx-draft";

export const maxDuration = 120;

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/rfx/[id]">) => {
  await requireApiUser();
  return getDraft((await ctx.params).id);
});

// TRD §16 PATCH: partial header, lines/questions/vendors replaced as sets; draft only (409 once issued).
// P9: the edit is also written into the co-pilot conversation as an "event" turn.
export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new AppError("BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid changes.", z.flattenError(body.error));
  return patchDraftByHand((await ctx.params).id, body.data, user); // the only caller is the New RFx screen (hand edits)
});
