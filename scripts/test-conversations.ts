// P9 Phase E: co-pilot conversation tests on the real model (docs/handoff/P9_Agents_Plan.md §4 E1–E11).
// Each case talks to the agent through copilotTurn (what the route calls) on a throwaway draft and checks the
// DATABASE state, not the wording. Drafts are deleted at the end (--keep keeps them). Usage:
//   npm run test:conversations            all cases
//   npm run test:conversations -- E1 E7   some cases
import fs from "node:fs";
import { copilotTurn } from "@/lib/copilot";
import { db } from "@/lib/db";
import { createDraft, getDraft, lineInput, patchDraftByHand, type Draft } from "@/lib/rfx-draft";
import { list } from "@/lib/storage";

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const only = argv.filter((a) => /^E\d+$/.test(a));
const sheet = { name: "rfx_lines.xlsx", buf: fs.readFileSync("supabase/seed/00_rfx/rfx_lines.xlsx") };
const questionnaireTxt = { name: "supplier_questionnaire_2025.txt", buf: Buffer.from(`Meridian Foods — Supplier Quality Questionnaire (2025)
1. Do you hold ISO 9001 certification? (Yes/No) — mandatory, reject if No
2. Are you certified for food-contact packaging (FSSC 22000 or BRC)? (Yes/No) — mandatory, reject if No
3. Monthly corrugation capacity in tonnes? (number) — reject below 150
4. Standard lead time from PO to delivery, in days? (number)
5. Do you test box compression strength (BCT) for every batch? (Yes/No)
6. Describe your recycled-fibre sourcing. (text)
`) };

const { data: buyer } = await db().from("users").select("id, name").eq("role", "buyer").limit(1).single();
if (!buyer) throw new Error("No buyer user — run npm run seed");
const user = { id: buyer.id as string, name: buyer.name as string };
const created: string[] = [];
const results: { id: string; pass: boolean; detail: string; turns: number; secs: number }[] = [];

type Files = { name: string; buf: Buffer }[];
async function say(rfxId: string, message: string, files: Files = [], log: string[] = []) {
  const t0 = Date.now(), events: string[] = [];
  const out = await copilotTurn(rfxId, message, files, user, (e) => { if (e.type === "step") events.push(e.text); });
  const t = (out.draft.rfx.copilot_transcript as { text: string; patch?: string }[]).at(-1)!;
  log.push(`  buyer: ${message}${files.length ? ` [+${files.map((f) => f.name).join(", ")}]` : ""}`,
    `  co-pilot (${((Date.now() - t0) / 1000).toFixed(1)}s): ${t.text.replace(/\n+/g, " ⏎ ")}`, ...(t.patch ? [`  changed: ${t.patch.replace(/\n/g, " | ")}`] : []));
  return { draft: out.draft, reply: t.text, patch: t.patch ?? "", secs: (Date.now() - t0) / 1000 };
}
async function fresh() { const id = await createDraft({}, user); created.push(id); return id; }
const state = (d: Draft) => ({
  lines: d.lines.length, terms: d.rfx.terms_set, deadline: d.rfx.response_deadline, currency: d.rfx.currency,
  questions: d.questions.length, dq: d.questions.filter((q) => q.disqualify_if).length, vendors: d.vendors.map((v) => v.name),
  title: d.rfx.title, scope: !!d.rfx.cover_note, category: d.rfx.category, status: d.rfx.status, tax: d.rfx.tax_basis,
});
const complete = (s: ReturnType<typeof state>) => s.lines === 30 && s.terms && !!s.deadline && s.questions >= 8 && s.dq >= 1 && s.vendors.length === 5;
const qMarks = (t: string) => (t.match(/\?/g) ?? []).length;

async function run(id: string, fn: (log: string[]) => Promise<{ pass: boolean; detail: string; turns: number }>) {
  if (only.length && !only.includes(id)) return;
  const log: string[] = [], t0 = Date.now();
  console.log(`\n── ${id}`);
  try {
    const r = await fn(log);
    console.log(log.join("\n"));
    results.push({ id, ...r, secs: (Date.now() - t0) / 1000 });
    console.log(`  ${r.pass ? "PASS" : "FAIL"} — ${r.detail}`);
  } catch (e) {
    console.log(log.join("\n"));
    results.push({ id, pass: false, detail: `threw: ${(e as Error).message}`, turns: 0, secs: (Date.now() - t0) / 1000 });
    console.log(`  FAIL — threw: ${(e as Error).message}`);
  }
}

