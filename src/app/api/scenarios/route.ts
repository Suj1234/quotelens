import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { createScenario, listScenarios } from "@/lib/scenarios";

const Body = z.object({ rfx_id: z.uuid(), name: z.string().max(200), rule: z.unknown().optional(), query_id: z.uuid().optional() })
  .refine((b) => !!b.rule !== !!b.query_id, "Send either a rule or a query_id.");

// TRD §16 GET /api/scenarios?rfx= → list with totals and lines (both roles).
export const GET = route(async (req: Request) => {
  await requireApiUser();
  const rfx = new URL(req.url).searchParams.get("rfx");
  if (!rfx || !z.uuid().safeParse(rfx).success) throw new AppError("BAD_REQUEST", "rfx is required.");
  return { items: await listScenarios(rfx) };
});

// TRD §16 POST /api/scenarios. DESIGN §4: both roles save scenarios from an answer; building one by rule (New scenario) is the buyer's.
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", b.error.issues[0]?.message ?? "rfx_id, name and a rule or query_id are required.");
  if (b.data.rule && user.role === "approver") throw new AppError("FORBIDDEN", "Not allowed for your role", undefined, 403);
  return createScenario({ rfxId: b.data.rfx_id, name: b.data.name, rule: b.data.rule, queryId: b.data.query_id, user });
});
