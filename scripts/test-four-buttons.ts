// Four-button check, end to end (DECISIONS 2026-09-25 "Four buttons"): every review card type the pipeline raises, every one
// of Accept · Change · Ask vendor · Exclude. Real replies go through the real pipeline on a throwaway copy of MER-0419; then for
// each card type each button is pressed through act() (the same call the Review tab makes), its effect on the grid / ledger /
// answers is checked, and the RFx is restored so the next button starts from the same state. Prints a matrix; deletes the RFx.
// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/test-four-buttons.ts
import { db } from "@/lib/db";
import { runAll } from "@/lib/pipeline/run";
import { checkPrices } from "@/lib/pipeline/flags";
import { createResponse, seedReply } from "@/lib/responses";
import { act, listReview, type Action, type ActBody, type QueueItem } from "@/lib/review";
import { loadInputs, withDiscounts } from "@/lib/scenarios";
import { allocate, baseline, totals } from "@/lib/scenarios/allocate";
import { get } from "@/lib/storage";
import type { SessionUser } from "@/lib/auth";

type Btn = "Accept" | "Change" | "Ask vendor" | "Exclude";
const BTNS: Btn[] = ["Accept", "Change", "Ask vendor", "Exclude"];
type Ctx = { it: QueueItem; rfx: string; before: Snap };
/** What a button does for a card: an act() call and the check on its effect; or a gap (should exist, doesn't); or hidden. */
type Plan = { hidden: string } | { gap: string } | { run: (c: Ctx) => Promise<void>; check: (c: Ctx) => Promise<string | null> };

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

// ── Snapshot / restore of everything a decision can touch on this RFx
const TABLES = ["line_quotes", "review_items", "assumptions", "questionnaire_answers", "unmatched_items", "rfx_vendors"] as const;
type Snap = Record<(typeof TABLES)[number] | "responses", Record<string, unknown>[]>;
async function snap(rfx: string): Promise<Snap> {
  const out = {} as Snap;
  for (const t of TABLES) out[t] = (await db().from(t).select("*").eq("rfx_id", rfx)).data ?? [];
  out.responses = (await db().from("responses").select("id, vendor_id, summary, pipeline_status, stage_errors").eq("rfx_id", rfx)).data ?? [];
  return out;
}
async function restore(rfx: string, s: Snap) {
  // Rows the action created go first (children before line_quotes), then every snapshotted row is written back.
  for (const t of ["review_items", "assumptions", "questionnaire_answers", "unmatched_items", "line_quotes"] as const) {
    const keep = new Set(s[t].map((r) => r.id as string));
    const now = (await db().from(t).select("id").eq("rfx_id", rfx)).data ?? [];
    const extra = now.map((r) => r.id as string).filter((id) => !keep.has(id));
    if (extra.length) { const { error } = await db().from(t).delete().in("id", extra); if (error) throw new Error(`restore ${t}: ${error.message}`); }
  }
  await db().from("assumptions").update({ superseded_by: null }).eq("rfx_id", rfx);
  for (const t of ["line_quotes", "assumptions", "review_items", "questionnaire_answers", "unmatched_items", "rfx_vendors"] as const) {
    if (!s[t].length) continue;
    const { error } = await db().from(t).upsert(s[t], { onConflict: "id" });
    if (error) throw new Error(`restore ${t}: ${error.message}`);
  }
  for (const r of s.responses) await db().from("responses").update(omit(r, "id")).eq("id", r.id as string);
}

// ── Effects
const cellOf = async (c: Ctx) => {
  const q = db().from("line_quotes").select("id, state, unit_price_inr_per_1000, landed_price_inr_per_1000").eq("rfx_id", c.rfx).eq("vendor_id", c.it.vendor!.id);
  const lineId = (c.before.review_items.find((r) => r.id === c.it.id)!.rfx_line_id as string | null);
  return lineId ? (await q.eq("rfx_line_id", lineId).maybeSingle()).data : null;
};
const cardStatus = async (c: Ctx) => (await db().from("review_items").select("status").eq("id", c.it.id).single()).data!.status as string;
const ledgerSince = async (c: Ctx, kind: string) => (await db().from("assumptions").select("id").eq("rfx_id", c.rfx).eq("kind", kind)).data!.length - c.before.assumptions.filter((a) => a.kind === kind).length;
const expect = (ok: boolean, why: string) => (ok ? null : why);
const press = (a: Action, body: (c: Ctx) => ActBody = () => ({})) => async (c: Ctx) => { await act(c.it.id, a, body(c), user); };
const reason = { reason: "four-button test" };

