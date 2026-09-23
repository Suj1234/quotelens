import "server-only";
import { db } from "@/lib/db";

export type Settings = {
  email_mode: "mock" | "gmail" | "resend";
  decision_provider: "auto" | "gemini" | "jev";
  thresholds: { act: number; review: number };
  fx_rates: Record<string, { rate: number; date: string; source: string }>;
  landed_cost: { include_tax: boolean; cost_of_money_annual_pct: number };
  discount_default: "gross" | "net";
  vendor_addresses: Record<string, string>;
};

// Seed defaults (TRD §6.19) — used when a key is missing.
const DEFAULTS: Settings = {
  email_mode: "mock", decision_provider: "auto", thresholds: { act: 0.85, review: 0.6 },
  fx_rates: {}, landed_cost: { include_tax: false, cost_of_money_annual_pct: 0 }, discount_default: "gross", vendor_addresses: {},
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return (data?.value as Settings[K]) ?? DEFAULTS[key];
}
