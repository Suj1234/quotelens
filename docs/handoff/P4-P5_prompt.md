You are continuing the QuoteLens build. Phases 0–3 are done, committed and deployed. Your job is **Phase 4 and then Phase 5** (CLAUDE.md §3: P4-T1…P4-T4, P5-T1…P5-T4), each finished to its checkpoint. **Run them back to back without stopping:** when the Phase 4 checkpoint passes, go straight on to P5-T1. Stop only after the Phase 5 checkpoint, then report.

The human (Sujeet) is not an engineer and will not be available during the run. Explain what you do in plain language as you go.

---

## 0. Why this prompt is strict (read first)

In Phase 3 the build was reported "finished", but an audit found 9 spec items that were never built, several buttons nobody had tried, and 4 real bugs. The causes:
- Work was driven by the one-line task summaries in CLAUDE.md and by each task's narrow "done when" line.
- The prototype was treated as the finish line.
- "Done" was claimed without a ticked checklist.

**Do not repeat this.** The rules in §3 below are mandatory.

---

## 1. Read first, in this order

1. **CLAUDE.md**, the whole file. The §0 rules are mandatory: no faking, every model call through `lib/ai/gemini.ts` or `decide()`, Zod validation, secrets only in env, commit per task, PROGRESS.md after every task.
2. **PROGRESS.md** and **DECISIONS.md**. Read the P2 and P3 entries fully: they record every deviation, the review-queue design, the stray-reply guards, and the known issues.
3. **docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md** (the TRD; CLAUDE.md calls it 02_FSD_TRD.md):
   - For both phases: §6.17 `queries`, §6.21 views, §9.1 P-COPILOT, §9.2 P-LINESHEET, §9.3 P-DISPATCH, §9.8 P-SQL, §9.9 P-NARRATE, §13 (all of it), §15.1–15.2 (email common + mock), §16 (routes for ask, export, rfx, copilot, issue, email outbox, responses), §17.3–17.6, the Ask part of §17.9, §21, and §22 items 2, 6, 9 and 10.
4. **docs/01_PRD_Kill_the_Quote_Spreadsheet.md**: §8 Stages 0–3 and 7, §13 (Q1–Q8 plus the three extra questions), §14 screens.
5. **design/DESIGN.md**: §0 (principles and patterns to avoid), §2.3 RFx header, §2.13–2.16 (Ask card, Ask box, inline bar chart, email/table/toast/empty states), §3.3 New RFx, §3.4 Overview, §3.5 Responses ("Add response" sheet), §3.7 (the Ask side sheet), §4 roles, §5 copy rules. **design/prototype.html** is the visual acceptance test: open it in the browser and read its `<style>` block for exact values.
6. **AGENTS.md**: this is Next.js 16. Read `node_modules/next/dist/docs/` before writing Next-specific code. Run `npx next typegen` after adding routes.

Then run `git log --oneline -15`, `npm test` (40 tests, must be green) and `npm run eval` (must say 150/150) before any new work.

---

## 2. What already exists (reuse it, don't rebuild it)

- **Pipeline:**
  - `src/lib/pipeline/` holds classify, extract, map, normalise, questionnaire and flags, run by `run.ts` (`runStage`, `runAll`).
  - Intake is `src/lib/responses.ts` (`createResponse`, `loadSeedResponses`) and `POST /api/responses` (multipart).
  - Vendor-less replies wait for a vendor (`unknown_vendor` card); `assignVendor` is in `src/lib/unmatched.ts`.
- **Comparison and review:**
  - Grid: `src/lib/comparison.ts` (grid model; `COUNTED` states; vendor "main reply" rule).
  - Drawer: `src/lib/provenance.ts`. Evidence block: `src/lib/evidence.ts`.
  - Review queue: `src/lib/review.ts` (actions + ledger + audit).
  - Tab loaders: `src/lib/rfx-tabs.ts`.
  - UI: `src/components/compare/*`, `src/components/review/*`.
- **Helpers:**
  - Formatting (`money`, `inrShort`, `shortDate`, `longDate`, `countWord`): `src/lib/format.ts`.
  - `src/lib/settings.ts`, `src/lib/log.ts` (`logModelCall`, `audit`), `src/lib/storage.ts` (put/get/list/signedUrl; buckets `raw`, `derived`, `outbound`, `seed`), `src/lib/http.ts` (`route()` wrapper), `src/lib/auth.ts` (`requireUser`, `requireApiUser(roles)`).
  - Preprocessors (xlsx/csv/docx/pdf/image/email → text): `src/lib/preprocess/`.
