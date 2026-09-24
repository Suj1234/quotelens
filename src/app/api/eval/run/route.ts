import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { evalEligible, runEval } from "@/lib/eval/run";

const Body = z.object({ rfx_id: z.uuid() });

// TRD §16 POST /api/eval/run. Allowed on an awarded (locked) RFx: it reads the grid and writes only eval_runs (DECISIONS P8).
export const POST = route(async (req: Request) => {
  await requireApiUser(["buyer", "admin"]);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", "rfx_id is required.");
  const eligible = await evalEligible();
  if (!eligible.some((e) => e.id === b.data.rfx_id)) {
    throw new AppError("NO_GOLD_KEY", `The answer key only covers RFx loaded with the seed replies${eligible.length ? ` (${eligible.map((e) => e.code).join(", ")})` : ""}.`, undefined, 422);
  }
  const r = await runEval(b.data.rfx_id, { save: true });
  return { ...r, ran_at: new Date().toISOString() };
});
