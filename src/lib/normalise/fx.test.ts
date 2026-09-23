import { expect, test } from "vitest";
import { currencyCode } from "./fx";

test("currency as written → ISO code", () => {
  for (const r of ["₹", "Rs", "Rs.", "INR", "rupees", "Rs. (INR)"]) expect(currencyCode(r)).toBe("INR");
  for (const r of ["$", "USD", "US$", "usd per 1000"]) expect(currencyCode(r)).toBe("USD");
  expect(currencyCode("€")).toBe("EUR");
  expect(currencyCode(null)).toBeNull();
  expect(currencyCode("per box")).toBeNull();
});