- **Styles:** CSS classes copied from the prototype are in `src/app/globals.css`: `.cmpwrap`, `.toolbar`, `.seg`, `.drawer`, `.scrim`, `.evidence`, `.snip`, `.rqcard`, `.email`, `.tabs`, `.tl`, `.lock`, `.sel`, `.inp`, `.chip.*`, `table.t`, `.kv`, `.lead`, `.eyebrow`, `.empty`, `.card`. Add prototype rules there value-for-value. Buttons are the restyled shadcn `Button` (`variant="default"` = teal primary, `outline` = normal, `ghost` = quiet); there is no `.btn` class.
- **Data:**
  - **MER-0419:** clean seed responses, eval 150/150, 14 open review items. It must look like this again at the end (reload with `npm run pipeline:seed`).
  - **MER-0417:** realistic set, 150/150.
  - **MER-0418:** **draft**, v0, 30 lines, 10 questions, 5 vendors attached but not invited. **It must still be an untouched draft at the end:** Phase 6 issues it live in gmail mode.
  - The RFx list already links drafts to `/rfx/new?id=<id>`. The rail already has a buyer-only "New RFx" link to `/rfx/new`.
- **Tabs today:**
  - Buyer: Responses · Review [n] · Comparison.
  - Approver: Comparison only (Decide/Award come in P7).
  - `/rfx/{id}` currently redirects the buyer to Responses; P5-T4 changes that to Overview.

---

## 3. How to work (mandatory)

