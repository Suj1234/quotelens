import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { runAll } from "@/lib/pipeline/run";
import { STAGES, type Stage } from "@/types/db";

export const maxDuration = 300; // TRD §21

/** Server-side chain with per-stage persistence, streamed as NDJSON (one StageEvent per line). */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/responses/[id]/run-all">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  await assertOpen({ response: id });
  const from = new URL(req.url).searchParams.get("from") as Stage | null;
  const events = runAll(id, user.id, from && STAGES.includes(from) ? from : "classify");
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(JSON.stringify(value) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ stage: "classify", status: "error", ms: 0, error: (e as Error).message }) + "\n"));
        controller.close();
      }
    },
  }), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
});
