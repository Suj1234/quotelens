import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertOpen } from "@/lib/lock";
import { act, type Action } from "@/lib/review";

// TRD §16 POST /api/review/bulk {ids, action} — e.g. "Acknowledge all assumptions". One failure doesn't stop the rest.
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const { ids, action } = (await req.json().catch(() => ({}))) as { ids?: string[]; action?: Action };
  if (!Array.isArray(ids) || !ids.length || !action) throw new AppError("BAD_INPUT", "ids and action are required", undefined, 400);
  await assertOpen({ reviewItems: ids });
  const results = [];
  for (const id of ids) {
    try { results.push({ id, ...(await act(id, action, {}, user)) }); }
    catch (e) { results.push({ id, error: (e as Error).message }); }
  }
  return { results };
});
