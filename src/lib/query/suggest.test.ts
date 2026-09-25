import { describe, expect, it } from "vitest";
import { suggestQuestions, type RfxFacts } from "./suggest";

const v = (name: string, o: Partial<RfxFacts["vendors"][number]> = {}) =>
  ({ name, cleared: true, status: "responded", lines_priced: 10, lines_total: 10, freight_included: true, currency: "INR", discount_pct: null, ...o });

describe("suggestQuestions", () => {
  it("offers a question only when the RFx's data calls for it, with that RFx's names", () => {
    const q = suggestQuestions({ vendors: [v("Alpha"), v("Beta", { cleared: false, currency: "EUR" }), v("Gamma", { status: "invited", lines_priced: 0 })], unsure_cells: 0, scenarios: 0 });
    expect(q).toContain("Why did Beta fail the questionnaire?");
    expect(q).toContain("What if EUR moves 3% against the rupee?");
    expect(q).toContain("Which vendors haven't replied yet?");
    expect(q.some((x) => /unsure|not sure/.test(x))).toBe(false); // nothing is unsure
    expect(q.some((x) => /USD|scenarios/.test(x))).toBe(false);   // nobody quoted in USD; no saved scenarios
  });
  it("always has at least 3 questions, even on an RFx where nothing stands out", () => {
    const q = suggestQuestions({ vendors: [v("Alpha"), v("Beta")], unsure_cells: 0, scenarios: 0 });
    expect(q.length).toBeGreaterThanOrEqual(3);
    expect(q[0]).toBe("Cheapest vendor per line, only among vendors who cleared the questionnaire");
  });
});
