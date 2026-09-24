import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

/** A new supplier (address book entry) with a unique short code derived from its name. */
export async function createVendor(name?: string, email?: string): Promise<{ id: string; short_code: string }> {
  name = name?.trim(); email = email?.trim();
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError("BAD_INPUT", "Give the new vendor a name and a valid email.", undefined, 400);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "vendor";
  const { data: taken } = await db().from("vendors").select("short_code").like("short_code", `${base}%`);
  const code = taken?.length ? `${base}${taken.length + 1}` : base;
  const { data: v, error } = await db().from("vendors").insert({ name, email, short_code: code, created_by: "user" }).select("id, short_code").single();
  if (error) throw error;
  return v as { id: string; short_code: string };
}
