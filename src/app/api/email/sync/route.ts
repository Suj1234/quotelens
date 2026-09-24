import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { syncInbox } from "@/lib/email/sync";

export const maxDuration = 120;

// TRD §16 POST /api/email/sync → {new_response_ids, skipped} (+ ignored, new_responses with vendor names for the toast).
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const body = z.object({ rfx_id: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) throw new AppError("BAD_REQUEST", "rfx_id is required.");
  await assertOpen({ rfx: body.data.rfx_id });
  return syncInbox(body.data.rfx_id, user.id);
});
