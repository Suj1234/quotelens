import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { addVendor, listVendors } from "@/lib/vendors";

// Settings → Masters → Vendor directory (buyer/admin). Every create is an audit event vendor.created.
export const GET = route(async () => {
  await requireApiUser(["buyer", "admin"]);
  return { vendors: await listVendors() };
});

export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  return addVendor(await req.json().catch(() => null), user.id);
});
