import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { listReview } from "@/lib/review";

// TRD §16 GET /api/review?rfx=&type=&vendor=&status=
export const GET = route(async (req: Request) => {
  await requireApiUser();
  const p = new URL(req.url).searchParams;
  const rfx = p.get("rfx");
  if (!rfx) throw new AppError("BAD_INPUT", "rfx is required", undefined, 400);
  return listReview(rfx, { type: p.get("type") ?? undefined, vendor: p.get("vendor") ?? undefined, status: p.get("status") ?? undefined });
});