// E2 builds a complete draft that E3–E6 and E9 then change.
let complete2: string | null = null;

await run("E1", async (log) => {
  const id = await fresh();
  const r = await say(id, "Call it \"Corrugated packaging — FY26-27 annual contract\". Annual corrugated packaging contract for FY26-27, both plants (Hosur and Nelamangala), 12 months. Last year's line sheet is attached. Standard terms are fine. Quotes due 7 October. Add a supplier questionnaire — ISO/BIS and food-grade compliance are must-haves, capacity at least 200 tonnes a month. Invite all five vendors from the address book.", [sheet], log);
  const s = state(r.draft);
  return { pass: complete(s) && s.deadline === "2026-10-07" && s.title === "Corrugated packaging — FY26-27 annual contract" && s.tax === "excl_gst", detail: JSON.stringify(s), turns: 1 };
});

await run("E2", async (log) => {
  const id = await fresh();
  const script: [string, Files?][] = [
    ["Need to run the annual corrugated contract for FY26-27. Around 30 SKUs, same as last year. Both plants, Hosur and Nelamangala."],
    ["Here's last year's sheet. Yes, 12 months, and your suggested title is fine.", [sheet]],
    ["Keep the standard terms. Quotes due by 7 October."],
    ["Yes, we need a questionnaire. We can't use anyone without ISO/BIS certification or food-grade compliance."],
    ["Looks fine. Invite all five vendors."],
  ];
  let r: Awaited<ReturnType<typeof say>> | null = null, maxQ = 0, turns = 0;
  for (const [m, f] of script) { r = await say(id, m, f ?? [], log); maxQ = Math.max(maxQ, qMarks(r.reply)); turns++; if (complete(state(r.draft))) break; }
  for (let i = 0; i < 2 && !complete(state(r!.draft)); i++) { r = await say(id, "Yes, go ahead with what you proposed.", [], log); maxQ = Math.max(maxQ, qMarks(r.reply)); turns++; }
  const s = state(r!.draft);
  if (complete(s)) complete2 = id;
  return { pass: complete(s) && maxQ <= 3 && s.title !== "Untitled RFx", detail: `${JSON.stringify(s)} · most questions in one reply: ${maxQ}`, turns };
});

await run("E3", async (log) => {
  if (!complete2) return { pass: false, detail: "needs E2's completed draft", turns: 0 };
  const before = await getDraft(complete2);
  let r = await say(complete2, "Drop Q5.", [], log);
  const dropped = r.draft.questions.length === before.questions.length - 1 && !r.draft.questions.some((q) => q.text === before.questions[4].text);
  const num = r.draft.questions.find((q) => q.answer_type === "number");
  if (!num) return { pass: false, detail: "no number question to change", turns: 1 };
  r = await say(complete2, `Make Q${num.q_no} disqualify anyone below 150.`, [], log);
  const rule = r.draft.questions.find((q) => q.q_no === num.q_no)?.disqualify_if;
  return { pass: dropped && rule === "lt:150", detail: `Q5 dropped: ${dropped}; Q${num.q_no} rule = ${rule}`, turns: 2 };
});

await run("E4", async (log) => {
  if (!complete2) return { pass: false, detail: "needs E2's completed draft", turns: 0 };
  const r = await say(complete2, "Remove Anand from the vendor list.", [], log);
  const names = r.draft.vendors.map((v) => v.name);
  return { pass: names.length === 4 && !names.some((n) => /anand/i.test(n)), detail: names.join(", "), turns: 1 };
});

await run("E5", async (log) => {
  if (!complete2) return { pass: false, detail: "needs E2's completed draft", turns: 0 };
  const r = await say(complete2, "Ask them to quote in USD instead.", [], log);
  return { pass: r.draft.rfx.currency === "USD", detail: `currency ${r.draft.rfx.currency}`, turns: 1 };
});

await run("E6", async (log) => {
  if (!complete2) return { pass: false, detail: "needs E2's completed draft", turns: 0 };
  const r = await say(complete2, "Move the deadline to next Friday.", [], log);
  // Today (IST) is a Friday in the test window, so "next Friday" is read as +7 or +14 days; any other day fails.
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const ok = [...Array(15).keys()].map((i) => new Date(today.getTime() + i * 864e5)).filter((d) => d.getUTCDay() === 5 && d > today).slice(0, 2).map((d) => d.toISOString().slice(0, 10));
  return { pass: ok.includes(r.draft.rfx.response_deadline ?? ""), detail: `deadline ${r.draft.rfx.response_deadline} (accepted: ${ok.join(" or ")})`, turns: 1 };
});

