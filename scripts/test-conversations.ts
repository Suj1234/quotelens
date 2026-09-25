// P9 Phase E: co-pilot (E1–E11, E19) and analyst (E12–E16) conversation tests on the real model (docs/handoff/P9_Agents_Plan.md §4 E1–E11).
// Each case talks to the agent through copilotTurn (what the route calls) on a throwaway draft and checks the
// DATABASE state, not the wording. Drafts are deleted at the end (--keep keeps them). Usage:
//   npm run test:conversations            all cases
//   npm run test:conversations -- E1 E7   some cases
import fs from "node:fs";
import { copilotTurn } from "@/lib/copilot";
import { db } from "@/lib/db";
import { createDraft, getDraft, lineInput, patchDraftByHand, type Draft } from "@/lib/rfx-draft";
import { list } from "@/lib/storage";
import type { Turn } from "@/lib/analyst";
import type { Action } from "@/lib/ai/agent";
import type { AskAnswer } from "@/lib/query/ask";

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

// ── Analyst (E12–E16), end to end through the running app (TEST_BASE_URL, default http://localhost:3000): log in as the
// buyer / approver, POST /api/rfx/{id}/analyst, read the NDJSON stream. (The memo PDF module can't load under tsx.)
// MER-0419 (open, replies read) and MER-0417 (awarded, locked). Answers, scenarios and the memo draft the tests create are
// deleted afterwards; a clarification is drafted, never sent.
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const rfxId = async (code: string) => (await db().from("rfx").select("id").eq("code", code).single()).data!.id as string;
type Who = { role: string; cookie: string };
const asUser = async (role: string): Promise<Who> => {
  const { data } = await db().from("users").select("email").eq("role", role).limit(1).single();
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data!.email, password: process.env.SEED_ADMIN_PASSWORD }) });
  if (!res.ok) throw new Error(`login as ${role} failed at ${BASE}: ${res.status} (is the dev server running?)`);
  return { role, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
};
const analyst = { queries: [] as string[], scenarios: [] as string[], awards: [] as string[] };
type AResult = { reply: string; actions: Action[]; context: string };
async function chat(rfx: string, u: Who, message: string, hist: Turn[], log: string[]): Promise<AResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/rfx/${rfx}/analyst`, { method: "POST", headers: { "content-type": "application/json", cookie: u.cookie }, body: JSON.stringify({ message, history: hist }) });
  const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === "done");
  if (!done) throw new Error(`analyst: ${JSON.stringify(events.at(-1) ?? res.status)}`);
  const out = done as AResult;
  hist.push({ role: "user", text: message }, { role: "model", text: out.context });
  for (const a of out.actions) {
    if (a.tool === "query_data") analyst.queries.push((a.data as AskAnswer).query_id);
    if (a.tool === "save_scenario") analyst.scenarios.push((a.data as { id: string }).id);
  }
  log.push(`  ${u.role}: ${message}`, `  analyst (${((Date.now() - t0) / 1000).toFixed(1)}s): ${out.reply.replace(/\n+/g, " ⏎ ")}`,
    ...out.actions.map((a) => `    · ${a.tool}: ${a.text}${a.tool === "query_data" ? ` — ${(a.data as AskAnswer).row_count} rows${(a.data as AskAnswer).ok ? "" : " (NO SAFE QUERY)"}` : ""}`));
  return out;
}
const answers = (o: AResult) => o.actions.filter((a) => a.tool === "query_data").map((a) => a.data as AskAnswer);
const needs = ["E12", "E13", "E14", "E15", "E16"].some((e) => !only.length || only.includes(e));
const m19 = needs ? await rfxId("MER-0419") : "", m17 = needs ? await rfxId("MER-0417") : "";
const sujit = needs ? await asUser("buyer") : null!, priya = needs ? await asUser("approver") : null!;
const hadAward = needs ? !!(await db().from("awards").select("id").eq("rfx_id", m19).maybeSingle()).data : true;

await run("E12", async (log) => {
  const h: Turn[] = [], res: string[] = [];
  const Q = [
    "Cheapest vendor per line, only among vendors who cleared the quality questionnaire",
    "What does that save versus awarding everything to the cheapest single vendor?",
    "Which lines have only one qualified quote?",
    "Show landed cost instead of unit price — does the ranking change?",
    "Split 5-ply to the cheapest qualified and 3-ply to whoever is cheapest overall — better or worse than Q1?",
    "Which cells are you not sure about, and how much money rides on them?",
    "What did OrientPack's USD conversion assume, and what if the rupee moves 3%?",
    "Export the Q1 allocation as Excel",
  ];
  let q1rows = 0;
  for (const [i, q] of Q.entries()) {
    const o = await chat(m19, sujit, q, h, log);
    const a = answers(o);
    const ok = i === 7 ? o.actions.some((x) => x.tool === "export" && /\/api\/export\/query\//.test((x.data as { url: string }).url))
      : i === 5 ? a.some((x) => x.ok && !!x.sql) || o.actions.some((x) => x.tool === "list_unresolved")
      : a.some((x) => x.ok && !!x.sql);
    if (i === 0) q1rows = a[0]?.row_count ?? 0;
    res.push(`Q${i + 1} ${ok ? "✓" : "✗"}`);
  }
  return { pass: res.every((r) => r.endsWith("✓")) && q1rows === 30, detail: `${res.join(" ")}; Q1 rows ${q1rows}`, turns: Q.length };
});

await run("E13", async (log) => {
  const h: Turn[] = [];
  await chat(m19, sujit, "Cheapest vendor per line, only among vendors who cleared the quality questionnaire", h, log);
  const s1 = await chat(m19, sujit, "Save that as a scenario called E13 cheapest qualified", h, log);
  const s2 = await chat(m19, sujit, "Also save a scenario E13 cheapest overall: cheapest vendor per line on unit price, any vendor", h, log);
  const c = await chat(m19, sujit, "Compare the two scenarios", h, log);
  const saved = (await db().from("scenarios").select("name").eq("rfx_id", m19).in("id", analyst.scenarios)).data ?? [];
  const cmp = c.actions.some((a) => a.tool === "compare_scenarios");
  const ok = s1.actions.some((a) => a.tool === "save_scenario") && s2.actions.some((a) => a.tool === "save_scenario") && saved.length === 2 && cmp;
  return { pass: ok, detail: `scenarios saved: ${saved.map((x) => x.name).join(", ") || "none"}; compared: ${cmp}`, turns: 4 };
});

await run("E14", async (log) => {
  const h: Turn[] = [];
  const comms0 = (await db().from("communications").select("id", { count: "exact", head: true }).eq("rfx_id", m19)).count;
  let scen = analyst.scenarios[0];
  if (!scen) { await chat(m19, sujit, "Save a scenario E14 cheapest qualified: cheapest vendor per line on unit price, qualified vendors only", h, log); scen = analyst.scenarios.at(-1)!; }
  const name = (await db().from("scenarios").select("name").eq("id", scen).single()).data!.name;
  const m = await chat(m19, sujit, `Draft the award memo from the scenario "${name}"`, h, log);
  const award = (await db().from("awards").select("id, status").eq("rfx_id", m19).maybeSingle()).data;
  if (award && !hadAward) analyst.awards.push(award.id);
  const status = (await db().from("rfx").select("status").eq("id", m19).single()).data!.status;
  const cl = await chat(m19, sujit, "Draft a clarification to Westline about their open questions", h, log);
  const comms1 = (await db().from("communications").select("id", { count: "exact", head: true }).eq("rfx_id", m19)).count;
  const drafted = cl.actions.some((a) => a.tool === "draft_clarification");
  const ok = m.actions.some((a) => a.tool === "draft_award_memo") && award?.status === "draft" && status !== "awarded" && drafted && comms0 === comms1;
  return { pass: ok, detail: `memo ${award?.status ?? "none"}; RFx ${status}; clarification drafted: ${drafted}; emails sent: ${(comms1 ?? 0) - (comms0 ?? 0)}`, turns: h.length / 2 };
});

await run("E15", async (log) => {
  const h: Turn[] = [];
  const a = answers(await chat(m19, sujit, "Which vendors sent an ISO certificate?", h, log));
  const b = answers(await chat(m19, sujit, "What payment terms did Kohinoor offer?", h, log));
  const usesDocs = a.some((x) => x.ok && /v_documents/.test(x.sql ?? "")), usesTerms = b.some((x) => x.ok && /v_vendor_terms/.test(x.sql ?? ""));
  return { pass: usesDocs && usesTerms, detail: `ISO from v_documents: ${usesDocs} (${a[0]?.row_count ?? 0} rows); Kohinoor terms from v_vendor_terms: ${usesTerms}`, turns: 2 };
});

await run("E16", async (log) => {
  const before = JSON.stringify((await db().from("awards").select("status").eq("rfx_id", m19).maybeSingle()).data);
  const r1 = await chat(m19, sujit, "Approve it", [], log);
  const r2 = await chat(m19, priya, "Approve the award now", [], log);
  const r3 = await chat(m19, priya, "Draft a clarification to Westline", [], log);
  const r4 = await chat(m17, sujit, "Save a scenario called E16 locked test: cheapest vendor per line on unit price, any vendor", [], log);
  const after = JSON.stringify((await db().from("awards").select("status").eq("rfx_id", m19).maybeSingle()).data);
  const status = (await db().from("rfx").select("status").eq("id", m19).single()).data!.status;
  const lockedSaved = (await db().from("scenarios").select("id").eq("rfx_id", m17).ilike("name", "E16%")).data ?? [];
  const noActs = (o: AResult, t: string) => !o.actions.some((a) => a.tool === t);
  const ok = before === after && status !== "awarded" && noActs(r1, "draft_award_memo") && noActs(r3, "draft_clarification") && noActs(r4, "save_scenario") && !lockedSaved.length;
  void r2;
  return { pass: ok, detail: `award unchanged: ${before === after}; RFx ${status}; approver clarification refused: ${noActs(r3, "draft_clarification")}; locked RFx scenario refused: ${!lockedSaved.length}`, turns: 4 };
});

if (needs && !keep) {
  if (analyst.awards.length) {
    await db().storage.from("outbound").remove(analyst.awards.map((id) => `rfx/${m19}/outbound/award/${id}.pdf`));
    await db().from("awards").delete().in("id", analyst.awards);
  }
  if (analyst.scenarios.length) await db().from("scenarios").delete().in("id", analyst.scenarios);
  if (analyst.queries.length) await db().from("queries").delete().in("id", analyst.queries);
  console.log(`\nAnalyst clean-up: ${analyst.queries.length} answers, ${analyst.scenarios.length} scenarios, ${analyst.awards.length} memo draft deleted.`);
}

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
