import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { act, type Action } from "@/lib/review";

export const maxDuration = 120; // "map" re-runs normalise for the response

// TRD §16 POST /api/review/{id}/{action} — buyer/admin only (DESIGN §4: approver views the queue, doesn't act).
export const POST = route(async (req: Request, { params }: RouteContext<"/api/review/[id]/[action]">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id, action } = await params;
  await assertOpen({ reviewItems: [id] });
  return act(id, action as Action, await req.json().catch(() => ({})), user);
});
