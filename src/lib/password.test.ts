import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("scrypt hash round-trips and rejects wrong or malformed input", async () => {
  const h = await hashPassword("s3cret");
  expect(h).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  expect(await verifyPassword("s3cret", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
  expect(await verifyPassword("s3cret", "scrypt$00$abcd")).toBe(false);
  expect(await verifyPassword("s3cret", "plain")).toBe(false);
});
