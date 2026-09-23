import { logout } from "@/lib/auth";
import { route } from "@/lib/http";

export const POST = route(async () => {
  await logout();
  return { ok: true };
});
