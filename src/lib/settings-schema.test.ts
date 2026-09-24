import { describe, expect, it } from "vitest";
import { SettingSchemas as S } from "./settings-schema";

describe("settings validation (PUT /api/settings)", () => {
  it("thresholds need 0 < review < act ≤ 1", () => {
    expect(S.thresholds.safeParse({ act: 0.85, review: 0.6 }).success).toBe(true);
    expect(S.thresholds.safeParse({ act: 1, review: 0.01 }).success).toBe(true);
    for (const t of [{ act: 0.6, review: 0.6 }, { act: 0.5, review: 0.7 }, { act: 1.1, review: 0.6 }, { act: 0.85, review: 0 }, { act: 0.85 }])
      expect(S.thresholds.safeParse(t).success).toBe(false);
  });
  it("fx rates: positive rate, ISO date, source; no INR", () => {
    expect(S.fx_rates.safeParse({ USD: { rate: 83.15, date: "2026-09-23", source: "manual" } }).success).toBe(true);
    expect(S.fx_rates.safeParse({ USD: { rate: 0, date: "2026-09-23", source: "manual" } }).success).toBe(false);
    expect(S.fx_rates.safeParse({ USD: { rate: 83, date: "23 Sep", source: "manual" } }).success).toBe(false);
    expect(S.fx_rates.safeParse({ USD: { rate: 83, date: "2026-09-23", source: " " } }).success).toBe(false);
    expect(S.fx_rates.safeParse({ usd: { rate: 83, date: "2026-09-23", source: "m" } }).success).toBe(false);
    expect(S.fx_rates.safeParse({ INR: { rate: 1, date: "2026-09-23", source: "m" } }).success).toBe(false);
  });
  it("enums and freight", () => {
    expect(S.decision_provider.safeParse("jev").success).toBe(true);
    expect(S.decision_provider.safeParse("openai").success).toBe(false);
    expect(S.discount_default.safeParse("net").success).toBe(true);
    expect(S.discount_default.safeParse("half").success).toBe(false);
    expect(S.email_mode.safeParse("mock").success).toBe(true);
    expect(S.email_mode.safeParse("gmail").success).toBe(false);
    expect(S.freight_default_inr_per_1000.safeParse(0).success).toBe(true);
    expect(S.freight_default_inr_per_1000.safeParse(-1).success).toBe(false);
    expect(S.freight_default_inr_per_1000.safeParse("180").success).toBe(false);
  });
});
