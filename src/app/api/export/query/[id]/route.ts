import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { exportQuery } from "@/lib/export";

// TRD §13.6 / §16 GET /api/export/query/{id}?format=csv|xlsx
export const GET = route(async (req: Request, ctx: RouteContext<"/api/export/query/[id]">) => {
  await requireApiUser();
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new AppError("BAD_REQUEST", "Unknown answer id.");
  const f = await exportQuery(id.data, new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx");
  return new Response(new Uint8Array(f.body), { headers: { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"`, "cache-control": "no-store" } });
});