1. **Before writing any code for a phase, write its requirement checklist into PROGRESS.md.** Start with the lists in §4 and §5 below, then add anything else you find in the sections listed in §1. Use a table: `# | requirement (source) | status / evidence`. The table is the definition of done, not the "done when" line.
2. **Tick an item only with evidence:** a unit test, a script output, an API response, or a browser check. Write the evidence in the row. Use the gstack `/browse` skill for browser checks (never the claude-in-chrome tools).
3. **Test every button and action you build, in the real UI,** not only the happy path. Include: approver vs buyer, empty states, error states (bad input → proper message), and repeat runs (the model is not deterministic; run an important flow at least twice).
4. **Where the prototype, DESIGN.md, TRD and PRD disagree, don't silently pick one.** Choose (CLAUDE.md: the TRD wins on design, DESIGN.md is the visual spec, and CLAUDE.md wins on order and scope) and record the choice in DECISIONS.md **in the same commit**. Every deviation from any spec goes in DECISIONS.md. The file is append-only: never delete or rewrite old entries.
5. **One commit per task,** with the task ID (`P4-T2: ask route …`), plus the PROGRESS.md update (status, what works, what doesn't, next step).
6. **Prompt tuning follows CLAUDE.md §9:** one change at a time, previous version kept in `prompts/archive/`, at most 20 minutes per round in these phases.
7. **Before reporting a phase done:** tests, lint and `npm run build` must be green; `npm run pipeline:seed` must give 150/150 on the clean set; push; check production; the checklist must be fully ticked, or each open item listed with its reason.
8. **Product decisions not covered by the specs** go under "Open questions" in PROGRESS.md. Pick the easiest-to-reverse option and keep going. Never stop to ask.
9. **Never:**
   - print env values or connection strings;
   - special-case seed files, or hardcode an answer or SQL for a demo question (the SQL must be generated by P-SQL at run time);
   - cache model output by file content;
   - edit migrations 0001–0005 (add `0006_*.sql` or later and apply with `npm run db:migrate`).
10. **Environment:**
    - `.env.local` is filled. Run scripts as `tsx --env-file-if-exists=.env.local --conditions=react-server scripts/x.ts`; `scripts/` is ESM. Throwaway scripts go in `scripts/_*.ts` (git-ignored) and are deleted afterwards.
    - `git push origin main` deploys to https://quotelens-seven.vercel.app in about 60 s.
    - Sign in with `POST /api/auth/login`. The password is `SEED_ADMIN_PASSWORD`; read it from `.env.local` without echoing it. Users: `sujit.menon@meridianfoods.example` (buyer) and `priya.raghavan@meridianfoods.example` (approver).
    - Vercel request bodies are capped at 4.5 MB.

---

## 4. Phase 4 — Ask panel and exports (requirement checklist)

### P4-T1 SQL guard — `src/lib/query/sql-guard.ts` (TRD §13.4)
- [ ] 1. After trimming, the SQL starts with `select` or `with` (any case).
- [ ] 2. Rejects `insert|update|delete|drop|alter|create|grant|truncate|copy|call|do` as words, and also `;`, `--`, `/*`, `pg_`, `information_schema`, `current_user`, `set\s`, `lateral` and `into\s`.
- [ ] 3. Identifier allowlist: only `v_comparison`, `v_comparison_bestguess`, `v_vendor_status`, `v_questionnaire` and `v_assumptions`, their columns, SQL keywords, and allowed functions:
  - aggregates; `coalesce`, `round`, `case`; string and number functions;
  - window functions (`rank`, `dense_rank`, `row_number`, `min … over (partition by …)`), which Q1 and Q4 need.
  - Any other token → reject, naming the token.
  - **Base tables are never allowed.** `run_readonly_query` is `security definer` and could read `users.password_hash` (DECISIONS "Known risk for P4").
- [ ] 4. Must contain `rfx_id = '<this rfx id>'` literally. Any other rfx id → reject.
- [ ] 5. At most 4,000 characters.
- [ ] 6. Unit tests: one rejection per rule above (including `users`, `line_quotes`, another rfx id, and a missing rfx_id), plus acceptance of a realistic Q1 SQL (CTE + window function) and a Q6 SQL.

### P4-T2 Ask route (TRD §13.1–13.3, §6.17)
- [ ] 7. Migration `0006_*.sql` adds `v_comparison_bestguess`: the same columns as `v_comparison`, with `best_guess_value` folded in via `coalesce(unit_price, best_guess_value)` (and for landed and the annual values); `state` unchanged; `security_invoker = true`; same grants as 0002.
- [ ] 8. `POST /api/ask {rfx_id, question, include_best_guess?}`, following TRD §13.1 exactly:
  1. load the last 4 Q&A for history;
  2. P-SQL (strong model, prompt as written in §9.8, JSON validated with Zod);
  3. guard; one repair round with the validation error; if it still fails, answer **"I couldn't form a safe query for that; try rephrasing"** and log it;
  4. `run_readonly_query`, capped at 500 rows, timing it;
  5. aggregates in TypeScript: sum of columns matching `/annual_value|total/`, row count, distinct vendors, and `unresolved_cells` = `v_comparison` rows for the RFx in the unsure set;
  6. P-NARRATE (fast model, §9.9): never a number that isn't in the rows or aggregates, Indian number format;
  7. `chart_spec` (§13.6) when `needs_chart`;
  8. persist a `queries` row (every §6.17 column that applies, including `error` on failure);
  9. return `{answer_text, computed_note, sql, rows, chart_spec, exclusions, unresolved_cells, query_id}`.
- [ ] 9. `include_best_guess` re-runs the same SQL on `v_comparison_bestguess` (server rewrite), and the response carries both totals (§13.2).
- [ ] 10. Follow-ups use the history ("and on landed cost?" re-plans with `landed_price`, §13.3).
- [ ] 11. `GET /api/ask/history?rfx=` returns the last 20.
- [ ] 12. Both roles can ask (DESIGN §4). `maxDuration = 120`.
- [ ] 13. Done-when on MER-0419: Q1 returns a 30-row table, the total, the exclusions (Westline disqualified; Anand not cleared because Q6 is pending; unsure cells excluded, with their count) and the SQL.

### P4-T3 Ask UI (DESIGN §3.7, §2.13, §2.15; TRD §17.9; PRD #25–27)
- [ ] 14. Buyer: an "Ask" button (chat icon) on the right of the RFx header (DESIGN §2.3), opening a **400px side sheet**. Approver: "Ask" in the Comparison toolbar, opening the same sheet. Don't add "Sync inbox" (that's P6).
- [ ] 15. The sheet has stacked answer cards, three suggestion chips, a textarea, an "Ask" button, and a history list (from item 11).
- [ ] 16. Each answer card has:
  - question and answer text;
  - exclusions line in amber;
  - "How I computed this" with a "Show query" link revealing a `<pre>`;
  - result table in a 260px scroll box, paginated if long;
  - **inline bar chart per DESIGN §2.15 (no library)** when there is a `chart_spec`. The TRD says Recharts; DESIGN wins visually; record this;
  - unresolved notice with an **"Include best guesses"** button that shows both totals side by side;
  - "Export" (P4-T4).
