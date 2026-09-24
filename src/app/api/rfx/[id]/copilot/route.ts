import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertDraft } from "@/lib/rfx-draft";
import { copilotTurn } from "@/lib/copilot";
import type { AgentEvent } from "@/lib/ai/agent";

export const maxDuration = 120;

// POST /api/rfx/{id}/copilot (multipart: message, files[]). Streams NDJSON: {type:"step"|"action", text} while the
// agent works (P9 A8/B19), then {type:"done", draft, changed} or {type:"error", error, code}.
export const POST = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]/copilot">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  await assertDraft(id);
  let message = "", files: { name: string; buf: Buffer }[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    message = String(form.get("message") ?? "").slice(0, 20_000);
    files = await Promise.all(form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5)
      .map(async (f) => ({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) })));
  } else {
    const body = await req.json().catch(() => null) as { message?: unknown } | null;
    message = typeof body?.message === "string" ? body.message.slice(0, 20_000) : "";
  }
  if (!message.trim() && !files.length) throw new AppError("BAD_REQUEST", "Tell the co-pilot what you need, or attach a file.");

  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => controller.enqueue(enc.encode(JSON.stringify(x) + "\n"));
      try {
        const out = await copilotTurn(id, message.trim(), files, user, (e: AgentEvent) => send(e));
        send({ type: "done", ...out });
      } catch (e) {
        if (!(e instanceof AppError)) console.error("[api] copilot", e);
        send({ type: "error", error: e instanceof AppError ? e.message : "Something went wrong on our side.", code: e instanceof AppError ? e.code : "INTERNAL" });
      }
      controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
});
