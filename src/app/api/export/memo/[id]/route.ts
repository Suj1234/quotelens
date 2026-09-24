import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { get } from "@/lib/storage";

// TRD §16 GET /api/export/memo/{award_id} → the memo PDF (both roles).
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/export/memo/[id]">) => {
  await requireApiUser();
  const { data } = await db().from("awards").select("memo_path, rfx(code)").eq("id", (await ctx.params).id).maybeSingle();
  if (!data?.memo_path) throw new AppError("NOT_FOUND", "No memo for that award.", undefined, 404);
  const code = (data.rfx as unknown as { code: string } | null)?.code ?? "RFx";
  return new Response(new Uint8Array(await get("outbound", data.memo_path)), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${code}_Award_Memo.pdf"`, "cache-control": "no-store" },
  });
});
