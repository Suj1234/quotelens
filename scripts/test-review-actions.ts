// Review tab: the two buyer inputs that write money (Enter prices… on "Missing prices", Change for {vendor}… on freight).
// Runs act() on a throwaway copy of MER-0419's lines and one vendor's cells, checks the grid and the ledger, then deletes it.
// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/test-review-actions.ts
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { act } from "@/lib/review";
import type { SessionUser } from "@/lib/auth";

const src = (await db().from("rfx").select("*").eq("code", "MER-0419").single()).data!;
const [linesQ, vendorQ, userQ] = await Promise.all([
  db().from("rfx_lines").select("*").eq("rfx_id", src.id).order("line_no"),
  db().from("rfx_vendors").select("vendor_id").eq("rfx_id", src.id).limit(1).single(),
  db().from("users").select("id, name, email, role").eq("role", "buyer").limit(1).single(),
]);
const user = userQ.data as SessionUser;
const vendorId = vendorQ.data!.vendor_id as string;
const omit = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const code = `TEST-RQ-${Date.now().toString(36).toUpperCase()}`;
const rfx = (await db().from("rfx").insert({ ...omit(src, "id", "code", "created_at", "updated_at"), code, title: "review actions test", status: "reviewing", copilot_transcript: [] }).select("id").single()).data!;
try {
  const lines = [];
  for (const l of (linesQ.data ?? []).slice(0, 4)) lines.push((await db().from("rfx_lines").insert({ ...omit(l, "id", "rfx_id"), rfx_id: rfx.id }).select("id, line_no").single()).data!);
  await db().from("rfx_vendors").insert({ rfx_id: rfx.id, vendor_id: vendorId, reply_tag: code.toLowerCase(), status: "responded" });
  // Lines 1–2 priced at 10 000; lines 3–4 "same as last year" (no price).
  const cells = (await db().from("line_quotes").insert(lines.map((l, i) => ({ rfx_id: rfx.id, rfx_line_id: l.id, vendor_id: vendorId,
    ...(i < 2 ? { state: "confirmed", unit_price_inr_per_1000: 10000, landed_price_inr_per_1000: 10180 } : { state: "references_prior" }) }))).select("id, rfx_line_id")).data!;
  await db().from("assumptions").insert({ rfx_id: rfx.id, vendor_id: vendorId, kind: "freight_treatment", basis: "settings_default", made_by: "system", description: "default freight", value: { inr_per_1000: 180 } });
  const [prior, freight] = (await db().from("review_items").insert([
    { rfx_id: rfx.id, vendor_id: vendorId, type: "prior_pricing", title: "Items 3–4: “same as last year” — prior pricing not on file" },
    { rfx_id: rfx.id, vendor_id: vendorId, type: "freight_treatment", title: "freight extra — freight excluded", proposed_value: 180 },
  ]).select("id")).data!;
  const cell = async (n: number) => (await db().from("line_quotes").select("state, unit_price_inr_per_1000, landed_price_inr_per_1000").eq("id", cells[n - 1].id).single()).data!;

  // Enter prices: line 3 typed, line 4 left blank → not quoted; freight 180 added to landed.
  await assert.rejects(act(prior.id, "enter-prices", { prices: { 3: 12000 } }, user), /where the prices come from/);
  await act(prior.id, "enter-prices", { prices: { 3: 12000 }, reason: "last year's PO" }, user);
  assert.deepEqual(await cell(3), { state: "reviewed", unit_price_inr_per_1000: 12000, landed_price_inr_per_1000: 12180 });
  assert.equal((await cell(4)).state, "not_quoted");
  assert.equal((await db().from("review_items").select("status").eq("id", prior.id).single()).data!.status, "overridden");
  console.log("✓ Enter prices: typed line reviewed with freight, blank line not quoted, card closed");

  // Change freight to 0 (included): every priced cell's landed = unit; old ledger row superseded; rfx_vendors remembers it.
  await act(freight.id, "set-freight", { value: 0, reason: "vendor confirmed delivered price" }, user);
  for (const n of [1, 2, 3]) { const c = await cell(n); assert.equal(Number(c.landed_price_inr_per_1000), Number(c.unit_price_inr_per_1000), `line ${n}`); }
  const active = (await db().from("assumptions").select("value, basis").eq("rfx_id", rfx.id).eq("kind", "freight_treatment").is("superseded_by", null)).data!;
  assert.deepEqual(active, [{ value: { inr_per_1000: 0 }, basis: "buyer_entered" }]);
  assert.equal(Number((await db().from("rfx_vendors").select("freight_assumption_inr_per_1000").eq("rfx_id", rfx.id).single()).data!.freight_assumption_inr_per_1000), 0);
  console.log("✓ Change freight: landed prices recomputed, one active ledger row, stored for re-runs");
} finally {
  await db().from("review_items").delete().eq("rfx_id", rfx.id);
  const del = await db().from("rfx").delete().eq("id", rfx.id);
  console.log(del.error ? `Couldn't delete ${code}: ${del.error.message}` : `Deleted ${code}.`);
}
