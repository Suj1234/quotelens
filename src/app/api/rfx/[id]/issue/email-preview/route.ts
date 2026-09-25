import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { previewDispatch } from "@/lib/dispatch";

export const maxDuration = 60;

// POST /api/rfx/{id}/issue/email-preview {vendor_id} → the cover email issuing would send that vendor (P9 N1); nothing sent.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const b = z.object({ vendor_id: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", "Pick a vendor.");
  return previewDispatch((await ctx.params).id, b.data.vendor_id, user);
});
