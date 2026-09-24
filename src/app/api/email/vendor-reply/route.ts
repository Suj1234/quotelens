import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { replyAsVendor } from "@/lib/email/mailbox";

export const maxDuration = 60;
const LIMIT = 4.5 * 1024 * 1024; // Vercel request body limit (DECISIONS P0-T5)
const Fields = z.object({ rfx_id: z.uuid(), vendor_id: z.uuid(), mailbox_id: z.uuid(), email_text: z.string().max(100_000).optional() });

// Vendor portal (mock mailbox): the vendor replies to one of our emails; it waits unread until the buyer syncs.
export const POST = route(async (req: Request) => {
  await requireApiUser(["buyer", "admin"]);
  if (Number(req.headers.get("content-length") ?? 0) > LIMIT) throw new AppError("TOO_LARGE", "The upload is over 4.5 MB — the limit here. Send a smaller photo or scan, split the files, or paste the email text.", undefined, 413);
  const form = await req.formData().catch(() => { throw new AppError("BAD_REQUEST", "Expected multipart form data."); });
  const f = Fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")));
  if (!f.success) throw new AppError("BAD_REQUEST", "Missing or invalid fields.", z.flattenError(f.error));
  await assertOpen({ rfx: f.data.rfx_id });
  const files = await Promise.all(form.getAll("files").filter((x): x is File => x instanceof File && x.size > 0)
    .map(async (x) => ({ name: x.name, mime: x.type, buf: Buffer.from(await x.arrayBuffer()) })));
  return replyAsVendor({ rfxId: f.data.rfx_id, vendorId: f.data.vendor_id, mailboxId: f.data.mailbox_id, text: f.data.email_text ?? null, files });
});
