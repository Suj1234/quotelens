import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { askHistory } from "@/lib/query/ask";

// TRD §16: last 20 answers for the RFx — the signed-in user's own (DECISIONS 2026-09-25 "Ask chat per user").
export const GET = route(async (req: Request) => {
  const user = await requireApiUser();
  const rfx = z.uuid().safeParse(new URL(req.url).searchParams.get("rfx"));
  if (!rfx.success) throw new AppError("BAD_REQUEST", "Pass ?rfx=<rfx id>.");
  return { items: await askHistory(rfx.data, user.id) };
});
