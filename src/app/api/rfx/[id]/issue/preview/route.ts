import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getDraft } from "@/lib/rfx-draft";
import { quoteFormXlsx } from "@/lib/dispatch-docs";
import { quoteFormName, XLSX_MIME } from "@/lib/dispatch";

// GET /api/rfx/{id}/issue/preview → the quote form as it would be attached if issued now (View and Download in the
// Issue dialog); nothing is stored or frozen.
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/rfx/[id]/issue/preview">) => {
  await requireApiUser(["buyer", "admin"]);
  const d = await getDraft((await ctx.params).id);
  const buf = await quoteFormXlsx(d);
  return new Response(new Uint8Array(buf), { headers: { "content-type": XLSX_MIME, "content-disposition": `inline; filename="${quoteFormName(d.rfx.code)}"`, "cache-control": "no-store" } });
});
