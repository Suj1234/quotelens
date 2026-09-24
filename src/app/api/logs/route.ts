import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { listModelCalls } from "@/lib/model-calls";

const Q = z.object({
  rfx: z.uuid().optional(), purpose: z.string().max(40).optional(), provider: z.enum(["gemini", "jev-openrouter"]).optional(),
  ok: z.enum(["true", "false"]).optional(),
});

// TRD §16 GET /api/logs?rfx= (buyer/admin): latest 200 model calls, newest first.
export const GET = route(async (req: Request) => {
  await requireApiUser(["buyer", "admin"]);
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new AppError("BAD_REQUEST", q.error.issues[0]?.message ?? "Bad filter.");
  const { ok, ...f } = q.data;
  return { items: await listModelCalls({ ...f, ok: ok === undefined ? null : ok === "true" }) };
});
