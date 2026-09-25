// 0016 vendor check on the real pipeline (real model calls), on two throwaway copies of MER-0419 that are deleted afterwards.
//  RFx A: the five clean seed replies → no vendor card.   RFx B: the five realistic replies → no vendor card.
//  RFx C: Balaji's clean reply; OrientPack's ONLY reply is Balaji's realistic sheet (other bytes) → one card from the letterhead
//         alone, prices held; Keep releases them. (A vendor's second reply never overwrites its first reply's prices.)
//  RFx D: Balaji's realistic reply; OrientPack's only reply is the same sheet → letterhead + same-file reasons; Exclude.
// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/test-vendor-check.ts
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { runAll } from "@/lib/pipeline/run";
import { HOLD_NOTE } from "@/lib/pipeline/vendor-check";
import { createResponse, seedReply } from "@/lib/responses";
import { act } from "@/lib/review";
import type { SessionUser } from "@/lib/auth";

const src = (await db().from("rfx").select("*").eq("code", "MER-0419").single()).data!;
const [linesQ, questionsQ, vendorsQ, userQ] = await Promise.all([
  db().from("rfx_lines").select("*").eq("rfx_id", src.id),
  db().from("rfx_questions").select("*").eq("rfx_id", src.id),
  db().from("rfx_vendors").select("vendor_id, vendors(short_code)").eq("rfx_id", src.id),
  db().from("users").select("id, name, email, role").eq("role", "buyer").limit(1).single(),
]);
const user = userQ.data as SessionUser;
const vendor = (code: string) => (vendorsQ.data ?? []).find((v) => (v.vendors as unknown as { short_code: string }).short_code === code)!.vendor_id as string;
const omit = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const created: { id: string; code: string }[] = [];

async function makeRfx(tag: string) {
  const code = `TEST-VC-${tag}-${Date.now().toString(36).toUpperCase()}`;
  const rfx = (await db().from("rfx").insert({ ...omit(src, "id", "code", "created_at", "updated_at"), code, title: `vendor check test ${tag}`, status: "receiving", copilot_transcript: [] }).select("id").single()).data!;
  created.push({ id: rfx.id, code });
  await db().from("rfx_lines").insert((linesQ.data ?? []).map((l) => ({ ...omit(l, "id", "rfx_id"), rfx_id: rfx.id })));
  await db().from("rfx_questions").insert((questionsQ.data ?? []).map((q) => ({ ...omit(q, "id", "rfx_id"), rfx_id: rfx.id })));
  await db().from("rfx_vendors").insert((vendorsQ.data ?? []).map((v) => ({ rfx_id: rfx.id, vendor_id: v.vendor_id, reply_tag: `${code.toLowerCase()}-${(v.vendors as unknown as { short_code: string }).short_code}`, status: "invited" })));
  return rfx.id as string;
}
async function reply(rfxId: string, from: string, set: "clean" | "realistic", as = from) {
  const r = (await seedReply(from, set))!;
  const id = await createResponse({ rfxId, vendorId: vendor(as), source: "mock_upload", files: r.files, emailText: as === from ? r.emailText : null, actor: "system" });
  const errors: string[] = [];
  for await (const ev of runAll(id, "system")) if (ev.status === "error") errors.push(`${ev.stage}: ${ev.error}`);
  const card = (await db().from("review_items").select("id, title, detail, status").eq("response_id", id).eq("type", "vendor_mismatch").maybeSingle()).data;
  console.log(`  ${from}${as !== from ? ` sent as ${as}` : ""} (${set}): ${errors.length ? `ERRORS ${errors.join("; ")}` : "ok"} · ${card ? `CARD — ${card.detail}` : "no vendor card"}`);
  return { id, card, errors };
}
const five = async (rfxId: string, set: "clean" | "realistic") => {
  const out = [];
  for (const pair of [["balaji", "kohinoor", "westline"], ["orientpack", "anand"]]) out.push(...await Promise.all(pair.map((v) => reply(rfxId, v, set))));
  return out;
};
const held = async (responseId: string) => (await db().from("line_quotes").select("id", { count: "exact", head: true }).eq("response_id", responseId).eq("best_guess_note", HOLD_NOTE)).count ?? 0;
const cellStates = async (responseId: string) => (await db().from("line_quotes").select("state").eq("response_id", responseId)).data!.map((c) => c.state);

try {
  for (const [tag, set] of [["A", "clean"], ["B", "realistic"]] as const) {
    console.log(`RFx ${tag} — ${set} set`);
    const out = await five(await makeRfx(tag), set);
    assert.ok(out.every((r) => !r.errors.length), `pipeline errors on the ${set} set`);
    assert.equal(out.filter((r) => r.card).length, 0, `false alarm on a genuine ${set} reply`);
  }

  console.log("RFx C — letterhead only");
  const c = await makeRfx("C");
  await reply(c, "balaji", "clean");
  const cBad = await reply(c, "balaji", "realistic", "orientpack");
  assert.ok(cBad.card, "no card for Balaji's sheet sent as OrientPack");
  assert.match(cBad.card!.detail ?? "", /Sri Balaji/i);
  assert.doesNotMatch(cBad.card!.detail ?? "", /same file/i);
  const h = await held(cBad.id);
  assert.ok(h > 0, "prices not held");
  console.log(`  ✓ ${h} prices held`);
  await act(cBad.card!.id, "confirm", {}, user);
  assert.equal(await held(cBad.id), 0);
  assert.ok((await cellStates(cBad.id)).filter((s) => s === "reviewed").length >= h);
  console.log("  ✓ Keep released them as reviewed");

  console.log("RFx D — same file from two vendors");
  const d = await makeRfx("D");
  await reply(d, "balaji", "realistic");
  const dBad = await reply(d, "balaji", "realistic", "orientpack");
  assert.ok(dBad.card, "no card for the duplicate sheet");
  assert.match(dBad.card!.detail ?? "", /same file/i);
  assert.ok(await held(dBad.id) > 0, "duplicate's prices not held");
  await act(dBad.card!.id, "exclude", { reason: "Balaji's quote uploaded under OrientPack by mistake" }, user);
  assert.ok((await cellStates(dBad.id)).every((s) => s === "excluded" || s === "not_quoted"));
  console.log("  ✓ Exclude removed the whole reply");
  const calls = (await db().from("model_calls").select("id", { count: "exact", head: true }).in("rfx_id", created.map((c) => c.id)).eq("purpose", "vendor_check")).count;
  console.log(`  vendor_check decisions logged: ${calls}`);
} finally {
  for (const c of created) {
    const files = (await db().from("response_files").select("storage_path, derived_text_path, derived_image_paths, responses!inner(rfx_id)").eq("responses.rfx_id", c.id)).data ?? [];
    const raw = files.map((f) => f.storage_path), derived = files.flatMap((f) => [f.derived_text_path, ...((f.derived_image_paths as string[] | null) ?? [])]).filter(Boolean) as string[];
    if (raw.length) await db().storage.from("raw").remove(raw);
    if (derived.length) await db().storage.from("derived").remove(derived);
    await db().from("review_items").delete().eq("rfx_id", c.id);
    const del = await db().from("rfx").delete().eq("id", c.id);
    console.log(del.error ? `Couldn't delete ${c.code}: ${del.error.message}` : `Deleted ${c.code}.`);
  }
}