// Asking: the Review tab drafts one email for the card (P-CLARIFY, a real model call) and sends only on the buyer's Send.
const ask: Plan = {
  run: async (c) => { (c as Ctx & { draft?: { body: string } }).draft = (await act(c.it.id, "ask-vendor", {}, user)).draft; },
  check: async (c) => { const d = (c as Ctx & { draft?: { body: string } }).draft; return expect(!!d && d.body.length > 40 && (await cardStatus(c)) === "open", "no draft, or the card closed before Send"); },
};
const pricedCell = async (c: Ctx, where: (chain: { step: string }[]) => boolean = () => true) => {
  const rows = c.before.line_quotes.filter((l) => l.vendor_id === c.it.vendor!.id && l.unit_price_inr_per_1000 !== null && where((l.conversion_chain as { step: string }[] | null) ?? []));
  return rows[0] as { id: string; unit_price_inr_per_1000: number } | undefined;
};
const priceNow = async (id: string) => Number((await db().from("line_quotes").select("unit_price_inr_per_1000").eq("id", id).single()).data!.unit_price_inr_per_1000);
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.001);
const closed = async (c: Ctx) => expect((await cardStatus(c)) !== "open", "card still open");

// ── P10: the test presses exactly the buttons the card shows (buttonsFor — the same four slots the Review tab renders),
// with a typical input for its Change form, and checks the effect on the grid / ledger / answers.
function plans(it: QueueItem): Record<Btn, Plan> {
  const b = it.buttons, pv = it.proposed_value;
  const PRICE = ["ambiguous_unit", "low_confidence_read", "conflict"];
  const mapped = it.type === "low_confidence_read" && it.group === "Line matching";
  const accept: Plan = !b.accept ? { hidden: "nothing suggested" } : {
    run: press(b.accept),
    check: async (c) => {
      if (b.accept === "mark-not-quoted") { const n = (await db().from("line_quotes").select("id").eq("rfx_id", c.rfx).eq("vendor_id", c.it.vendor!.id).eq("state", "references_prior")).data!.length; return expect(n === 0, `${n} still "same as last year"`); }
      if (PRICE.includes(it.type) && !mapped) { const x = await cellOf(c); return expect(x?.state === "reviewed" && Number(x.unit_price_inr_per_1000) === Math.round(Number(pv) * 100) / 100, `cell ${x?.state} ${x?.unit_price_inr_per_1000} vs ${pv}`); }
      if (it.type === "vendor_mismatch") { const held = (await db().from("line_quotes").select("id").eq("rfx_id", c.rfx).like("best_guess_note", "Held until%")).data!.length; return expect(held === 0 && (await cardStatus(c)) === "confirmed", `${held} prices still held`); }
      return closed(c);
    },
  };
  const f = b.change?.form;
  const change: Plan = !b.change ? { hidden: "nothing to change" } : f === "price" ? {
    run: press("override", () => ({ value: 12345, ...reason })),
    check: async (c) => { const x = await cellOf(c); return expect(x?.state === "reviewed" && Number(x.unit_price_inr_per_1000) === 12345 && (await ledgerSince(c, "value_override")) === 1, `cell ${x?.state} ${x?.unit_price_inr_per_1000}`); },
  } : f === "prices" ? {
    run: press("enter-prices", () => ({ prices: { [String(it.prior_lines![0].line_no)]: 9999 }, reason: "last year's PO" })),
    check: async (c) => { const n = (await db().from("line_quotes").select("id").eq("rfx_id", c.rfx).eq("vendor_id", c.it.vendor!.id).eq("state", "reviewed").eq("unit_price_inr_per_1000", 9999)).data!.length; return expect(n === 1, `${n} cells entered`); },
  } : f === "line" ? {
    run: press("map", () => ({ line_id: it.candidates!.find((x) => x.likely)?.line_id ?? it.candidates![0].line_id })),
    check: async (c) => { const m = ((await db().from("responses").select("summary").eq("id", c.before.review_items.find((r) => r.id === c.it.id)!.response_id as string).single()).data!.summary as { map?: { mapping?: { provider: string }[] } }).map?.mapping ?? [];
      return expect(m.some((x) => x.provider === "buyer") && (await cardStatus(c)) !== "open", "buyer mapping not stored"); },
  } : f === "freight" ? {
    run: press("set-freight", () => ({ value: 0, ...reason })),
    check: async (c) => { const rows = (await db().from("line_quotes").select("unit_price_inr_per_1000, landed_price_inr_per_1000").eq("rfx_id", c.rfx).eq("vendor_id", c.it.vendor!.id).not("unit_price_inr_per_1000", "is", null)).data!; return expect(rows.length > 0 && rows.every((r) => Number(r.landed_price_inr_per_1000) === Number(r.unit_price_inr_per_1000)), "landed prices still include freight"); },
  } : f === "rate" ? {
    run: async (c) => { await act(c.it.id, "set-fx", { value: Math.round((it.current?.rate ?? 83) * 1.1 * 100) / 100, ...reason }, user); },
    check: async (c) => { const x = await pricedCell(c, (ch) => ch.some((s) => s.step === "currency")); if (!x) return "no converted cell to check";
      const want = Number(x.unit_price_inr_per_1000) * (Math.round((it.current?.rate ?? 83) * 1.1 * 100) / 100) / (it.current?.rate ?? 83); return expect(near(await priceNow(x.id), Math.round(want * 100) / 100), `price ${await priceNow(x.id)} vs ${want.toFixed(2)}`); },
  } : f === "gst" ? {
    run: press("set-gst", () => ({ value: 18, ...reason })),
    check: async (c) => { const x = await pricedCell(c); if (!x) return "no priced cell"; const want = Math.round(Number(x.unit_price_inr_per_1000) * 1.18 * 100) / 100; return expect(near(await priceNow(x.id), want), `price ${await priceNow(x.id)} vs ${want}`); },
  } : f === "discount" ? (it.current?.discount?.kind === "gross_up" ? {
    run: press("set-discount", () => ({ value: 0, ...reason })),
    check: async (c) => { const x = await pricedCell(c, (ch) => ch.some((s) => s.step === "discount_gross_up")); if (!x) return "no grossed-up cell"; const want = Math.round(Number(x.unit_price_inr_per_1000) * (1 - (it.current!.discount!.pct / 100)) * 100) / 100; return expect(near(await priceNow(x.id), want), `price ${await priceNow(x.id)} vs ${want}`); },
  } : {
    run: press("set-discount", () => ({ value: 5, kind: "min_lines", min_lines: 10, ...reason })),
    check: async (c) => { const d = (await loadInputs(c.rfx)).discounts?.find((x) => x.vendor_id === c.it.vendor!.id); return expect(d?.pct === 5 && d.kind === "min_lines" && d.min_lines === 10, `discount now ${JSON.stringify(d)}`); },
  }) : f === "yesno" ? {
    run: press("treat-no"),
    check: async (c) => { const qid = c.before.review_items.find((r) => r.id === c.it.id)!.question_id as string; const a = (await db().from("questionnaire_answers").select("state, answer_bool").eq("question_id", qid).eq("vendor_id", c.it.vendor!.id).single()).data!; return expect(a.state === "reviewed" && a.answer_bool === false, `answer ${a.state} ${a.answer_bool}`); },
  } : f === "answers" ? {
    run: press("answer", () => ({ answers: { [String(it.missing_questions![0].q_no)]: it.missing_questions![0].answer_type === "yes_no" ? "Yes" : "250" }, reason: "phone call" })),
    check: async (c) => { const n = (await db().from("questionnaire_answers").select("id").eq("rfx_id", c.rfx).eq("vendor_id", c.it.vendor!.id).eq("state", "reviewed")).data!.length; return expect(n >= 1 && (await cardStatus(c)) !== "open", `${n} answers reviewed`); },
  } : {
    run: press("reassign", () => ({ vendor_id: it.vendor_options![0].id })),
    check: async (c) => { const rid = c.before.review_items.find((r) => r.id === c.it.id)!.response_id as string; const v = (await db().from("responses").select("vendor_id").eq("id", rid).single()).data!.vendor_id; return expect(v === it.vendor_options![0].id, `reply still with ${v}`); },
  };
  const exclude: Plan = !b.exclude ? { hidden: "nothing to leave out" } : b.exclude !== "exclude" ? { run: press(b.exclude), check: closed } : {
    run: press("exclude", () => reason),
    check: async (c) => {
      if (it.type === "discount_treatment") { const d = (await loadInputs(c.rfx)).discounts?.find((x) => x.vendor_id === c.it.vendor!.id); return expect(!d, "discount still applied"); }
      if (it.type === "vendor_mismatch") { const rid = c.before.review_items.find((r) => r.id === c.it.id)!.response_id as string; const st = (await db().from("line_quotes").select("state").eq("response_id", rid)).data!; return expect(st.every((x) => x.state === "excluded" || x.state === "not_quoted"), "reply's cells not excluded"); }
      const x = await cellOf(c); return expect(x?.state === "excluded", `cell ${x?.state}`);
    },
  };
  return { Accept: accept, Change: change, "Ask vendor": b.ask ? ask : { hidden: "the vendor can't answer it" }, Exclude: exclude };
}

