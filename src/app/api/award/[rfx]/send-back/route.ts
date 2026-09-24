import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { sendBack } from "@/lib/award";

// DESIGN §3.9 Send back — approver only, with a note for the buyer.
export const POST = route(async (req: Request, ctx: RouteContext<"/api/award/[rfx]/send-back">) => {
  const user = await requireApiUser(["approver"]);
  const { note } = (await req.json().catch(() => ({}))) as { note?: string };
  return { award: await sendBack((await ctx.params).rfx, note ?? "", user) };
});
