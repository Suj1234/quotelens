import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { mimeFor } from "@/lib/preprocess";
import { get, list, safeName } from "@/lib/storage";

// GET /api/rfx/{id}/copilot/file?name=… → the bytes of a file the buyer attached in the co-pilot chat (P9), served
// same-origin so the in-app viewer can render it.
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  const name = safeName(new URL(req.url).searchParams.get("name") ?? "");
  const dir = `rfx/${id}/copilot`;
  if (!name || !(await list("raw", dir)).includes(`${dir}/${name}`)) throw new AppError("NOT_FOUND", "That file isn't attached to this RFx.", undefined, 404);
  const buf = await get("raw", `${dir}/${name}`);
  return new Response(new Uint8Array(buf), { headers: { "content-type": mimeFor(name), "content-disposition": `inline; filename="${name}"`, "cache-control": "private, max-age=300" } });
});
