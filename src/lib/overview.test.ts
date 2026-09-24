import { describe, expect, it } from "vitest";
import { groupNeeds } from "./overview";

describe("groupNeeds (DESIGN §3.4 Needs you)", () => {
  it("folds same-type cards of one vendor into one row with the item numbers", () => {
    const rows = groupNeeds([
      ...[5, 9, 15, 19].map((n) => ({ vendor: "Westline", type: "ambiguous_unit", title: `Item ${n}: price per bundle, bundle size not stated`, line_no: n })),
      { vendor: "Kohinoor", type: "validity_short", title: "Validity 30 days (RFx asked 60)", line_no: null },
    ]);
    expect(rows).toEqual([
      { vendor: "Kohinoor", text: "Validity 30 days (RFx asked 60)", count: 1 },
      { vendor: "Westline", text: "4 × price per bundle, bundle size not stated (items 5, 9, 15 and 19)", count: 4 },
    ]);
  });
});
