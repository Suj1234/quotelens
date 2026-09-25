You are continuing the QuoteLens build. Phases 0–7 are done, committed and deployed. Your job is **Phase 8** (CLAUDE.md §3: P8-T1 to P8-T4), the last build phase: the Settings / Eval / Model-calls screens, the completed demo RFx (MER-0417 awarded), a polish pass, and the full TRD §22 test checklist on production. It ends at the CLAUDE.md §10 demo-readiness gate. Stop after the Phase 8 checkpoint and report.

The human (Sujeet) is not an engineer and will not be available during the run. Explain what you do in plain language as you go. **Before you start building, tell him the plan in a few lines with a time estimate for each part, and repeat "done / now doing / left + estimate" at every milestone** (in P7 he twice asked "what is happening, when will it finish?" while verification ran).

---

## 0. Things to settle before you build (read, don't skip)

**A. One Settings page or three pages.**
- TRD §17.13–17.15 describe three screens: **Settings**, **Eval**, **Logs** (and routes `GET/PUT /api/settings`, `POST /api/eval/run`, `GET /api/logs`).
- DESIGN §3.10 puts all three on **one Settings page** reached from the rail's gear: the settings cards, then h2 "Eval — seed set", then h2 "Model calls". The rail already links `/settings` (tooltip "Settings, eval, model calls"), and that page does not exist yet (the link 404s today).

DESIGN is the visual spec, TRD wins on behaviour. So: **one `/settings` page** with three sections (anchors `#eval`, `#model-calls` so they are linkable), keeping all TRD content (Eval: pick the RFx, Run eval, filters, row → provenance; Logs: filters). Build the three TRD API routes. Record the placement in DECISIONS.

**B. Completing MER-0417 (P8-T2) — real decisions, done once, approval last.**
CLAUDE P8-T2: reload MER-0417 with the **realistic** set, clear its review queue **as Sujit through the UI** ("this is real usage, leave the audit trail"), ask Q1–Q8 once, save two scenarios, generate the memo, **approve as Priya**. Approval cannot be undone, and MER-0417 is the RFx the interviewers see as "completed".
- If PROGRESS.md "Open questions" has Sujeet's answers on how to decide the queue, follow them.
- If not, use these defaults (easiest to defend) and list every decision in PROGRESS under "MER-0417 decisions (Sujit)":
  - **Westline ambiguous bundle sizes (items 5, 9, 15, 19):** Ask vendor → send → paste the dataset's `supabase/seed/03_westline/westline_clarification_reply.txt` as the reply (Add response → "This answers the clarification…"). This is the real P6 loop.
  - **OrientPack low-confidence line 14:** open the photo in the drawer. If the price is legible, Override with the value you can read and a reason quoting what is visible; if not, Ask vendor (mock) or Exclude with the reason "unreadable on the rate card photo".
  - **Anand prior pricing (lines 23–30):** Treat as not quoted, reason "no prior price list on file" (nothing in the dataset gives those prices).
  - **Anand questionnaire Q6 (BRC "in process"):** Treat as No (conservative: not certified today). Anand then drops out of "qualified".
  - **Informational cards (FX, freight, discount, validity, missing lines):** Acknowledge.
  - Anything else: decide from the evidence on the card and write the reason.
- **Never read the gold key (`gold.json`, `gold_cells.csv`) to choose a value** — that is faking (CLAUDE §0 rule 3). The eval afterwards judges the reviewed state.
- Order: reload → queue → Q1–Q8 (as Priya, on Decide) → two scenarios (Q1 and Q5 saved from the answers) → Sujit generates the memo from Q1 → **read the PDF back and check it** → only then Priya approves.

**C. MER-0420 "Untitled RFx".** An empty draft created on 24 Sep from a session that wasn't the P7 agent (probably Sujeet). If PROGRESS "Open questions" says delete it, delete it with a script (rows only, it has no files); if not answered, leave it and say so in the report (the demo gate expects exactly MER-0417/0418/0419, so ask again).

