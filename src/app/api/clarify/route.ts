import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { draftClarification } from "@/lib/clarify";

export const maxDuration = 60;
const Body = z.object({ rfx_id: z.uuid(), vendor_id: z.uuid(), review_item_ids: z.array(z.uuid()).min(1).max(40) });

// TRD §16 POST /api/clarify → P-CLARIFY draft {subject, body} for the chosen cards; nothing is sent.
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new AppError("BAD_REQUEST", "rfx_id, vendor_id and at least one review item are required.");
  await assertOpen({ rfx: b.data.rfx_id });
  return draftClarification(b.data.rfx_id, b.data.vendor_id, b.data.review_item_ids, user);
});
