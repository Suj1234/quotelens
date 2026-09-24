import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { listRfx } from "@/lib/rfx";
import { createDraft } from "@/lib/rfx-draft";

// TRD §16 GET/POST /api/rfx. Creating is the buyer's (DESIGN §4).
export const GET = route(async () => {
  await requireApiUser();
  return { items: await listRfx() };
});

const Body = z.object({ title: z.string().max(200).optional(), category: z.string().max(100).optional() });
export const POST = route(async (req: Request) => {
  const user = await requireApiUser(["buyer", "admin"]);
  const body = Body.safeParse(await req.json().catch(() => ({})));
  return { id: await createDraft(body.success ? body.data : {}, user) };
});