- [ ] 17. "Save as scenario" comes in **P7**. Don't render a dead button; record in DECISIONS that it arrives with P7-T1.
- [ ] 18. Every question in PRD §13 returns a computed answer on MER-0419, asked through the UI. That's Q1–Q8, plus "Who has the shortest validity?", "Who didn't quote line 22?" and "Why is Anand's 5-ply so cheap?" (the last must surface the per-kg conversion using *our* weight). For each, record in PROGRESS.md the answer, row count, total and a one-line SQL summary. Notes on specific questions:
  - **Q2** needs a bar chart.
  - **Q5** gives two totals (saving it as a scenario waits for P7).
  - **Q7** uses the ledger plus a ±3% rupee sensitivity computed from the rows.
  - **Q8** points to the export.
- [ ] 19. Ask each of Q1–Q8 **twice**. Both runs must be computed and equivalent; note any differences.
- [ ] 20. Each answer takes 15 s or less (CLAUDE.md §10). Record the timings.
- [ ] 21. Errors: an off-topic or unsafe question gets the "couldn't form a safe query" answer; a network error shows a toast with the code.

### P4-T4 Exports (TRD §16, PRD #28)
- [ ] 22. `GET /api/export/comparison?rfx=&format=xlsx|csv&basis=unit|landed`:
  - xlsx via exceljs, one row per line and a column per vendor, cells coloured by state (DESIGN colours), plus a legend/notes sheet with the state meanings and the ledger;
  - csv: tidy rows with line, vendor, state, value.
- [ ] 23. `GET /api/export/query/{id}?format=csv|xlsx` for any answer.
- [ ] 24. An "Export" button in the Comparison toolbar (DESIGN §2.8), and on each answer card.
- [ ] 25. Proof: download the files, read them back with a script (exceljs / xlsx) to confirm rows, values and fills, and check each opens without an error.

### Phase 4 checkpoint
- [ ] 26. Tests (including the guard tests), lint and build green; `npm run pipeline:seed` gives 150/150; push.
- [ ] 27. On production: Q1 asked as Priya and as Sujit, both computed with SQL shown; one export downloads.
- [ ] 28. Checklist 1–27 ticked in PROGRESS.md with evidence. **Then continue immediately with Phase 5. Do not stop and do not ask.**

---

## 5. Phase 5 — RFx co-pilot, dispatch (mock), inbox, portal, overview (requirement checklist)

**Test RFx rule:** do every create/issue test on a **throwaway RFx created through the co-pilot** (e.g. "TEST co-pilot run"). **Never issue or edit MER-0418.** P6 issues it live. CLAUDE.md's P5-T2 done-when says "issuing MER-0418"; satisfy it on the throwaway RFx and record why in DECISIONS. At the end, delete the throwaway RFx and its rows and files with a script, so the RFx list shows exactly MER-0417, MER-0418 and MER-0419.

### P5-T1 New RFx page + co-pilot (TRD §17.3, §9.1, §9.2; DESIGN §3.3; PRD Stage 1)
- [ ] 29. `/rfx/new` creates a draft (`POST /api/rfx`); `/rfx/new?id=` opens an existing draft (the RFx list already links there). Buyer only: approver → redirect, API 403.
- [ ] 30. DESIGN §3.3 layout and copy, exactly:
  - eyebrow "DRAFT · <code>", h1 "New RFx", the sub-line;
  - "Save draft" and primary "Issue to N vendors" (disabled until lines, terms and questionnaire exist);
  - split 340–460px | rest.
- [ ] 31. Co-pilot card:
  - header with "Co-pilot" and a status like "terms pending · questionnaire pending";
  - message log with SUJIT / CO-PILOT labels and the 2px left rules; patch box summarising what was written;
  - suggestion chips: "Attach last year's sheet", "Standard terms", "Attach questionnaire", "Add vendors";
  - textarea with the DESIGN placeholder; hint "Attach xlsx / csv"; "Send".
