import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { analystTurn } from "@/lib/analyst";
import type { AgentEvent } from "@/lib/ai/agent";

export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().min(1, "Type a question first.").max(2000),
  history: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(8000) })).max(40).default([]),
});

// POST /api/rfx/{id}/analyst {message, history} — both roles (tools check role and lock themselves, P9 C10/C12).
// Streams NDJSON: {type:"step"|"action", text} while the agent works, then {type:"done", reply, actions, context} or {type:"error"}.
export const POST = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]/analyst">) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", b.error.issues[0]?.message ?? "Invalid request.");
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => controller.enqueue(enc.encode(JSON.stringify(x) + "\n"));
      try {
        send({ type: "done", ...(await analystTurn(id, b.data.message, b.data.history, user, (e: AgentEvent) => send(e))) });
      } catch (e) {
        if (!(e instanceof AppError)) console.error("[api] analyst", e);
        send({ type: "error", error: e instanceof AppError ? e.message : "Something went wrong on our side.", code: e instanceof AppError ? e.code : "INTERNAL" });
      }
      controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
});
