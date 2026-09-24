import { expect, test, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: () => { throw new Error("no db in unit tests"); } }));
const { describeEdit } = await import("./rfx-draft");
type D = Parameters<typeof describeEdit>[0];

const line = (n: number, over: Record<string, unknown> = {}) => ({ line_no: n, sku: `SKU-${n}`, description: `Box ${n}`, ply: 5, monthly_qty: 1000, delivery_location: "Hosur", ...over });
const draft = (o: { lines?: unknown[]; rfx?: Record<string, unknown>; vendors?: string[] } = {}) => ({
  rfx: { title: "T", payment_terms_days: 45, ...o.rfx }, lines: o.lines ?? [line(1), line(2), line(3)], questions: [],
  vendors: (o.vendors ?? ["Anand"]).map((name) => ({ name })), addressBook: [],
}) as unknown as D;

test("a removed line, a changed quantity, a changed term and a removed vendor are described", () => {
  const before = draft(), after = draft({ lines: [line(1), line(2, { line_no: 2, sku: "SKU-3", description: "Box 3", monthly_qty: 500 })], rfx: { payment_terms_days: 30 }, vendors: [] });
  const text = describeEdit(before, after)!;
  expect(text).toContain("payment days 45 → 30");
  expect(text).toContain("removed line 2 (Box 2)");
  expect(text).toContain("line 2 monthly qty 1000 → 500");
  expect(text).toContain("(now 2)");
  expect(text).toContain("Vendors: removed Anand");
});

test("no change → null", () => {
  expect(describeEdit(draft(), draft())).toBeNull();
});