- [ ] 32. `POST /api/rfx/{id}/copilot {message, attachments?:[{name,text}]}`:
  - P-COPILOT as written in §9.1, with the `CopilotTurn` Zod schema;
  - applies `rfx_patch` to the draft; stores the transcript in `rfx.copilot_transcript`;
  - asks at most 3 questions per turn; never invents lines;
  - audits each applied suggestion.
- [ ] 33. Attachments (xlsx/csv/txt) go through the existing preprocessors, then P-LINESHEET (§9.2). **Done-when:** attaching `supabase/seed/00_rfx/rfx_lines.xlsx` gives exactly 30 lines, with SKUs preserved and ply, dimensions, type, weight and quantities correct (check against `rfx_lines.csv` with a script).
- [ ] 34. Typing "standard terms" fills the Terms tab with the P-COPILOT defaults (delivered, freight included, 45 days, 60 days, 12 months, INR, per 1000 pcs).
- [ ] 35. Asking for a questionnaire proposes 8–12 questions with types, mandatory flags and suggested disqualifiers; the buyer can edit them.
- [ ] 36. Editor tabs "Lines [n]", "Terms", "Questionnaire [n]", "Vendors [n]", all editable, saved with `PATCH /api/rfx/{id}` (draft only, 409 otherwise):
  - Lines: line_no, SKU (mono), description, ply, L/W/H, gsm, BF, type, weight g, monthly qty, annual qty (auto ×12, editable), location; add/remove; the DESIGN empty state and footer hint.
  - Vendors: add from the address book (existing vendors) or name + email.
