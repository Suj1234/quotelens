import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ask } from "@/lib/query/ask";

export const maxDuration = 120; // TRD §21

const Body = z.object({
  rfx_id: z.uuid(),
  question: z.string().trim().min(1, "Type a question first.").max(1000),
  include_best_guess: z.boolean().optional(),
  base_query_id: z.uuid().optional(), // "Include best guesses" re-runs this answer's SQL (TRD §13.2)
});

// TRD §13.1. Both roles may ask (DESIGN §4).
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new AppError("BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid request.", z.flattenError(body.error));
  const { rfx_id, question, include_best_guess, base_query_id } = body.data;
  return ask({ rfxId: rfx_id, question, userId: user.id, includeBestGuess: include_best_guess, baseQueryId: base_query_id });
});
