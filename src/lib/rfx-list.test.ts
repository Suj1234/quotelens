import { describe, expect, it } from "vitest";
import { DEFAULTS, applyFilters, deadlineText, nextStep, presetRange, type ListRow } from "./rfx-list";

const row = (o: Partial<ListRow>): ListRow => ({
  id: o.code ?? "x", code: "MER-0001", title: "Corrugated packaging", status: "draft",
  created: "2026-09-20T10:00:00Z", updated: "2026-09-24T10:00:00Z", deadline: null, lines: 30, invited: 5, responded: 0, open_reviews: 0, approved_at: null, annual_value: null, ...o,
});
const rows = [
  row({ code: "MER-0417", status: "awarded", annual_value: 45_300_000, approved_at: "2026-09-24T09:00:00Z", responded: 5 }),
  row({ code: "MER-0418", title: "Live run" }),
  row({ code: "MER-0419", status: "reviewing", open_reviews: 14, responded: 5, created: "2026-08-31T20:00:00Z", updated: "2026-09-01T00:00:00Z" }),
  row({ code: "MER-0420", title: "Untitled RFx", lines: 0 }),
];
const now = new Date("2026-09-25T06:00:00Z");

describe("rfx list", () => {
  it("filters by tab, search and date ranges (IST days, inclusive)", () => {
    expect(applyFilters(rows, { ...DEFAULTS, status: "draft" }).map((r) => r.code)).toEqual(["MER-0420", "MER-0418"]);
    expect(applyFilters(rows, { ...DEFAULTS, q: "0419" }).map((r) => r.code)).toEqual(["MER-0419"]);
    expect(applyFilters(rows, { ...DEFAULTS, q: "live" }).map((r) => r.code)).toEqual(["MER-0418"]);
    expect(applyFilters(rows, { ...DEFAULTS, ufrom: "2026-09-18", uto: "2026-09-25" })).toHaveLength(3);
    // 31 Aug 20:00 UTC is 1 Sep 01:30 IST
    expect(applyFilters(rows, { ...DEFAULTS, cfrom: "2026-09-01", cto: "2026-09-01" }).map((r) => r.code)).toEqual(["MER-0419"]);
    expect(applyFilters(rows, { ...DEFAULTS, cto: "2026-08-31" })).toHaveLength(0);
    expect(presetRange("7", now)).toEqual(["2026-09-19", "2026-09-25"]);
    expect(presetRange("month", now)).toEqual(["2026-09-01", "2026-09-25"]);
  });
  it("sorts with empty values last in both directions", () => {
    const asc = applyFilters(rows, { ...DEFAULTS, sort: "value", dir: "asc" });
    const desc = applyFilters(rows, { ...DEFAULTS, sort: "value", dir: "desc" });
    expect(asc[0].code).toBe("MER-0417");
    expect(desc[0].code).toBe("MER-0417");
  });
  it("states the next step and the deadline", () => {
    expect(nextStep(rows[2])).toEqual({ text: "14 to review", tone: "amber" });
    expect(nextStep(rows[3]).text).toBe("Finish lines");
    expect(nextStep(rows[1]).text).toBe("Ready to issue");
    expect(nextStep(rows[0])).toEqual({ text: "Approved 24 Sep", tone: "green" });
    expect(nextStep(row({ status: "issued", responded: 3 })).text).toBe("Waiting on 2 of 5");
    expect(deadlineText({ status: "issued", deadline: "2026-09-27" }, now)).toEqual({ text: "Due in 2 days", tone: "amber" });
    expect(deadlineText({ status: "issued", deadline: "2026-09-25" }, now).text).toBe("Due today");
    expect(deadlineText({ status: "awarded", deadline: "2026-09-01" }, now).text).toBe("Closed");
    expect(deadlineText({ status: "awarded", deadline: "2026-10-07" }, now).text).toBe("Closed");
  });
});
