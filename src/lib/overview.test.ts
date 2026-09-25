import { describe, expect, it, test } from "vitest";
import { groupNeeds, readingOf } from "./overview";

describe("groupNeeds (DESIGN §3.4 Needs you)", () => {
  it("folds same-type cards of one vendor into one row with the item numbers", () => {
    const rows = groupNeeds([
      ...[5, 9, 15, 19].map((n) => ({ vendor: "Westline", type: "ambiguous_unit", title: `Item ${n}: price per bundle, bundle size not stated`, line_no: n })),
      { vendor: "Kohinoor", type: "validity_short", title: "Validity 30 days (RFx asked 60)", line_no: null },
      { vendor: "OrientPack Ltd", type: "fx_assumption", title: "USD → INR at 83.15", line_no: null },
      { vendor: "OrientPack Ltd", type: "freight_treatment", title: "FOB Chennai — freight excluded", line_no: null },
      { vendor: "Anand Box Works", type: "freight_treatment", title: "Freight extra", line_no: null },
    ]);
    expect(rows).toEqual([
      { vendor: "Kohinoor", text: "Validity 30 days (RFx asked 60)", count: 1 },
      { vendor: "Westline", text: "4 × price per bundle, bundle size not stated (items 5, 9, 15 and 19)", count: 4 },
      { vendor: "Assumptions", text: "3 to acknowledge — freight (OrientPack, Anand), FX (OrientPack)", count: 3 },
    ]);
  });
});

const all = (s: string) => ({ classify: s, extract: s, map: s, normalise: s, questionnaire: s, flags: s });
const now = new Date().toISOString();
const old = new Date(Date.now() - 10 * 60_000).toISOString();

test("a reply is read only when all six stages are done", () => {
  expect(readingOf(all("done"), {}, now)).toEqual({ state: "read" });
  expect(readingOf(all("pending"), {}, now)).toEqual({ state: "unread" });
  expect(readingOf({ ...all("done"), flags: "pending" }, {}, now)).toEqual({ state: "unread" });
});

test("a failed stage wins and carries its reason", () => {
  expect(readingOf({ ...all("done"), extract: "error", map: "pending" }, { extract: "MODEL_INVALID" }, now)).toEqual({ state: "failed", stage: "extract", error: "MODEL_INVALID" });
});

test("running is reading until it goes stale, then it can be read again", () => {
  const ps = { ...all("pending"), classify: "done", extract: "running" };
  expect(readingOf(ps, {}, now)).toEqual({ state: "reading" });
  expect(readingOf(ps, {}, old)).toEqual({ state: "unread" });
});