**D. Email transport card.** Live Gmail is out of scope by decision (DECISIONS "Live Gmail out of scope"). The card shows **Mock** selected; **Gmail** disabled with "not in this build"; **Resend** disabled "not configured". The TRD's "vendor demo addresses map" is not built (it only serves Gmail) — record it. No dead controls.

**E. Other open questions** (co-pilot initiative P5, asked cards in the Open list P6, memo wording P7, demo-script Gmail steps P6): follow Sujeet's answers if PROGRESS has them; otherwise leave behaviour as it is (P8 adds no features) and keep them listed.

---

## 1. Why this prompt is strict (read first)

Phases 3–7 taught these lessons. Keep them:
- "Done" is a ticked checklist with evidence, never a feeling.
- Every button gets tried in the real UI, as both users, including errors and repeat runs.
- **Bookkeeping bugs are real bugs.** Number this phase's rows `8.1`, `8.2`, … and tick them with a helper that:
  - cuts the row by its fixed prefix `  | 8.x | `;
  - **refuses evidence text containing `|`** (it caught one in P7);
  - asserts the requirement text is unchanged after the write;
  - has a `--check` mode comparing against a copy of PROGRESS.md taken before the phase: every 8.x requirement unchanged, every older row byte-identical.

  In P7 a shell `&&` chain kept going after the helper refused a row — run the check on its own and read its output.
- **Local and production share one Supabase database.** Anything you change locally (settings, RFx, scenarios) changes production. Settings are global: thresholds, FX rates, decision provider, discount default and freight default affect every later pipeline run everywhere. **Test setting changes on a throwaway RFx and restore the defaults at the end** (USD 83.15 dated 2026-09-23, thresholds 0.85 / 0.60, provider auto, discount gross, freight 180, email mock), then verify them by script.
- **Irreversible steps:** approving MER-0417 is this phase's goal — do it once, last, after the memo PDF checks out. Never approve MER-0418 or MER-0419. Test anything else irreversible on a throwaway RFx (title prefix `TEST p8 …`, cleaned up by title only — never by code range, because MER-0420 isn't yours).
- **"Load seeded responses" only creates the replies.** Stages run when a reply is opened, or run them all with `tsx … scripts/run-seed-pipeline.ts --rfx CODE --set clean|realistic` (`--from classify` keeps the loaded replies). On production, run them through the deployed `POST /api/responses/{id}/run-all`.
- **The model varies run to run; investigate before blaming it.** In P7 one reload gave 120/150 (Gemini 504 on a photo — re-run) and another 146/150, which was a real bug (the extractor invented pack sizes; fixed with `statedPack`). Look at the wrong cells before re-running.
- **The network and Gemini drop.** Gemini returned 503 "high demand" and 504 "deadline" in P7; timeouts are 120 s (one retry), Supabase 60 s. Re-run the failed stage or question. Wait for long jobs with `run_in_background` + an `until` loop, never chained sleeps.
- **Scripts can't import `@react-pdf/renderer` under tsx.** Test anything that renders the memo through the app's API.
- **The browse daemon sometimes restarts and drops the sign-in** — sign in again (the P7 pattern posts to `/api/auth/login` from the page with `fetch`).

---

## 2. Read first, in this order

1. **CLAUDE.md** (whole file; §0 rules mandatory; §3 Phase 8; §5 cut list — item 2 cost-of-money is cut; §10 demo-readiness gate), then **PROGRESS.md** (Open questions, Known issues, every P7 row) and **DECISIONS.md** (every P7 entry; "Live Gmail out of scope"; P2 decision-layer and threshold entries; P6 mock mailbox).
2. **TRD** (`docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md`):
   - §6.19 `settings` (seeded keys), §6.20 `eval_runs`, `model_calls`;
   - §10.1–10.5 decision layer (providers, "measured (Jev)" / "LLM-estimated (Gemini)", thresholds and their consumers);
   - §11.3 currency, §11.4 discounts (gross / net recompute), §11.7 landed cost;
   - §16 routes `/api/settings`, `/api/eval/run`, `/api/logs`;
   - **§17.13 Settings, §17.14 Eval, §17.15 Logs**;
   - **§18 Eval**, §19 logging and errors;
   - §20 seeding (step 6), §21 deployment;
   - **§22 test checklist items 1–12**.
