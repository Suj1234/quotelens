import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { SettingSchemas, type Settings } from "@/lib/settings-schema";
import { PRICE_CHECK_DEFAULT } from "@/lib/price-check";

export type { Settings } from "@/lib/settings-schema";

// Seed defaults (TRD §6.19) — used when a key is missing.
const DEFAULTS: Settings = {
  email_mode: "mock", decision_provider: "auto", thresholds: { act: 0.85, review: 0.6 },
  fx_rates: {}, vendor_addresses: {},
  price_check: PRICE_CHECK_DEFAULT, // P9 Q3: 2× median (the ₹/kg band is in the category template, P10 S4)
  category_templates: {}, // none until seeded (scripts/seed-template.ts) or set in Settings → Masters; the co-pilot then asks for everything
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return (data?.value as Settings[K]) ?? DEFAULTS[key];
}

/** GET /api/settings: every key, stored value or default. */
export async function getAllSettings(): Promise<Settings> {
  const { data, error } = await db().from("settings").select("key, value");
  if (error) throw error;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const r of data ?? []) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out as Settings;
}

/** PUT /api/settings: validated per key; the change is an audit event with before / after (TRD §17.13). */
export async function putSetting(key: string, value: unknown, actor: string): Promise<Settings> {
  const schema = SettingSchemas[key as keyof Settings];
  if (!schema) throw new AppError("UNKNOWN_SETTING", `Unknown setting "${key}".`);
  const v = schema.safeParse(value);
  if (!v.success) throw new AppError("BAD_REQUEST", v.error.issues[0]?.message ?? "Invalid value.");
  const before = await getSetting(key as keyof Settings);
  const { error } = await db().from("settings").upsert({ key, value: v.data, updated_at: new Date().toISOString() });
  if (error) throw error;
  await audit({ rfx_id: null, actor, event: "settings.changed", payload: { key, before, after: v.data } });
  return getAllSettings();
}
