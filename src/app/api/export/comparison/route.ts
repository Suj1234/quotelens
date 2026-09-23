import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { exportComparison } from "@/lib/export";

export const maxDuration = 60;

// TRD §16 GET /api/export/comparison?rfx=&format=xlsx|csv&basis=unit|landed — both roles (PRD #28).
export const GET = route(async (req: Request) => {
  await requireApiUser();
  const p = new URL(req.url).searchParams;
  const rfx = z.uuid().safeParse(p.get("rfx"));
  if (!rfx.success) throw new AppError("BAD_REQUEST", "Pass ?rfx=<rfx id>.");
  const f = await exportComparison(rfx.data, p.get("format") === "csv" ? "csv" : "xlsx", p.get("basis") === "landed" ? "landed" : "unit");
  return new Response(new Uint8Array(f.body), { headers: { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"`, "cache-control": "no-store" } });
});
