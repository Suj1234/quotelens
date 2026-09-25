import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { get } from "@/lib/storage";

// TRD §16 GET /api/export/memo/{award_id} → the memo PDF (both roles).
// ?v=N = that version of the memo (memo history); without it, the current one.
export const GET = route(async (req: Request, ctx: RouteContext<"/api/export/memo/[id]">) => {
  await requireApiUser();
  const id = (await ctx.params).id;
  const v = Number(new URL(req.url).searchParams.get("v") ?? "") || null;
  const { data } = v
    ? await db().from("award_versions").select("memo_path, rfx(code)").eq("award_id", id).eq("version", v).maybeSingle()
    : await db().from("awards").select("memo_path, rfx(code)").eq("id", id).maybeSingle();
  if (!data?.memo_path) throw new AppError("NOT_FOUND", v ? `Version ${v} of this memo has no PDF on file.` : "No memo for that award.", undefined, 404);
  const code = ((data.rfx as unknown as { code: string } | null)?.code ?? "RFx") + (v ? `_v${v}` : "");
  return new Response(new Uint8Array(await get("outbound", data.memo_path)), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${code}_Award_Memo.pdf"`, "cache-control": "no-store" },
  });
});
