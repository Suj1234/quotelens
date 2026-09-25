import { describe, expect, it } from "vitest";
import { SettingSchemas as S, templateChanges, type CategoryTemplate } from "./settings-schema";

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
  it("enums; discount, freight and cost of money are no longer settings (P10)", () => {
    expect(S.decision_provider.safeParse("jev").success).toBe(true);
    expect(S.decision_provider.safeParse("openai").success).toBe(false);
    expect(S.email_mode.safeParse("mock").success).toBe(true);
    expect(S.email_mode.safeParse("gmail").success).toBe(false);
    expect(Object.keys(S)).not.toContain("discount_default");
    expect(Object.keys(S)).not.toContain("freight_default_inr_per_1000");
    expect(Object.keys(S)).not.toContain("landed_cost");
    expect(S.price_check.safeParse({ median_ratio: 2 }).success).toBe(true);
    expect(S.price_check.safeParse({ median_ratio: 2, rs_per_kg_min: 25, rs_per_kg_max: 150 }).success).toBe(false); // now per category
  });
});

describe("templateChanges (Masters change history)", () => {
  const t: CategoryTemplate = {
    source: "MER-0417", title_pattern: "{category} — {plants} — FY{year}",
    standard_terms: { currency: "INR", quote_unit: "per_1000_pcs", incoterm: "delivered", freight_included: true, tax_basis: "excl_gst", payment_terms_days: 60, validity_days: 90, contract_months: 12 },
    line_rules: { required: ["description", "ply"], recommended: ["gsm_spec"], allowed_ply: [3, 5] },
    question_library: [{ text: "Do you hold BRC certification?", answer_type: "yes_no", mandatory: true, disqualify_if: "no" }, { text: "Monthly capacity in tonnes?", answer_type: "number", mandatory: true, disqualify_if: null }],
    approved_vendor_ids: ["a"], price_band: { rs_per_kg_min: 25, rs_per_kg_max: 150 },
  };
  const name = (id: string) => ({ a: "Balaji", b: "Kohinoor" })[id] ?? id;
  it("names each change and files it under its sub-tab", () => {
    const after: CategoryTemplate = { ...t, standard_terms: { ...t.standard_terms, validity_days: 45 },
      line_rules: { ...t.line_rules, required: ["description", "ply", "gsm_spec"], recommended: [] },
      question_library: [t.question_library[0], { ...t.question_library[1], mandatory: false }], approved_vendor_ids: ["b"] };
    expect(templateChanges(t, after, name)).toEqual([
      { part: "terms", text: "Standard terms: validity 90 → 45 days" },
      { part: "lines", text: "Line fields: GSM spec recommended → required" },
      { part: "questions", text: "Question L2: no longer mandatory" },
      { part: "approved", text: "Approved vendors: added Kohinoor" },
      { part: "approved", text: "Approved vendors: removed Balaji" },
    ]);
  });
  it("added / removed questions when the count changes; nothing when nothing changed", () => {
    expect(templateChanges(t, { ...t, question_library: [t.question_library[1]] })).toEqual([{ part: "questions", text: "Question L1 removed: “Do you hold BRC certification?”" }]);
    expect(templateChanges(t, { ...t, question_library: [...t.question_library, { text: "Food-grade inks used?", answer_type: "yes_no", mandatory: false, disqualify_if: null }] }))
      .toEqual([{ part: "questions", text: "Question L3 added: “Food-grade inks used?”" }]);
    expect(templateChanges(t, structuredClone(t))).toEqual([]);
  });
});
