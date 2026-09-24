import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getAllSettings, putSetting } from "@/lib/settings";

const ADMIN = ["buyer", "admin"] as const;
const Body = z.object({ key: z.string().min(1), value: z.unknown() });

// TRD §16 GET/PUT /api/settings (DESIGN §4: buyer/admin only). Settings are global — they apply to every later stage run.
export const GET = route(async () => {
  await requireApiUser([...ADMIN]);
  return { settings: await getAllSettings(), openrouter_key: !!process.env.OPENROUTER_API_KEY };
});

export const PUT = route(async (req: Request) => {
  const user = await requireApiUser([...ADMIN]);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success || b.data.value === undefined) throw new AppError("BAD_REQUEST", "Send {key, value}.");
  return { settings: await putSetting(b.data.key, b.data.value, user.id) };
});
