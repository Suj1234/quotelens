// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/test-seed-picker.ts
// Load seeded responses for picked vendors only, next to a real (portal) reply. On a throwaway copy of MER-0419 with four of
// its five vendors invited (no Westline): Anand replies by portal, the other three get seed replies; reload variants check
// that only invited, picked vendors are seeded and that the portal reply (and its clarification) survive and are re-read.
// Also times the freight card's Accept path (cells updated in parallel). Prints PASS/FAIL lines; deletes the RFx.
import { db } from "@/lib/db";
import { runAll } from "@/lib/pipeline/run";
import { createResponse, loadSeedResponses, seedPickVendors, seedReply } from "@/lib/responses";
import { act } from "@/lib/review";

const omit = <T extends object>(o: T, ...k: string[]) => Object.fromEntries(Object.entries(o).filter(([x]) => !k.includes(x)));
let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); };
const run = async (id: string) => { const errs: string[] = []; for await (const ev of runAll(id, "system")) if (ev.status === "error") errs.push(`${ev.stage}: ${ev.error?.slice(0, 80)}`); return errs; };

const src = (await db().from("rfx").select("*").eq("code", "MER-0419").single()).data!;
const [linesQ, questionsQ, vendorsQ, userQ] = await Promise.all([
  db().from("rfx_lines").select("*").eq("rfx_id", src.id), db().from("rfx_questions").select("*").eq("rfx_id", src.id),
  db().from("vendors").select("id, short_code"), db().from("users").select("id, name, email, role").eq("role", "buyer").limit(1).single(),
]);
const vid = (c: string) => vendorsQ.data!.find((v) => v.short_code === c)!.id as string;
const code = `TEST-SEED-${Date.now().toString(36).toUpperCase()}`;
const rfx = (await db().from("rfx").insert({ ...omit(src, "id", "code", "created_at", "updated_at"), code, title: "seed picker test", status: "receiving", copilot_transcript: [] }).select("id").single()).data!.id as string;
const invited = ["balaji", "kohinoor", "orientpack", "anand"];
const responses = async () => (await db().from("responses").select("id, vendor_id, source, is_clarification").eq("rfx_id", rfx)).data ?? [];
try {
  await db().from("rfx_lines").insert((linesQ.data ?? []).map((l) => ({ ...omit(l, "id", "rfx_id"), rfx_id: rfx })));
  await db().from("rfx_questions").insert((questionsQ.data ?? []).map((q) => ({ ...omit(q, "id", "rfx_id"), rfx_id: rfx })));
  await db().from("rfx_vendors").insert(invited.map((c) => ({ rfx_id: rfx, vendor_id: vid(c), reply_tag: `${code.toLowerCase()}-${c}`, status: "invited" })));

  // 1. Anand replies through the portal (a real reply, not a seed one), plus a clarification that answers it.
  const a = (await seedReply("anand"))!;
  const portal = await createResponse({ rfxId: rfx, vendorId: vid("anand"), source: "portal", files: a.files, emailText: a.emailText, actor: "system" });
  console.log(`Anand portal reply: ${(await run(portal)).join("; ") || "processed"}`);
  const portalCells = (await db().from("line_quotes").select("id").eq("response_id", portal)).data!.length;
  const clar = await createResponse({ rfxId: rfx, vendorId: vid("anand"), source: "portal", files: [], emailText: "Freight is extra at actuals.", actor: "system", clarification: { request_id: null, n: 1, supersedes: portal } });

  // 2. The picker: four invited rows, Anand marked replied, nothing for Westline.
  const pick = await seedPickVendors(rfx);
  check(pick.length === 4 && !pick.some((v) => v.id === vid("westline")), `picker lists the 4 invited vendors only (${pick.map((v) => v.name).join(", ")})`);
  check(pick.find((v) => v.id === vid("anand"))?.replied === true && pick.filter((v) => v.replied).length === 1, "picker marks Anand as already replied");

  // 3. Seed the other three — Westline asked for too, but it isn't invited, so it's ignored.
  const first = await loadSeedResponses(rfx, "clean", "system", [vid("balaji"), vid("kohinoor"), vid("orientpack"), vid("westline")]);
  check(first.ids.length === 3 && first.rerun.length === 0, `3 seed replies, nothing to re-read (got ${first.ids.length}, rerun ${first.rerun.length})`);
  const t0 = Date.now();
  const errs = (await Promise.all(first.ids.map(run))).flat();
  console.log(`Seed replies processed in ${((Date.now() - t0) / 1000).toFixed(0)} s${errs.length ? ` — ${errs.join("; ")}` : ""}`);
  let rs = await responses();
  const vendorsWithReply = new Set(rs.filter((r) => !r.is_clarification).map((r) => r.vendor_id));
  check(vendorsWithReply.size === 4 && !vendorsWithReply.has(vid("westline")), `4 of 4 vendors replied, no Westline (${vendorsWithReply.size})`);
  check(rs.some((r) => r.id === portal) && rs.some((r) => r.id === clar), "Anand's portal reply and clarification are untouched");
  check((await db().from("line_quotes").select("id").eq("response_id", portal)).data!.length === portalCells && portalCells > 0, `Anand's ${portalCells} cells from the portal reply are still there`);

  // 4. Freight Accept path timing (cells now updated in parallel).
  const freight = (await db().from("review_items").select("id, vendor_id").eq("rfx_id", rfx).eq("type", "freight_treatment").eq("status", "open")).data ?? [];
  if (freight.length) {
    const t1 = Date.now();
    await act(freight[0].id, "set-freight", { value: 1000, reason: "test" }, { ...userQ.data!, id: userQ.data!.id } as never);
    const ms = Date.now() - t1;
    const landed = (await db().from("line_quotes").select("unit_price_inr_per_1000, landed_price_inr_per_1000").eq("rfx_id", rfx).eq("vendor_id", freight[0].vendor_id).not("unit_price_inr_per_1000", "is", null)).data!;
    check(landed.every((c) => Math.abs(Number(c.landed_price_inr_per_1000) - Number(c.unit_price_inr_per_1000) - 1000) < 0.01), `set freight: all ${landed.length} landed prices = unit + 1000 (took ${ms} ms)`);
  } else console.log("SKIP  no open freight card to time");

  // 5. Reload seeding Anand too: a second (seed) reply on top; the portal reply stays.
  const second = await loadSeedResponses(rfx, "clean", "system", [vid("balaji"), vid("anand")]);
  rs = await responses();
  check(second.ids.length === 2 && rs.filter((r) => r.source === "seed").length === 2, "reload with Balaji + Anand: only those two have seed replies");
  check(!rs.some((r) => r.vendor_id === vid("kohinoor") || r.vendor_id === vid("orientpack")), "Kohinoor and OrientPack's earlier seed replies are gone");
  const st = (await db().from("rfx_vendors").select("vendor_id, status").eq("rfx_id", rfx)).data!;
  check(["kohinoor", "orientpack"].every((c) => st.find((s) => s.vendor_id === vid(c))?.status === "invited"), "Kohinoor and OrientPack are back to invited");
  check(second.rerun.length === 0, `no portal reply to re-read (Anand had no seed reply before) — rerun ${second.rerun.length}`);
  await Promise.all(second.ids.map(run));

  // 6. Reload with Balaji only: Anand's seed reply goes, its portal reply and clarification stay and come back to re-read, in order.
  const third = await loadSeedResponses(rfx, "clean", "system", [vid("balaji")]);
  rs = await responses();
  check(rs.some((r) => r.id === portal) && rs.some((r) => r.id === clar) && !rs.some((r) => r.vendor_id === vid("anand") && r.source === "seed"), "Anand's seed reply removed, portal reply + clarification kept");
  check(third.rerun.length === 2 && third.rerun[0] === portal && third.rerun[1] === clar, `re-read list = [portal reply, clarification] (got ${third.rerun.length})`);
  const buyerFreight = (await db().from("assumptions").select("id").eq("rfx_id", rfx).eq("vendor_id", freight[0]?.vendor_id ?? "").eq("basis", "buyer_entered")).data ?? [];
  if (freight[0]?.vendor_id === vid("anand")) check(buyerFreight.length > 0, "the buyer's freight decision for Anand is kept");
  await run(portal);
  check((await db().from("line_quotes").select("id").eq("response_id", portal)).data!.length === portalCells, `after re-reading, Anand's ${portalCells} portal cells are back`);
} finally {
  const files = (await db().from("response_files").select("storage_path, derived_text_path, derived_image_paths, responses!inner(rfx_id)").eq("responses.rfx_id", rfx)).data ?? [];
  const raw = files.map((f) => f.storage_path), derived = files.flatMap((f) => [f.derived_text_path, ...((f.derived_image_paths as string[] | null) ?? [])]).filter(Boolean) as string[];
  if (raw.length) await db().storage.from("raw").remove(raw);
  if (derived.length) await db().storage.from("derived").remove(derived);
  await db().from("review_items").delete().eq("rfx_id", rfx);
  const del = await db().from("rfx").delete().eq("id", rfx);
  console.log(del.error ? `Couldn't delete ${code}: ${del.error.message}` : `Deleted ${code}.`);
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
}
