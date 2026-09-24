import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { pendingReplies } from "@/lib/email/sync";

// Unread tagged replies waiting for this RFx, by vendor (DESIGN §3.6 "Sync inbox — Westline replied").
export const GET = route(async (req: Request) => {
  await requireApiUser(["buyer", "admin"]);
  const rfx = new URL(req.url).searchParams.get("rfx");
  if (!rfx) throw new AppError("BAD_REQUEST", "rfx is required.");
  return pendingReplies(rfx);
});
