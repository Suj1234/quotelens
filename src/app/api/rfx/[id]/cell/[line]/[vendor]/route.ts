import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getCellDetail } from "@/lib/provenance";

export const GET = route(async (_req: Request, { params }: RouteContext<"/api/rfx/[id]/cell/[line]/[vendor]">) => {
  await requireApiUser();
  const { id, line, vendor } = await params;
  return getCellDetail(id, Number(line), vendor);
});
