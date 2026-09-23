import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { createResponse } from "@/lib/responses";

export const maxDuration = 120;

const Fields = z.object({
  rfx_id: z.uuid(),
  vendor_id: z.uuid().optional(),
  email_text: z.string().max(100_000).optional(),
  source: z.enum(["mock_upload", "mock_paste", "portal"]).default("mock_upload"),
});

// ponytail: files go through the function body, so Vercel's 4.5 MB request cap applies; switch to signed
// direct-to-Storage uploads if real phone photos or scans exceed it.
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const form = await req.formData().catch(() => { throw new AppError("BAD_REQUEST", "Expected multipart form data."); });
  const fields = Fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")));
  if (!fields.success) throw new AppError("BAD_REQUEST", "Missing or invalid fields.", z.flattenError(fields.error));
  const files = await Promise.all(
    form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
      .map(async (f) => ({ name: f.name, mime: f.type, buf: Buffer.from(await f.arrayBuffer()) })),
  );
  const response_id = await createResponse({
    rfxId: fields.data.rfx_id, vendorId: fields.data.vendor_id ?? null, source: fields.data.source,
    emailText: fields.data.email_text, files, actor: user.id,
  });
  return { response_id };
});
