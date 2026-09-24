import { describe, expect, it } from "vitest";
import { groupNeeds } from "./overview";

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
