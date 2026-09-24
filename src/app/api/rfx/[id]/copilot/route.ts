import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { attachmentText, copilotTurn, type Attachment } from "@/lib/copilot";

export const maxDuration = 120;

const Json = z.object({ message: z.string().max(20_000).default(""), attachments: z.array(z.object({ name: z.string(), text: z.string().max(200_000) })).max(5).optional() });

// TRD §16 POST /api/rfx/{id}/copilot {message, attachments?:[{name,text}]}; the UI sends files as multipart, read by the vendor-file preprocessors.
export const POST = route(async (req: Request, ctx: RouteContext<"/api/rfx/[id]/copilot">) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { id } = await ctx.params;
  let message = "", attachments: Attachment[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    message = String(form.get("message") ?? "");
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
    attachments = await Promise.all(files.map(async (f) => attachmentText(f.name, Buffer.from(await f.arrayBuffer()))));
  } else {
    const body = Json.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AppError("BAD_REQUEST", "Send a message or an attachment.", z.flattenError(body.error));
    message = body.data.message; attachments = body.data.attachments ?? [];
  }
  if (!message.trim() && !attachments.length) throw new AppError("BAD_REQUEST", "Tell the co-pilot what you need, or attach a sheet.");
  return copilotTurn(id, message.trim(), attachments, user);
});
