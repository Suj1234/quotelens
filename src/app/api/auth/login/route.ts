import { z } from "zod";
import { login } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";

const Body = z.object({ email: z.string().min(3), password: z.string().min(1) });

export const POST = route(async (req: Request) => {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new AppError("BAD_REQUEST", "Enter your email and password.");
  return { user: await login(body.data.email, body.data.password) };
});
