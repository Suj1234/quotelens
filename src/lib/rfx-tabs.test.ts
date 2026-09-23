import { expect, test } from "vitest";
import { spans } from "./rfx-tabs";

test("line spans for the ledger", () => {
  expect(spans([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
  expect(spans([23, 24, 25, 26, 27, 28, 29, 30])).toBe("23–30");
  expect(spans([9])).toBe("9");
  expect(spans([])).toBe("—");
});
