import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { updateVendor } from "@/lib/vendors";

// Edit one vendor (short code and history stay); the changed fields go to the audit event vendor.updated.
export const PATCH = route(async (req: Request, { params }: RouteContext<"/api/vendors/[id]">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  return updateVendor((await params).id, await req.json().catch(() => null), user.id);
});