3. **PRD**: §4 goals (G1–G7, and §4.2 definition of done for the demo), §8 Stage 9, §10 trust features (item 8 the eval page), §11 decision layer, §16 demo requirements.
4. **DESIGN.md**:
   - §0 principles (§0.8 patterns to avoid), §1 tokens;
   - §2.2 rail (gear, buyer only), §2.4 buttons, §2.5 chips, §2.16 tables / empty states / toasts;
   - **§3.10 Settings**, §4 roles (Settings, eval, model calls: buyer yes, approver no), §5 copy, §6 responsive.

   Check `design/prototype.html`: the Settings screen (`Settings()`), its eval stat cards and per-cell table, the model-calls table. Render it at 1440 px with the browse skill (`S.user='sujit'; location.hash='#settings'`).
5. **`docs/05_Demo_Script.md`** — the demo expects MER-0417 completed and approved (realistic), MER-0419 seeded with the queue NOT cleared, MER-0418 draft.
6. **AGENTS.md** (Next.js 16: read `node_modules/next/dist/docs/` before Next-specific code; run `npx next typegen` after adding routes, with the dev server stopped).

Then run `git log --oneline -15`, `npm test` (77 tests, must be green) and `npm run eval` (must say 150/150, questionnaire 50/50).

---

## 3. What already exists (reuse it, don't rebuild it)

