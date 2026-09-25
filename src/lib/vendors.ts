import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";

/** A new supplier (address book entry) with a unique short code derived from its name. */
export async function createVendor(name: string | undefined, email: string | undefined, actor: string, extra: Partial<VendorInput> = {}, via = "rfx"): Promise<{ id: string; short_code: string }> {
  name = name?.trim(); email = email?.trim();
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError("BAD_INPUT", "Give the new vendor a name and a valid email.", undefined, 400);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "vendor";
  const { data: taken } = await db().from("vendors").select("short_code").like("short_code", `${base}%`);
  const code = taken?.length ? `${base}${taken.length + 1}` : base;
  const { data: v, error } = await db().from("vendors").insert({ ...extra, name, email, short_code: code, created_by: "user" }).select("id, short_code").single();
  if (error) throw error;
  await audit({ rfx_id: null, actor, event: "vendor.created", entity_type: "vendor", entity_id: v.id, payload: { name, email, via } });
  return v as { id: string; short_code: string };
}

// Settings → Masters → Vendor directory. The short code is fixed once made: reply tags and the eval key use it.
const opt = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().optional();
export const VendorInput = z.object({
  name: z.string().trim().min(2, "Give the vendor's name.").max(120),
  email: z.email("Give a valid email — RFx emails go to it.").trim().toLowerCase(),
  contact_name: opt(80), city: opt(60), state: opt(60),
  country: z.string().trim().regex(/^[A-Z]{2}$/, "Country is a 2-letter code like IN.").default("IN"),
  default_currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency is a 3-letter code like INR.").default("INR"),
  notes: opt(500),
}).strict();
export type VendorInput = z.infer<typeof VendorInput>;
export type VendorRow = VendorInput & { id: string; short_code: string; created_by: string; created_at: string; rfx_count: number };

const COLS = "id, name, short_code, contact_name, email, city, state, country, default_currency, notes, created_by, created_at";

export async function listVendors(): Promise<VendorRow[]> {
  const [v, r] = await Promise.all([db().from("vendors").select(COLS).order("name"), db().from("rfx_vendors").select("vendor_id")]);
  if (v.error) throw v.error;
  const n = new Map<string, number>();
  for (const x of r.data ?? []) n.set(x.vendor_id, (n.get(x.vendor_id) ?? 0) + 1);
  return (v.data ?? []).map((x) => ({ ...x, rfx_count: n.get(x.id) ?? 0 })) as VendorRow[];
}

function parse(body: unknown): VendorInput {
  const p = VendorInput.safeParse(body);
  if (!p.success) throw new AppError("BAD_INPUT", p.error.issues[0]?.message ?? "Check the vendor's details.", undefined, 400);
  return p.data;
}
/** Two vendors on one address would make replies ambiguous, so the directory refuses a duplicate email. */
async function assertEmailFree(email: string, self?: string) {
  const { data } = await db().from("vendors").select("id, name").ilike("email", email);
  const other = (data ?? []).find((x) => x.id !== self);
  if (other) throw new AppError("DUPLICATE", `${other.name} already uses ${email}.`, undefined, 409);
}

export async function addVendor(body: unknown, actor: string) {
  const v = parse(body);
  await assertEmailFree(v.email);
  const { name, email, ...extra } = v;
  return createVendor(name, email, actor, extra, "directory");
}

export async function updateVendor(id: string, body: unknown, actor: string) {
  const v = parse(body);
  const { data: before, error } = await db().from("vendors").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!before) throw new AppError("NOT_FOUND", "That vendor doesn't exist.", undefined, 404);
  await assertEmailFree(v.email, id);
  const changed = (Object.keys(v) as (keyof VendorInput)[]).filter((k) => (before[k] ?? null) !== (v[k] ?? null));
  if (!changed.length) return { id, changed };
  const up = await db().from("vendors").update(v).eq("id", id);
  if (up.error) throw up.error;
  await audit({ rfx_id: null, actor, event: "vendor.updated", entity_type: "vendor", entity_id: id, payload: {
    name: v.name, changes: changed.map((k) => ({ field: k, before: before[k] ?? null, after: v[k] ?? null })),
  } });
  return { id, changed };
}
