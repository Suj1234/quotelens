import { expect, test } from "vitest";
import { verdict } from "./run";

const g = (o: object) => ({ line_no: 1, vendor_code: "v", expected_state: "confirmed", expected_unit_price_inr_per_1000: 1000, ...o });
const c = (state: string, value: number | null, best_guess: number | null = null) => ({ state, value, best_guess });

test("README §5 verdict rules", () => {
  expect(verdict(g({}), c("confirmed", 1009), 1, false).verdict).toBe("correct");
  expect(verdict(g({}), c("confirmed", 1011), 1, false).verdict).toBe("wrong");
  expect(verdict(g({}), null, 1, false).verdict).toBe("missing");
  expect(verdict(g({}), c("ambiguous", null, 1000), 1, false).verdict).toBe("flagged_ok");
  expect(verdict(g({}), c("low_confidence", null, 1200), 1, false).verdict).toBe("wrong");
  // Kohinoor alt: printed value + confirmed is flagged_ok only with a discount_treatment review item
  const k = g({ expected_state: "inferred", expected_unit_price_inr_per_1000: 1025.64, alt_expected_state: "confirmed", alt_expected_unit_price_inr_per_1000: 1000 });
  expect(verdict(k, c("confirmed", 1000), 1, true).verdict).toBe("flagged_ok");
  expect(verdict(k, c("confirmed", 1000), 1, false).verdict).toBe("wrong");
  // unpriced expectations need the exact state; a fabricated number is wrong
  const rp = g({ expected_state: "references_prior", expected_unit_price_inr_per_1000: null });
  expect(verdict(rp, c("references_prior", null), 1, false).verdict).toBe("correct");
  expect(verdict(rp, c("inferred", 900), 1, false).verdict).toBe("wrong");
  // ambiguous with a best guess: guess must be within tolerance
  const amb = g({ expected_state: "ambiguous", expected_unit_price_inr_per_1000: null, best_guess: 27960 });
  expect(verdict(amb, c("ambiguous", null, 27960), 1, false).verdict).toBe("correct");
  expect(verdict(amb, c("ambiguous", null, 30000), 1, false).verdict).toBe("wrong");
  // OrientPack 14: legible read accepted as inferred
  const lc = g({ expected_state: "low_confidence", expected_unit_price_inr_per_1000: null, best_guess: 7510.11 });
  expect(verdict(lc, c("low_confidence", null), 1, false).verdict).toBe("correct");
  expect(verdict(lc, c("inferred", 7510), 1, false).verdict).toBe("correct");
  // after clarification
  const cl = g({ expected_state: "ambiguous", expected_unit_price_inr_per_1000: null, best_guess: 54960, after_clarification: { expected_state: "reviewed", expected_unit_price_inr_per_1000: 68700 } });
  expect(verdict(cl, c("reviewed", 68700), 1, false).verdict).toBe("correct");
});
