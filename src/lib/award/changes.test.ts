import { describe, expect, it } from "vitest";
import { memoChanges } from "./changes";

const row = (line_no: number, vendor: string | null, price: number | null, extra: { is_override?: boolean; reason?: string } = {}) =>
  ({ line_no, description: `L${line_no}`, annual_qty: 72_000, vendor, price, annual_value: price === null ? null : price * 72, runner_up: null, runner_up_price: null, gap_pct: null, reason: extra.reason ?? "Lowest price", is_override: !!extra.is_override });
const memo = (id: string, name: string, allocation: ReturnType<typeof row>[]) => {
  const total = allocation.reduce((a, r) => a + (r.annual_value ?? 0), 0);
  return { scenario: { id, name, rule_text: "", price_basis: "unit" as const, question: null, sql: null, fingerprint: "" }, allocation,
    totals: { total, allocated: allocation.length, lines: allocation.length, unallocated: [], single_source: [], vendors: [], total_after: total } };
};

describe("memo changes (MER-0424: Priya asked for another vendor on line 29)", () => {
  it("lists the changed line with who it moved from and to, the reason, and the cost difference", () => {
    const v1 = memo("s1", "5-ply qualified, 3-ply cheapest", [row(28, "Westline", 15_800), row(29, "Westline", 6_850)]);
    const v2 = memo("s1", "renamed", [row(28, "Westline", 15_800), row(29, "Anand Box Works", 6_880, { is_override: true, reason: "manual override: Priya asked for another vendor" })]);
    const c = memoChanges(v1, v2);
    expect(c.option).toBeNull(); // a rename is not a different option
    expect(c.lines).toEqual([{ line_no: 29, description: "L29", from: "Westline", to: "Anand Box Works", from_price: 6_850, to_price: 6_880, delta: 2_160, reason: "Priya asked for another vendor" }]);
    expect(c.total_delta).toBe(2_160);
  });
  it("no line changes when the split is the same; a different option is named", () => {
    const a = memo("s1", "A", [row(1, "Anand", 100)]);
    expect(memoChanges(a, a)).toEqual({ option: null, lines: [], total_delta: 0 });
    expect(memoChanges(a, { ...a, scenario: { ...a.scenario, id: "s2", name: "B" } }).option).toEqual({ from: "A", to: "B" });
  });
});
