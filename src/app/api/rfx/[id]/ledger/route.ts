import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getLedger } from "@/lib/rfx-tabs";

// TRD §16 GET /api/rfx/{id}/ledger
export const GET = route(async (_req: Request, { params }: RouteContext<"/api/rfx/[id]/ledger">) => {
  await requireApiUser();
  return getLedger((await params).id);
});
