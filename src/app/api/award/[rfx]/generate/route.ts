import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { generateMemo } from "@/lib/award";

export const maxDuration = 120; // P-MEMO (strong model) + PDF render

// TRD §16 POST /api/award/{rfx}/generate {scenario_id} → {award, memo_url}. Buyer/admin (DESIGN §4).
export const POST = route(async (req: Request, ctx: RouteContext<"/api/award/[rfx]/generate">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const b = z.object({ scenario_id: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", "Pick a scenario first.");
  const award = await generateMemo((await ctx.params).rfx, b.data.scenario_id, user);
  return { award, memo_url: award?.pdf_url };
});