// ── Run
const code = `TEST-4B-${Date.now().toString(36).toUpperCase()}`;
const rfx = (await db().from("rfx").insert({ ...omit(src, "id", "code", "created_at", "updated_at"), code, title: "four-button test", status: "receiving", copilot_transcript: [], tax_basis: "incl_gst" }).select("id").single()).data!.id as string;
try {
  await db().from("rfx_lines").insert((linesQ.data ?? []).map((l) => ({ ...omit(l, "id", "rfx_id"), rfx_id: rfx })));
  await db().from("rfx_questions").insert((questionsQ.data ?? []).map((q) => ({ ...omit(q, "id", "rfx_id"), rfx_id: rfx })));
  await db().from("rfx_vendors").insert((vendorsQ.data ?? []).map((v) => ({ rfx_id: rfx, vendor_id: v.vendor_id, reply_tag: `${code.toLowerCase()}-${(v.vendors as unknown as { short_code: string }).short_code}`, status: "invited" })));
  const send = async (label: string, vendorId: string | null, files: { name: string; buf: Buffer }[], emailText: string | null) => {
    const id = await createResponse({ rfxId: rfx, vendorId, source: "mock_upload", files, emailText, actor: "system" });
    const errs: string[] = [];
    for await (const ev of runAll(id, "system")) if (ev.status === "error") errs.push(`${ev.stage}: ${ev.error?.slice(0, 80)}`);
    console.log(`  ${label}${errs.length ? ` — stopped: ${errs.join("; ")}` : ""}`);
  };
  console.log(`Replies into ${code} (RFx asks GST-inclusive prices, so GST-extra quotes raise a GST card):`);
  for (const pair of [["balaji", "kohinoor", "westline"], ["orientpack", "anand"]])
    await Promise.all(pair.map(async (v) => { const r = (await seedReply(v, "realistic"))!; await send(`${v} (realistic)`, vendor(v), r.files, r.emailText); }));
  const extra = (f: string) => get("seed", `seed/realistic/06_extra_samples/${f}`);
  await Promise.all([
    (async () => send("balaji: revised-rates email (a second price for some lines)", vendor("balaji"), [], (await extra("balaji_revised_offer_email.txt")).toString("utf8")))(),
    (async () => send("WhatsApp photo from an unknown sender", null, [{ name: "whatsapp_quote_sunrise_packers.png", buf: await extra("whatsapp_quote_sunrise_packers.png") }], null))(),
    send("westline: “received, quote by Friday” (no prices)", vendor("westline"), [], "Dear Sujit, received your RFx, we will send our revised quote by Friday. Regards, Westline"),
  ]);
  const bal = (await seedReply("balaji", "clean"))!;
  await send("Balaji's sheet sent as Anand's reply", vendor("anand"), bal.files, null);
  // A unit slip on one of Kohinoor's prices (÷1000, a per-piece figure), then the real price check over the RFx.
  const k = (await db().from("line_quotes").select("id, unit_price_inr_per_1000").eq("rfx_id", rfx).eq("vendor_id", vendor("kohinoor")).in("state", ["confirmed", "inferred", "reviewed"]).not("unit_price_inr_per_1000", "is", null).limit(1).single()).data!;
  await db().from("line_quotes").update({ unit_price_inr_per_1000: Number(k.unit_price_inr_per_1000) / 1000 }).eq("id", k.id);
  await checkPrices(rfx);
  console.log("  Kohinoor: one price entered per piece instead of per 1000 → price check");

  const cards = (await listReview(rfx)).filter((i) => i.status === "open");
  const kind = (i: QueueItem) => (i.type === "low_confidence_read" && i.group === "Line matching" ? "low_confidence_read (line match)" : i.type);
  const byKind = new Map<string, QueueItem>();
  // One card per kind — from a reply that belongs to a vendor when there is one (an unknown sender's cards wait for assignment).
  for (const i of cards) if (!byKind.has(kind(i)) || (!byKind.get(kind(i))!.vendor && i.vendor)) byKind.set(kind(i), i);
  const ALL = ["ambiguous_unit", "low_confidence_read", "low_confidence_read (line match)", "price_check", "conflict", "total_mismatch", "prior_pricing", "missing_line", "unmapped_item", "freight_treatment", "fx_assumption", "discount_treatment", "tax_basis", "validity_short", "vendor_condition", "questionnaire_ambiguous", "questionnaire_missing", "vendor_mismatch", "unknown_vendor", "not_a_quote"];
  // P10 T3: conditional discounts on real data — read from the quote, applied only where the award meets the condition.
  {
    const inp = await loadInputs(rfx);
    const q1 = totals(allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" }));
    const dv = withDiscounts(inp, q1.share, q1.total);
    const base = baseline(inp, "unit", false);
    console.log(`\nDiscounts read: ${(inp.discounts ?? []).map((d) => `${inp.vendors.find((v) => v.id === d.vendor_id)?.name}: ${d.pct}% ${d.kind}${d.min_lines ? ` ${d.min_lines}` : ""}`).join(" · ") || "none"}`);
    console.log(`Cheapest per line (qualified): ${Math.round(q1.total).toLocaleString("en-IN")} quoted → ${Math.round(dv.total_after).toLocaleString("en-IN")} after — ${dv.discounts.map((d) => `${d.vendor} ${d.met ? "met" : "not met"} (${d.why})`).join("; ") || "no discounts"}`);
    console.log(`Best single vendor: ${inp.vendors.find((v) => v.id === base?.vendor_id)?.name} ${Math.round(base?.total_quoted ?? 0).toLocaleString("en-IN")} quoted → ${Math.round(base?.total ?? 0).toLocaleString("en-IN")}${base?.discount ? ` (${base.discount.met ? "met" : "not met"}: ${base.discount.why})` : ""}`);
  }
  console.log(`\n${cards.length} open cards; ${byKind.size} of ${ALL.length} kinds raised by the pipeline. Not raised: ${ALL.filter((t) => !byKind.has(t)).join(", ") || "none"}\n`);

  const rows: string[][] = [];
  const tally = { pass: 0, fail: 0, gap: 0, hidden: 0 };
  for (const [t, it] of byKind) {
    const row = [t];
    for (const b of BTNS) {
      const p = plans(it)[b];
      if ("hidden" in p) { row.push(`— (${p.hidden})`); tally.hidden++; continue; }
      if ("gap" in p) { row.push(`GAP: ${p.gap}`); tally.gap++; continue; }
      const before = await snap(rfx);
      const ctx: Ctx = { it, rfx, before };
      let res: string | null;
      try { await p.run(ctx); res = await p.check(ctx); } catch (e) { res = `threw: ${(e as Error).message.slice(0, 100)}`; }
      row.push(res ? `FAIL: ${res}` : "PASS"); tally[res ? "fail" : "pass"]++;
      await restore(rfx, before);
    }
    rows.push(row);
    console.log(`${t}\n${BTNS.map((b, i) => `   ${b.padEnd(11)} ${row[i + 1]}`).join("\n")}`);
  }
  console.log(`\nTOTAL  pass ${tally.pass} · fail ${tally.fail} · gap ${tally.gap} · correctly hidden ${tally.hidden}`);
} finally {
  const files = (await db().from("response_files").select("storage_path, derived_text_path, derived_image_paths, responses!inner(rfx_id)").eq("responses.rfx_id", rfx)).data ?? [];
  const raw = files.map((f) => f.storage_path), derived = files.flatMap((f) => [f.derived_text_path, ...((f.derived_image_paths as string[] | null) ?? [])]).filter(Boolean) as string[];
  if (raw.length) await db().storage.from("raw").remove(raw);
  if (derived.length) await db().storage.from("derived").remove(derived);
  await db().from("review_items").delete().eq("rfx_id", rfx);
  const del = await db().from("rfx").delete().eq("id", rfx);
  console.log(del.error ? `Couldn't delete ${code}: ${del.error.message}` : `Deleted ${code}.`);
}
