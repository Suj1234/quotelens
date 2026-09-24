import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { assignVendor } from "@/lib/unmatched";

export const maxDuration = 300; // runs the remaining pipeline stages

export const POST = route(async (req: Request, { params }: RouteContext<"/api/responses/[id]/assign-vendor">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  await assertOpen({ response: (await params).id });
  return assignVendor((await params).id, await req.json().catch(() => ({})), user);
});
