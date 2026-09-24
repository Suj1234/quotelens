import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { createResponse, seedReply, type IncomingFile } from "@/lib/responses";
import { db } from "@/lib/db";
import { clarificationContext } from "@/lib/clarify";

export const maxDuration = 120;

const Fields = z.object({
  rfx_id: z.uuid(),
  vendor_id: z.uuid().optional(),
  email_text: z.string().max(100_000).optional(),
  source: z.enum(["mock_upload", "mock_paste", "portal"]).default("mock_upload"),
  use_seed: z.literal("1").optional(), // "Use seed file": this vendor's reply from the dataset (DESIGN §3.5)
  clarification_of: z.uuid().optional(), // mock paste of a clarification reply (CLAUDE P6-T3): the clarification email it answers
});
const LIMIT = 4.5 * 1024 * 1024; // Vercel request body limit (DECISIONS P0-T5)

// ponytail: files go through the function body, so Vercel's 4.5 MB request cap applies; switch to signed
// direct-to-Storage uploads if real phone photos or scans exceed it. Until then: a clear error, never a silent failure.
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  if (Number(req.headers.get("content-length") ?? 0) > LIMIT) throw new AppError("TOO_LARGE", "The upload is over 4.5 MB — the limit here. Send a smaller photo or scan, split the files, or paste the email text.", undefined, 413);
  const form = await req.formData().catch(() => { throw new AppError("BAD_REQUEST", "Expected multipart form data."); });
  const fields = Fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")));
  if (!fields.success) throw new AppError("BAD_REQUEST", "Missing or invalid fields.", z.flattenError(fields.error));
  const files: IncomingFile[] = await Promise.all(
    form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
      .map(async (f) => ({ name: f.name, mime: f.type, buf: Buffer.from(await f.arrayBuffer()) })),
  );
  let emailText = fields.data.email_text;
  if (fields.data.use_seed) {
    const { data: v } = fields.data.vendor_id ? await db().from("vendors").select("short_code").eq("id", fields.data.vendor_id).single() : { data: null };
    const seed = v ? await seedReply(v.short_code) : null;
    if (!seed) throw new AppError("NO_SEED", "The dataset has no sample reply for this vendor.", undefined, 400);
    files.push(...seed.files);
    emailText = [emailText, seed.emailText].filter(Boolean).join("\n\n") || undefined;
  }
  let clarification;
  if (fields.data.clarification_of) {
    if (!fields.data.vendor_id) throw new AppError("BAD_REQUEST", "A clarification reply needs its vendor.");
    const { data: req } = await db().from("communications").select("id, reply_to").eq("id", fields.data.clarification_of).eq("rfx_id", fields.data.rfx_id)
      .eq("vendor_id", fields.data.vendor_id).eq("kind", "clarification").maybeSingle();
    if (!req) throw new AppError("NOT_FOUND", "That clarification email isn't this vendor's on this RFx.", undefined, 404);
    const n = Number(req.reply_to?.match(/-clar-(\d+)@/)?.[1] ?? 0) || null;
    clarification = { ...(await clarificationContext(fields.data.rfx_id, fields.data.vendor_id, n)), request_id: req.id };
  }
  const response_id = await createResponse({
    rfxId: fields.data.rfx_id, vendorId: fields.data.vendor_id ?? null, source: fields.data.source,
    emailText, files, actor: user.id, ...(clarification ? { clarification } : {}),
  });
  return { response_id };
});