let seven: string | null = null;
await run("E7", async (log) => {
  const id = await fresh();
  const r = await say(id, "Last year's sheet is attached. Also add one new line: 3-ply sheet 1000x800 mm, GSM 150/120/150, 2000 a month for Hosur, weight 190 g.", [sheet], log);
  seven = id;
  const extra = r.draft.lines.find((l) => l.length_mm === 1000 && l.width_mm === 800);
  return { pass: r.draft.lines.length === 31 && !!extra && extra.monthly_qty === 2000, detail: `lines ${r.draft.lines.length}; new line ${extra ? `${extra.description} qty ${extra.monthly_qty}` : "missing"}`, turns: 1 };
});

await run("E8", async (log) => {
  const id = await fresh();
  const r = await say(id, "This is the questionnaire we used last year — use it.", [questionnaireTxt], log);
  const q = r.draft.questions;
  return { pass: r.draft.lines.length === 0 && q.length >= 5 && q.some((x) => x.disqualify_if), detail: `lines ${r.draft.lines.length}; questions ${q.length}; rules ${q.map((x) => x.disqualify_if ?? "-").join(",")}`, turns: 1 };
});

await run("E9", async (log) => {
  if (!complete2) return { pass: false, detail: "needs E2's completed draft", turns: 0 };
  const before = JSON.stringify(state(await getDraft(complete2)));
  const a = await say(complete2, "Issue it now.", [], log);
  const b = await say(complete2, "And approve it too.", [], log);
  const after = JSON.stringify(state(b.draft));
  return { pass: before === after && !a.patch && !b.patch && b.draft.rfx.status === "draft", detail: `unchanged: ${before === after}; status ${b.draft.rfx.status}`, turns: 2 };
});

await run("E10", async (log) => {
  const id = await fresh();
  const r = await say(id, "We need 40 laptops for the sales team, i7, 16 GB.", [], log);
  return { pass: r.draft.lines.length === 0 && !r.patch, detail: `lines ${r.draft.lines.length}; changes: ${r.patch || "none"}`, turns: 1 };
});

await run("E11", async (log) => {
  const id = seven ?? await fresh();
  if (!seven) await say(id, "Here is the sheet.", [sheet], log);
  const n = (await getDraft(id)).lines.length;
  const a = await say(id, "Delete all the lines.", [], log);
  const kept = a.draft.lines.length === n;
  const b = await say(id, "Yes, remove them all.", [], log);
  return { pass: n > 0 && kept && b.draft.lines.length === 0, detail: `before ${n}; after the request ${a.draft.lines.length}; after "yes" ${b.draft.lines.length}`, turns: 2 };
});

await run("E19", async (log) => {
  // P9 point 3: a hand edit is written into the conversation; a later "use the sheet again" must not silently undo it.
  const id = await fresh();
  await say(id, "Call it \"Hand edit test\". Here is last year's sheet.", [sheet], log);
  const d = await getDraft(id);
  await patchDraftByHand(id, { lines: d.lines.filter((l) => l.line_no !== 14).map((l) => lineInput(l)) }, user);
  const ev = ((await getDraft(id)).rfx.copilot_transcript as { role: string; text: string }[]).at(-1)!;
  log.push(`  event: ${ev.text}`);
  const r = await say(id, "Load the line sheet again.", [], log);
  return { pass: ev.role === "event" && /removed line 14/.test(ev.text) && r.draft.lines.length === 29, detail: `event recorded: ${ev.role === "event"}; lines after "load again": ${r.draft.lines.length} (29 = edit kept, co-pilot asked first)`, turns: 2 };
});

console.log("\n── Summary");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(4)} ${String(r.turns).padStart(2)} turn(s) ${r.secs.toFixed(0).padStart(4)}s  ${r.detail}`);
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);

if (!keep) {
  for (const id of created) {
    const files = await list("raw", `rfx/${id}/copilot`).catch(() => []);
    if (files.length) await db().storage.from("raw").remove(files);
    await db().from("rfx").delete().eq("id", id);
  }
  console.log(`Deleted ${created.length} throwaway drafts.`);
} else console.log(`Kept drafts: ${created.join(", ")}`);