- **Settings:** `src/lib/settings.ts` `getSetting(key)` with the TRD defaults plus `freight_default_inr_per_1000` (180). Read by `decide()` (`decision_provider`), map and normalise (`thresholds`), normalise (`fx_rates`, `discount_default`, `freight_default_inr_per_1000`), `sendEmail` / sync (`email_mode`). There is **no write path and no `/api/settings`** yet.
- **Decision layer:** `src/lib/ai/decision/index.ts` + `providers/gemini.ts`, `providers/jev.ts`. With no `OPENROUTER_API_KEY`, Jev is never called (DECISIONS P2-T1); the Settings card must show the key status honestly ("no key · Gemini").
- **Eval:** `src/lib/eval/run.ts` `runEval(rfxId, {save})` (gold key read from bucket `seed`, so it works on Vercel), `formatEval`, `eval_runs` rows; `scripts/run-eval.ts --rfx CODE`. It already works on MER-0419 (clean) and MER-0417 (realistic).
- **Model calls:** every call is logged to `model_calls` (`src/lib/log.ts`) with purpose, provider, model, tokens, latency, ok, error, previews.
- **Provenance drawer:** `src/components/compare/drawer.tsx` `ProvenanceDrawer({ rfxId, cellKey: "line:vendorcode", basis, canReview, locked, onClose })` — reuse it for eval rows.
- **Award / lock (P7):** `src/lib/award/*`, `src/lib/scenarios/*`, `src/lib/lock.ts` (`assertOpen`, `isLocked`). Eval runs and Settings must keep working on an awarded RFx (they don't edit its data); decide and record whether `POST /api/eval/run` is allowed on a locked RFx (it only writes `eval_runs`).
- **UI kit:** `table.t`, `.card > .hd / .bd`, `.chip.*`, `.seg`, `.kv`, `.empty`, `.lock`, `textarea.ta / input.ta`, `select.sel` in `src/app/globals.css`; buttons are the restyled shadcn `Button`; toasts via `sonner`.
- **Data:**
  - **MER-0419** — clean set, 150/150, 14 open review items, no scenarios / awards, 64 saved queries (the demo's "seeded, queue open" RFx). Keep it exactly so at the end (reload with `npm run pipeline:seed` if you test on it; remove any scenarios / awards / queries you add).
  - **MER-0417** — realistic set loaded in earlier phases, 150/150, 15 open items, not awarded. P8-T2 completes it (§0 B). Reload it first: the P7 `statedPack` fix changed normalise.
  - **MER-0418** — untouched draft. Keep it that way.
  - **MER-0420** — see §0 C.
  - Throwaway RFx: P7's pattern — create a draft by API from MER-0418's data (POST `/api/rfx` + PATCH header/lines/questions/vendors with `terms_set: true` and a deadline), issue it in the UI, Load seeded responses, run the stages; delete by title with a script (awards and scenarios first — `scenario_lines` → `rfx_lines` has no cascade — then storage under `rfx/{id}/` in raw / derived / outbound, mailbox rows, then the RFx).
- **Environment:**
  - scripts run as `tsx --env-file-if-exists=.env.local --conditions=react-server scripts/x.ts`; throwaway scripts are `scripts/_*.ts` (git-ignored via `.git/info/exclude`), deleted at the end;
  - `git push origin main` deploys to https://quotelens-seven.vercel.app (wait until a new route answers before checking production);
  - sign in with `POST /api/auth/login` using `SEED_ADMIN_PASSWORD` from `.env.local` (never echo it). Users: `sujit.menon@meridianfoods.example` (buyer), `priya.raghavan@meridianfoods.example` (approver);
  - new migrations start at `0011_*.sql`; never edit 0001–0010; apply with `npm run db:migrate`;
  - PDFs are read back with `pypdf` installed into the scratchpad (`pip3 install --target <scratchpad>/py pypdf`), not as a project dependency;
  - after adding route folders the dev server can 404 every `/rfx/[id]/…` page until you delete `.next` and restart; don't run `npm run build` while `npm run dev` runs.

---

## 4. How to work (mandatory)

1. **Before any code, write the Phase 8 checklist into PROGRESS.md** (table `# | requirement (source) | status / evidence`, rows `8.1…`), and snapshot PROGRESS.md for the tick helper's `--check`. Start from §5 below and add anything else you find in the §2 reading.
2. **Tick only with evidence:** a unit test, a script output, an API response, or a browser check with the gstack `/browse` skill (never the claude-in-chrome tools).
3. **Test every control you build in the real UI** as Sujit and as Priya: the empty state, the error state, a repeat action.
4. **Where specs disagree, choose** (TRD wins on design and behaviour, DESIGN is the visual spec, CLAUDE.md wins on order and scope) and **record it in DECISIONS.md in the same commit**. DECISIONS.md is append-only.
5. **One commit per task** (`P8-T1: …`), each with the PROGRESS.md update (status, what works, what doesn't, next step).
6. **Prompt tuning** follows CLAUDE.md §9: one change at a time, the previous version in `prompts/archive/`, at most 20 minutes per round (P8 is not a tuning phase — only if a §22 item fails because of a prompt).
7. **Any change to extraction / mapping / normalise:** `npm run pipeline:seed` → 150/150 before committing (CLAUDE §0 rule 12).
8. **Before reporting done:** tests, lint and `npm run build` green; `npm run pipeline:seed` 150/150; push; production checked; checklist fully ticked, or each open item listed with its reason.
9. **Product decisions** not covered by the specs go under "Open questions" in PROGRESS.md; pick the easiest-to-reverse option and keep going.
10. **Never:**
    - print env values;
    - special-case seed files or vendors, or read the gold key to decide a review;
    - hardcode an answer or a total;
    - edit migrations 0001–0010;
    - approve MER-0418 or MER-0419; approve MER-0417 more than once;
    - leave settings changed at the end.

---

## 5. Phase 8 requirement checklist

### P8-T1 Settings, Eval and Model calls (TRD §17.13–17.15, §16, §18; DESIGN §3.10, §4; CLAUDE P8-T1)
- [ ] 8.1 **`/settings` page** (buyer/admin; approver: no gear, `/settings` redirects, APIs 403) per DESIGN §3.10: h1 "Settings", the sub-line, 2-column card grid, then "Eval — seed set" and "Model calls" sections (§0 A). The rail gear becomes active there; no more 404. The Overview's Transport row gets its "change" link to `/settings` (buyer only; DECISIONS P5-T4 d left it out until this page existed).
- [ ] 8.2 **`GET /api/settings`** (all keys with defaults) and **`PUT /api/settings` `{key, value}`** (buyer/admin): Zod per key (thresholds 0 < review < act ≤ 1; FX rate > 0 with date and source; provider enum; discount enum; freight ≥ 0), unknown keys 400, **audit event `settings.changed` with before / after** (TRD §17.13 "Save → audit event").
- [ ] 8.3 **Email transport card** per §0 D (Mock selected; Gmail "not in this build"; Resend "not configured"; hint "All three raise the same “response received” event."). No dead radio.
- [ ] 8.4 **Decision layer card**: sentence; radios Auto (amber "no key · Gemini" when `OPENROUTER_API_KEY` is absent), Gemini only ("LLM-estimated"), Jev only ("measured"; disabled or clearly "falls back to Gemini — no key" without a key; choose, record); thresholds act / review as two sliders or inputs with the current values (0.85 / 0.60). Hint that thresholds apply **on the next stage run only** (CLAUDE P8-T1 "document this") — in the UI and in DECISIONS.
- [ ] 8.5 **FX rates card**: table (currency, rate, date, source) with edit and add; hint "Changing a rate writes a new ledger entry; old cells keep their chain." Make that true and test it on a throwaway RFx: change USD, re-run normalise for OrientPack → new `fx_rate` ledger row with the new rate/date, cells converted at it; before the re-run, existing cells and their chains unchanged. Restore 83.15.
- [ ] 8.6 **Landed cost & discounts card**: freight default (₹/1000), discount default gross / net (TRD §11.4: net → that vendor's cells × (1 − pct) on the next normalise run; test on a throwaway, restore gross), include-tax only if the pipeline implements it (else not shown — no dead toggle), cost of money shown as "not in this build" (cut list 2). Record what is shown and why.
- [ ] 8.7 **Decision provider switch works end to end** (TRD §22 item 12): switch provider, re-run classify on one response of a throwaway RFx, the Model calls table shows the provider per call; switch back to auto.
- [ ] 8.8 Every settings change is visible in a timeline or log in words (settings are global; choose where: audit events without an `rfx_id` → shown under the Settings page as "Recent changes"; record).
- [ ] 8.9 **`POST /api/eval/run` `{rfx_id}`** (buyer/admin): `runEval(..., {save: true})`, returns totals + per-cell + questionnaire; refuses an RFx with no gold key cleanly (only the seeded RFx have one — say which RFx are eligible: those loaded with a seed set). Decide and record the locked-RFx behaviour (§3).
- [ ] 8.10 **Eval section** (TRD §17.14, DESIGN §3.10): RFx select (seeded RFx), **Run eval** (elapsed time while running), stat cards per DESIGN (cells correct+flagged-OK / 150, correct, flagged-OK, wrong, missing; questionnaire n/50), last run time, "judged on the current state — n cells reviewed by the buyer" when any are (TRD §18 "page shows which"). Loads the latest `eval_runs` row without re-running.
- [ ] 8.11 **Per-cell table**: line, vendor, expected, got, state, verdict (+ why), filters (verdict, vendor), wrong/missing first; each row opens the **provenance drawer** for that cell. Questionnaire mismatches listed under it.
- [ ] 8.12 Eval numbers on the page = `npm run eval` for the same RFx (screenshot vs script output).
- [ ] 8.13 **`GET /api/logs?rfx=`** (buyer/admin; approver 403): latest model calls (cap 200, newest first) with filters `rfx`, `purpose`, `provider`, `ok`.
- [ ] 8.14 **Model calls section** (TRD §17.15, DESIGN §3.10): Time · Purpose · Provider ("LLM-estimated (Gemini)" / "measured (Jev)") · Model · In · Out · Latency · ok; filters; failed calls show their error on hover or expand. Shows the P7 Gemini 503/504 rows honestly.

### P8-T2 Completed RFx MER-0417 (CLAUDE P8-T2; §0 B)
- [ ] 8.15 Reload MER-0417 with the realistic set (`run-seed-pipeline.ts --set realistic --rfx MER-0417`): eval recorded (expected 150/150, questionnaire 42–43/50 — the OrientPack realistic reply has no questionnaire). Investigate any wrong cell before moving on.
- [ ] 8.16 Queue cleared **as Sujit in the UI** per §0 B (or Sujeet's answers): every card decided with a reason; Westline clarification loop run for real; PROGRESS lists each decision; ledger and Timeline show them; 0 open items at the end.
- [ ] 8.17 Q1–Q8 asked once on MER-0417 (as Priya on Decide) — all computed, SQL shown, times recorded; answers listed in PROGRESS (numbers will differ from MER-0419: reviewed cells count).
- [ ] 8.18 Two scenarios saved from the answers (Q1, Q5), compared on Award; totals equal the answers.
- [ ] 8.19 Sujit generates the memo from Q1 → PDF read back (six parts, 30 rows, ledger rows = Ledger tab, ₹, no unverified numbers, open items reflect the cleared queue) → **then** Priya approves → MER-0417 **Awarded**, locked, RFx list shows its annual value; approved PDF has both signatures.
- [ ] 8.20 Eval of MER-0417 after review recorded on the Eval page (judged on the reviewed state; report the number honestly, with why any cell moved).

### P8-T3 Polish pass — no new features (CLAUDE P8-T3)
- [ ] 8.21 **Empty states** on every screen that can be empty (DESIGN §5: one bold sentence, one plain sentence, at most one button): RFx list, Responses, Review (no items), Comparison tabs, Award (no scenarios), Decide (no prices), Settings eval (never run), Model calls (none).
- [ ] 8.22 **Loading states**: route-level `loading.tsx` skeletons for the RFx pages and Settings (read the Next 16 docs), no layout jump; long actions show elapsed time (pipeline, Ask, memo, eval).
- [ ] 8.23 **Error states with Retry** (DESIGN §5 "what happened and what to do"): pipeline stage (exists — check), Ask (toast + question kept — check), memo generate, eval run, settings save; a forced network failure on each shows a toast with the code.
- [ ] 8.24 **Numbers**: every ₹ amount uses Indian grouping (`money`, `inrShort`), no raw `toLocaleString()` of money, no "NaN" / "undefined" anywhere (grep + screenshots); percentages one or two decimals consistently.
- [ ] 8.25 **Legend wherever states appear** (grid, eval table, export legend sheet, drawer state chip) and the **"measured (Jev) / LLM-estimated (Gemini)"** label in the drawer, questionnaire tooltip and Model calls — and nowhere else (DESIGN §0.6).
- [ ] 8.26 Known cosmetic issues fixed: pipeline strip shows later stages as pending during "Re-run all" (PROGRESS Known issues); anything else found in the pass. Responsive check of the P7/P8 screens (Award, Decide, Settings) at 375 / 768 / 1440 px: no sideways page scroll, tables scroll inside their card (DESIGN §6).

### P8-T4 TRD §22 test checklist on production (CLAUDE P8-T4)
Rows 8.27–8.38 = TRD §22 items 1–12, each run on **production**, each with evidence. Use a throwaway RFx wherever an item changes data (items 2, 3, 5, 9, 10); reload MER-0419 afterwards if you touch it.
- [ ] 8.27 §22.1 Login both users.
- [ ] 8.28 §22.2 New RFx via co-pilot → 30 lines, questionnaire, terms, vendors; Issue → Outbox shows 5 (mock).
- [ ] 8.29 §22.3 Load seeded responses → all five reach flags done; queue contents as listed in §22.3 (compare item by item and note differences).
- [ ] 8.30 §22.4 Provenance drawer on an Excel cell, a PDF footnote, a Word sentence, an image crop, an email line.
- [ ] 8.31 §22.5 Clear the queue; cell states update.
- [ ] 8.32 §22.6 Q1–Q8 computed with SQL visible; include best guesses changes totals; export works.
- [ ] 8.33 §22.7 Save scenario; compare two; generate memo; approve as Priya; grid locks (MER-0417 in 8.19 counts if done on production; else a throwaway).
- [ ] 8.34 §22.8 Email round trip — **mock mailbox** per DECISIONS (issue → vendor portal reply with a photo → Sync inbox → response → extraction → cell lands).
- [ ] 8.35 §22.9 Unrelated PDF (e.g. a certificate) as a vendor response → supporting / not relevant, no crash.
- [ ] 8.36 §22.10 Quote from a different category (`realistic/06_extra_samples/wrong_category_IT_quote.xlsx`) → Unmatched; grid unchanged.
- [ ] 8.37 §22.11 Eval page shows ≥ 143/150 or the honest number.
- [ ] 8.38 §22.12 Logs show provider per call; switch provider in Settings and re-run classify on one response (8.7 on production); switch back.

### Phase 8 checkpoint = CLAUDE.md §10 demo-readiness gate
- [ ] 8.39 CLAUDE §10 on production, every box: incognito login both users; MER-0417 completed (awarded), MER-0418 draft, MER-0419 seeded with queue open; Eval page shows the latest number and per-cell diff; `wrong_category_IT_quote.xlsx` dropped into an Add response sheet → Unmatched, no crash (on a throwaway or MER-0419 then reload); Q1–Q8 each within 15 s (record times; latency outliers noted); "Gmail round trip within 12 hours" = the mock mailbox round trip (DECISIONS); Settings provider switch visible; Model calls show provider per call; memo PDF downloads; PROGRESS and DECISIONS up to date.
- [ ] 8.40 Settings restored and verified by script (§1 defaults).
- [ ] 8.41 Tests (settings validation, eval route shape if unit-testable), lint, build green; `npm run pipeline:seed` 150/150, questionnaire 50/50; push; production checked after the deploy.
- [ ] 8.42 Final state (script): RFx list = MER-0417 (awarded, realistic, 0 open items, memo approved), MER-0418 (untouched draft), MER-0419 (seeded, 14 open items, no scenarios / awards, 64 saved queries or the count before P8), plus MER-0420 only if Sujeet said keep; all throwaway RFx deleted with their files and mailbox rows; settings at defaults.
- [ ] 8.43 Side by side with the prototype at 1440 px: Settings (cards, eval, model calls) and every screen touched by the polish pass; differences fixed or recorded.
- [ ] 8.44 Rows 8.1–8.43 ticked in PROGRESS.md with evidence (`--check`: every row keeps its requirement text, no older row changed); PROGRESS header ("P8 ✅ — build complete; next: human tasks"), eval line, what works / what doesn't, Known issues and Open questions updated.

---

## 6. NOT in Phase 8 (don't build; list as "later" in the report)

- Live Gmail send / IMAP sync and Resend (out of scope by decision); the vendor demo addresses map.
- Award / regret emails to vendors (PRD item 33, optional).
- Landed-cost cost of money (cut list item 2).
- New features of any kind (CLAUDE P8-T3 "No new features") — polish only.
- The Loom recording, the one-page note (`docs/06_One_Page_Note.md`) and the OrientPack photo — Sujeet's tasks (CLAUDE §6).

---

## 7. When Phase 8 is done: stop and report to Sujeet

Plain language (he is not an engineer). Lead with the status line: **"The build is complete"** or **"complete except …"**.
1. **What was built**, screen by screen: the Settings page (what each card changes and when it takes effect), the Eval section (what the number means, how to run it, how to open a cell), Model calls.
2. **MER-0417**: every queue decision Sujit made and why, the Q1–Q8 answers, the two scenarios, the memo (pages, total, saving vs best single vendor), the approval, and its eval after review.
3. **The checklist** with ✓ and evidence, plus open items with reasons — and the §22 table (12 items, production, pass / fail / note) and the §10 gate box by box.
4. **The numbers**: clean eval, realistic eval (before and after review), Q1–Q8 times on production.
5. **Every decision made without him** (point to the DECISIONS.md entries), especially: one Settings page vs three, the email card, the Jev radio without a key, where settings changes are logged, eval on a locked RFx, the MER-0417 queue defaults.
6. **What's left for him** (the build is done after this):
   - record the Loom following `docs/05_Demo_Script.md` (and whether its Gmail steps were updated to the mock mailbox);
   - write the one-page note (`docs/06_One_Page_Note.md`);
   - photograph the OrientPack rate card (optional extra);
   - reset the Supabase database password; delete `.env.vercel`;
   - answer any open questions still listed (co-pilot initiative, asked cards, memo wording, MER-0420 if not answered).

Do not start anything after Phase 8.