- [ ] 37. Every change survives a reload (it's in the database, not only in the browser).

### P5-T2 Issue + dispatch, mock mode (TRD §15.1–15.2, §9.3, §17.3; PRD Stage 2)
- [ ] 38. A confirm dialog lists what will be sent and to whom.
- [ ] 39. `POST /api/rfx/{id}/issue`:
  - freezes v1 (`version = 1`, `frozen_at`), sets status `issued`;
  - generates the **line-sheet XLSX** (exceljs) and the **questionnaire PDF** (@react-pdf/renderer), stored in bucket `outbound`;
  - writes P-DISPATCH per vendor (§9.3, including the exact sentence "Please reply to this email with your quotation in any format convenient to you — we will process it as sent.");
  - sends through `src/lib/email/index.ts` `sendEmail()` per §15.1: `communications` row queued, then updated to `sent` with mode `mock`, `sent_at`, attachments, and the Reply-To tag from `rfx_vendors.reply_tag`;
  - sets `rfx_vendors.invited_at`;
  - audits `rfx.frozen` and `dispatch.sent`.
  - Frozen means lines, terms, questions and vendors can no longer be edited (PATCH → 409).
- [ ] 40. Outbox page: list of outbound communications, each with "Open" rendering the email block (DESIGN §2.16) and **downloadable attachments**. Proof: download both attachments for one vendor and open them (read the XLSX back with a script: 30 lines; check the PDF has the 10 questions).
- [ ] 41. Done-when (on the throwaway RFx): issuing creates **5 outbox entries**, each with both attachments.

### P5-T3 Inbox (mock) + Vendor Portal Simulator (TRD §15.2, §17.5–17.6; DESIGN §3.5; PRD Stage 3)
- [ ] 42. "Add response" (quiet button on each vendor row of the Responses tab) opens a 400px side sheet exactly as DESIGN §3.5 describes: drop zone text, "OR PASTE THE EMAIL BODY", textarea, "Use seed file", primary "Submit and run", hint. Submitting creates the response via `POST /api/responses`, runs all six stages (`run-all`), and lands on Response Detail with the pipeline visibly running.
- [ ] 43. `/rfx/{id}/portal/{vendorId}` looks like a mailbox: "From Sujit Menon", the subject, the dispatch body, downloadable attachments, then a Reply form (files + text). It posts with `source='portal'`. **Done-when:** a portal reply runs the full pipeline and its cells appear in the grid.
- [ ] 44. Files over 4.5 MB: either switch to a signed direct-to-Storage upload, or show a clear error ("File is over 4.5 MB …"). Never fail silently. Record which.
- [ ] 45. A reply to the throwaway RFx through the portal must not touch MER-0419's data. Then run the pipeline on MER-0419 once more and check it's still 150/150.

### P5-T4 RFx overview (TRD §17.4; DESIGN §3.4, §2.3)
- [ ] 46. `/rfx/{id}/overview` becomes the buyer's default tab, and `/rfx/{id}` redirects the buyer there (the approver still goes to Comparison). Buyer tabs become Overview · Responses · Review [n] · Comparison.
- [ ] 47. DESIGN §3.4 layout:
  - left: "WHERE THIS STANDS" with a **computed** lead sentence (replies, how many cleared, open items, cheapest-qualified total; never hardcoded), and a "Needs you" card (vendor → issue, "Open the queue" link);
  - right: "The event" card (Issued · Deadline · Scope · Terms · Plants · Questionnaire · Transport);
  - full width: "Vendors" table (Vendor · Sent as · Received · Priced n/30 · Valid to, with an amber chip if short · Questionnaire chip · Needs you count) and "Vendor communications" timeline (all communications: direction arrow, timestamp, subject, attachments, message id, status).
- [ ] 48. Per vendor: "Portal (mock)" link (mock mode) and "Open response". "Load seeded responses" stays available in mock mode. DESIGN says "no buttons duplicate the tabs", so leave out TRD's "Go to Review / Go to Comparison" and record why. The unmatched-responses panel shows when there are any.
- [ ] 49. RFx header meta shows "Reviewing · 5 of 5 responded" (DESIGN §2.3).
- [ ] 50. Empty or early states read sensibly: a draft RFx (links to New RFx), and an issued RFx with 0 replies.

### Phase 5 checkpoint
- [ ] 51. The full TRD §22 item 2 flow on production:
  1. New RFx via co-pilot;
  2. paste/attach the line sheet → 30 lines;
  3. questionnaire proposed; terms set; vendors added;
  4. Issue → Outbox shows 5, with attachments;
  5. a portal reply runs the pipeline.
  After that, delete the throwaway RFx (script).
- [ ] 52. Approver on production: no New RFx, no Issue, no Add response; Overview isn't in their tabs; the API returns 403.
- [ ] 53. Tests, lint and build green; `npm run pipeline:seed` gives 150/150 (clean); push.
- [ ] 54. Final state:
  - MER-0419 seeded, with 14 open review items;
  - MER-0417 realistic;
  - **MER-0418 an untouched draft** (v0; no communications; vendors not invited);
  - the RFx list shows exactly these three.
- [ ] 55. Side by side with the prototype at 1440px for every screen P4/P5 touched: Ask sheet, New RFx, Overview, Responses with the Add response sheet, Outbox, Portal. Fix visible differences or record them.
- [ ] 56. Checklist 29–55 ticked in PROGRESS.md with evidence.

---

## 6. Things that are NOT in P4/P5 (don't build them; list them as "later" in the report)

- Gmail send and IMAP sync, "Sync inbox", the `tag.ts` parser, the clarification loop (P6).
- Scenarios, "Save as scenario", award memo, approve, lock bar (P7).
- The approver's **Decide** page (DESIGN §3.8). It isn't in any CLAUDE.md task. Put it under Open questions in PROGRESS.md; don't build it.
- Settings page (including the "Change in settings" links on assumption cards), Eval page, Logs page (P8).

---

## 7. When Phase 5 is done: stop and report to Sujeet

Write a plain-language summary (he is not an engineer):
1. **What was built,** screen by screen: what he can now do in the app.
2. **Both checklists,** with ✓ and the evidence, and any open items with their reason.
3. **The Q1–Q8 results table:** answer, total, timing.
4. **Eval numbers:** clean and realistic.
5. **Every decision made without him** (point to the DECISIONS.md entries).
6. **Anything that needs him,** including these still-open items from before:
   - review the P1 responses on the site;
   - reset the Supabase database password;
   - delete `.env.vercel`;
   - photograph the OrientPack rate card;
   - record the 2-minute screen capture (CLAUDE.md P3);
   - for P6: set up the Gmail App Password and the second Gmail account's plus-aliases (CLAUDE.md §6).

Do not start Phase 6.
