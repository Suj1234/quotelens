import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession, type SessionOptions } from "iron-session";
import { db } from "@/lib/db";
import { AppError, requireEnv } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import type { Role, User } from "@/types/db";

export type SessionUser = { id: string; name: string; email: string; role: Role };
type SessionData = { user?: SessionUser };

function sessionOptions(): SessionOptions {
  return {
    password: requireEnv("SESSION_SECRET"),
    cookieName: "ql_session",
    ttl: 60 * 60 * 24 * 7,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function currentUser(): Promise<SessionUser | null> {
  return (await getSession()).user ?? null;
}

/** For pages: redirect to sign-in when logged out. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/");
  if (roles && !roles.includes(user.role)) redirect("/rfx");
  return user;
}

/** For route handlers: throw 401/403 instead of redirecting. */
export async function requireApiUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Sign in first", undefined, 401);
  if (roles && !roles.includes(user.role)) throw new AppError("FORBIDDEN", "Not allowed for your role", undefined, 403);
  return user;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const { data, error } = await db().from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle<User>();
  if (error) throw error;
  if (!data || !(await verifyPassword(password, data.password_hash))) {
    throw new AppError("BAD_CREDENTIALS", "That email and password don't match.", undefined, 401);
  }
  const user: SessionUser = { id: data.id, name: data.name, email: data.email, role: data.role };
  const session = await getSession();
  session.user = user;
  await session.save();
  return user;
}

export async function logout() {
  (await getSession()).destroy();
}
