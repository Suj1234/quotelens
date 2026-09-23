# CLAUDE.md — QuoteLens build plan
## Document 4 of 6 — how Claude Code builds this in 48 hours

This file lives at the repo root. Claude Code reads it on every session. It is the operating manual for the build; the *what* is in `docs/01_PRD.md`, the *how* is in `docs/02_FSD_TRD.md`, the test data is in `supabase/seed/` (from `docs/03_Dataset_Pack_README.md`). If this file and the TRD disagree, the TRD wins on design and this file wins on order and scope.

---

## 0. Ground rules (read every session)

1. **Read before building.** At the start of every session: read this file, then `docs/02_FSD_TRD.md` sections relevant to the current phase, then `PROGRESS.md`. Never start a phase without reading its TRD sections.
2. **Critical path first.** The order in §3 is not negotiable. Extraction on the five seed files must work end-to-end before any UI polish, email, scenarios or memo. If a phase overruns, cut from the *later* phases per the cut list in §5, never from Phase 1–3.
3. **No faking.** Never cache model outputs keyed on file content, never special-case the seed files, never hardcode an answer to a demo question. If a test needs a fixed response, mock at the provider boundary in test code only, never in app code.
4. **Every model call goes through `lib/ai/gemini.ts` or `lib/ai/decision/index.ts`** and is logged to `model_calls`. No direct SDK calls elsewhere.
5. **Every model output is validated with Zod** before it is written to the DB. On failure, retry once with the validation error appended, then fail the stage visibly.
6. **Stage-per-request.** A pipeline stage is one HTTP request that reads its inputs from the DB and writes its outputs to the DB. No in-memory state between stages. Every stage is idempotent (re-running replaces its own outputs).
7. **Secrets only in env.** `import "server-only"` at the top of every module that touches a key. Never log a key. `.env.local` is git-ignored.
8. **Verify moving targets.** Before writing model IDs, library versions or provider request shapes, check the live docs listed in §8 and record what you found in `DECISIONS.md`.
9. **Commit per task.** Small commits with the task ID in the message (`P2-T4: extract stage for xlsx`). Push after every phase checkpoint.
10. **Update `PROGRESS.md`** at the end of every task: task ID, status, what works, what doesn't, next step. This is how the human (non-engineer) follows the build and how the next session resumes.
11. **Ask, don't guess, on product decisions.** If a choice is not covered by the PRD/TRD and changes what the user sees, write the question in `PROGRESS.md` under "Open questions", pick the option that is easiest to reverse, and continue.
12. **Run the seed pipeline after every change to extraction/mapping/normalisation** (`npm run pipeline:seed`) and record the eval numbers in `PROGRESS.md`. A regression on the eval blocks the commit.
13. **Match the design.** `design/DESIGN.md` is the design specification (tokens, type, spacing, components, every screen's placement and copy, roles); `design/prototype.html` is the reference rendering — open it in a browser and read its `<style>` block for exact values. Use shadcn/ui only restyled to those tokens, never with defaults. Before marking a phase done, put the app and the prototype side by side at 1440px for every screen that phase touched and fix visible differences. Never introduce the patterns DESIGN.md §0.8 lists as generated-looking.

---

## 1. Repo conventions

- Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, Zod, Supabase JS (service role, server only).
- Layout per TRD §3. Path alias `@/` → `src/`.
- Server code: Route Handlers under `src/app/api/**` (thin: parse, call `lib/*`, respond). Business logic lives in `src/lib/**` and is unit-testable without HTTP.
- Naming: tables and columns snake_case (as in TRD §6); TS types PascalCase generated from the schema (`supabase gen types` or hand-written in `src/types/db.ts` mirroring §6).
- Errors: throw `AppError(code, message, details)`; route handlers map to `{error, code}` JSON with proper status. Never swallow errors.
- Logging: `lib/log.ts` — `logModelCall()`, `audit()`. Console logs prefixed `[stage:extract]` etc.
- Tests: Vitest. Unit tests for `lib/normalise/*`, `lib/query/sql-guard.ts`, `lib/email/tag.ts`, `lib/preprocess/*`. Integration script (not a test) for the pipeline on seed files.
- Scripts in `package.json`:
  - `dev`, `build`, `start`, `lint`, `test`
  - `db:migrate` — apply `supabase/migrations/*.sql` via the Supabase MCP `apply_migration` or SQL editor (document which was used)
  - `seed` — `tsx scripts/seed.ts` (users, vendors, settings, RFx MER-0417/0418/0419, copy dataset to bucket `seed`)
  - `pipeline:seed` — `tsx scripts/run-seed-pipeline.ts` (load seeded responses into MER-0419, run all stages, run eval, print table)
  - `eval` — `tsx scripts/run-eval.ts --rfx MER-0419`
- Docs folder: `docs/01_PRD.md`, `docs/02_FSD_TRD.md`, `docs/03_Dataset_Pack_README.md`, `docs/05_Demo_Script.md`, `docs/06_One_Page_Note.md`. Design: `design/DESIGN.md`, `design/prototype.html`. Dataset: `supabase/seed/` (folders `00_rfx` … `05_anand`, `gold/`, `realistic/`, plus the generator scripts). `PROGRESS.md` and `DECISIONS.md` at root.

---

## 2. Time budget

48 hours wall clock, one builder, Claude Code. Assume ~30 productive build hours; the rest is sleep, setup, the photo, recording and the note. Budget:

| Phase | Hours | Cumulative | Checkpoint |
|---|---|---|---|
| P0 Setup | 2 | 2 | App deploys to Vercel with a hello page; Supabase schema applied; seed runs |
| P1 Preprocess + extract | 6 | 8 | Five seed files → `extracted_items` + `response_terms` visible on a raw page |
| P2 Map + normalise + flags + questionnaire | 5 | 13 | `line_quotes` grid populated; eval ≥ 120/150 correct or flagged_ok |
| P3 Review queue + provenance + comparison UI | 5 | 18 | Demo-able comparison with cell states, drawer, queue actions |
| P4 Ask panel (query layer) + exports | 4 | 22 | Q1–Q8 answer live with SQL shown; CSV/XLSX export |
| P5 RFx co-pilot + dispatch (mock) + inbox + portal | 3 | 25 | New RFx → issue → outbox → simulate reply → pipeline |
| P6 Gmail mode (send + IMAP sync) + clarification loop | 3 | 28 | Live email round-trip on MER-0418 |
| P7 Scenarios + award memo + approve | 2 | 30 | Memo PDF; RFx locks |
| P8 Eval page, settings, logs, polish, seed completed RFx | 2 | 32 | Demo account ready |
| Buffer / recording / note | — | — | — |

If at hour 13 the P2 checkpoint is not met, stop adding features: spend the time on extraction quality until eval ≥ 120, then proceed with the cut list (§5) applied.

---

## 3. Phased task list

Each task: **ID · title · TRD refs · deliverable · done-when**. Do them in order inside a phase. Tick them in `PROGRESS.md`.

### Phase 0 — Setup (target: hour 2)

- **P0-T1 Scaffold.** `npx create-next-app@latest quotelens --ts --tailwind --app --src-dir --eslint`; add shadcn/ui (`button card table tabs badge dialog sheet toast slider input textarea select dropdown-menu progress tooltip`), Zod, `@supabase/supabase-js`, `@google/genai`, `xlsx`, `exceljs`, `mammoth`, `sharp`, `nodemailer`, `imapflow`, `mailparser`, `@react-pdf/renderer`, `recharts`, `iron-session`, `tsx`, `vitest`. Copy `docs/*` and `supabase/seed/*` in. Create `.env.example` per TRD §4. Done when `npm run dev` shows a page.
- **P0-T2 Supabase.** Create project (human does this in the dashboard, or via Supabase MCP `create_project`); write `supabase/migrations/0001_init.sql` exactly from TRD §6.1–6.20 and `0002_views.sql` from §6.21 (including `run_readonly_query`); apply; create buckets `raw`, `derived`, `outbound`, `seed` (private). Write `src/lib/db.ts` (service-role client, server-only) and `src/types/db.ts`. Done when `select count(*) from rfx` runs.
- **P0-T3 Auth.** Cookie session with `iron-session`; `POST /api/auth/login`, `/logout`; `requireUser()` helper; login page with two buttons (Sujit / Priya) that prefill email; password from `SEED_ADMIN_PASSWORD`. Done when protected page redirects when logged out.
- **P0-T4 Seed script.** `scripts/seed.ts` per TRD §20 steps 1–5 (no pipeline run yet): users, vendors (short codes `balaji kohinoor westline orientpack anand`), settings defaults (TRD §6.19), RFx MER-0417 (issued, frozen v1), MER-0418 (draft), MER-0419 (issued, for seed pipeline) with lines from `rfx_lines.csv`, questions from `questions.json`, `rfx_vendors` with `reply_tag`; upload dataset pack to bucket `seed`. Idempotent (upsert by code/short_code). Done when RFx list page shows three RFx.
- **P0-T5 Deploy.** Vercel project (human links repo), env vars set, Fluid Compute on, `vercel.json` per TRD §21. Done when the production URL shows the login page. Record URL in `PROGRESS.md`.
- **P0-T6 Model check.** Write `scripts/check-models.ts` that lists available Gemini models via the SDK and calls the chosen fast/strong models with a 1-line JSON-schema prompt; record the working model IDs in `DECISIONS.md` and set `GEMINI_MODEL_FAST/STRONG`. Done when both calls return valid JSON.

### Phase 1 — Preprocess and extract (target: hour 8)

- **P1-T1 Storage helpers.** `lib/storage.ts`: `putRaw(responseId, file)`, `putDerived()`, `signedUrl(path)`. Done when a test file round-trips.
- **P1-T2 Preprocessors.** TRD §7: `preprocess/xlsx.ts` (all sheets, cell refs preserved, `[row N] A1=…` format, hidden rows included but marked `(hidden)`, comments appended as `[comment: …]`, numbers-as-text passed verbatim), `docx.ts` (mammoth → paragraphs `[p N]` and tables `[table t row r]`), `image.ts` (EXIF auto-orient, downscale 2000px, keep original), `pdf.ts` (page count; ≤20 pages → pass through; rasterise on demand), `email.ts` (strip quoted `>` blocks and "On … wrote:" tails; strip signature after `--`/"Sent from my"; number lines). Unit tests on the realistic seed files (Balaji xlsx must yield `H18=13,710/-` style tokens; Anand realistic must drop the quoted RFx). Done when tests pass.
- **P1-T3 Gemini client.** `lib/ai/gemini.ts`: `generateJSON<T>({model, system, parts, schema: ZodSchema, temperature})` → validates, retries once on validation error with feedback, logs to `model_calls` with tokens/latency, throws `AppError('MODEL_INVALID')`. Supports text parts and `inlineData` (pdf/image). Done when a unit call on the Kohinoor PDF returns JSON.
- **P1-T4 Response intake (mock).** `POST /api/responses` (multipart: rfx_id, vendor_id?, email_text?, files[], source) → `responses`, `response_files`, `communications(inbound, mock)`, raw to bucket, derived text generated. `POST /api/rfx/{id}/seed-responses` (copies the five *clean* seed folders; flag `?set=realistic` uses the realistic folder). Done when MER-0419 gets five responses with files.
- **P1-T5 Classify stage.** TRD §8.1 with the decision layer stub (for now, Gemini emulation only — the full decision layer is P2-T1; implement `decide()` with the Gemini provider first). P-CAPTION for images/PDFs. Writes `file_kind`, probability, provider. Done when: Balaji xlsx → quotation; certificates/profiles → supporting; OrientPack questionnaire PDF → questionnaire; Anand text → quotation.
- **P1-T6 Extract stage.** TRD §8.2 + P-EXTRACT + `ExtractionResult` Zod schema. Chunking for big sheets. Writes `extracted_items` and `response_terms`. Build a raw **Response Detail** page (TRD §17.7, minimal) listing files with kind badges, extracted items table with location snippet and `raw_confidence`, terms card. Done when all five seed responses show items: Balaji 30, Kohinoor 27, Westline 30, OrientPack 30 (line 14 low raw_confidence), Anand 2 rate lines + terms with `references_prior_pricing=true`. Record counts in `PROGRESS.md`.
- **P1-T7 Pipeline runner.** `lib/pipeline/run.ts` + `POST /api/responses/{id}/stage/{stage}` + `run-all` (server chain with per-stage persistence, NDJSON stream). Pipeline strip UI on Response Detail with Retry per stage. Done when "Run all" works on one response and shows stage timings.

**Checkpoint P1:** commit, push, deploy. `PROGRESS.md`: extraction counts per vendor and any misreads.

### Phase 2 — Map, normalise, questionnaire, flags (target: hour 13)

- **P2-T1 Decision layer.** TRD §10: interface, Gemini emulation provider (P-DECIDE prompt §10.4, renormalise, confidence = margin), OpenRouter→Jev provider behind `OPENROUTER_API_KEY` (adapter; verify request shape; fall back to Gemini on any error), routing per `settings.decision_provider`. Unit test: a choice question over 3 options returns probabilities summing to 1. Done when `decide()` logs provider and returns typed answers.
- **P2-T2 Candidate shortlist.** `lib/pipeline/map.ts` deterministic scorer (ply, dims ±5% via regex, item_type keywords, Jaccard, SKU substring). Unit test: Balaji "Corrugated Box 600x400x400 5 ply" → line 1 in top 5; Westline "item 9" → line 9 via explicit item number (add rule: if vendor text contains `item N`/`Sr N`/`S.No N` and N ≤ line count, candidate N gets a +0.5 boost). Done when tests pass.
- **P2-T3 Map stage.** TRD §8.3: batch 10 items per `decide()` call; thresholds; `unmatched_items`; conflict rule. Writes mapping into `responses.summary.mapping`. Done when all seed items map with ≥ 0.85 except deliberate cases.
- **P2-T4 Unit dictionary + FX + discount + freight.** TRD §11.1–11.4, 11.7 in `lib/normalise/*` with unit tests: `"Rs. per 1000 Nos"`→per_1000_pcs; `"per bundle of 25 nos"`→per_bundle with pack 25; `"Rs.42/- per kg"`→per_kg 42; `"USD / 1000 pcs"`→USD per_1000_pcs; `"13,710/-"`→13710; Indian grouping `1,04,280`→104280. Done when tests pass.
- **P2-T5 Normalise stage.** TRD §8.4 + §11.5 + §11.6: `line_quotes` upsert, `conversion_chain`, `assumptions`, cell states, `not_quoted` fill, `references_prior` fill, landed price. Review items per §8.4. Done when the grid API (`GET /api/rfx/{id}/comparison`) returns 150 cells with the expected state distribution (README §5 table) ± small drift.
- **P2-T6 Questionnaire stage.** TRD §8.5 + P-QA-EXTRACT + decision booleans batched per vendor; `passes`, `ambiguous`, `missing`. Done when `v_vendor_status.cleared_questionnaire` = true for balaji/kohinoor/orientpack, false for westline, null for anand (Q6 ambiguous).
- **P2-T7 Flags stage.** TRD §8.6. Done when Kohinoor has `validity_short`, OrientPack/Anand `freight_excluded`, Anand `references_prior_pricing`, Balaji `total_discount_present`, Kohinoor `partial_quote`.
- **P2-T8 Eval runner.** TRD §18 + README §5 rules incl. `alt_expected` and `flagged_ok`. `scripts/run-eval.ts` prints a table and writes `eval_runs`. Done when it runs on MER-0419 and reports the number. **Target ≥ 120/150 here; ≥ 143 by P8.**

**Checkpoint P2:** commit, push, deploy, eval number in `PROGRESS.md`. If < 120: iterate on P-EXTRACT / mapping before continuing.

### Phase 3 — Review queue, provenance, comparison UI (target: hour 18)

All UI in this phase and later follows `design/DESIGN.md` §2–3; the prototype's screens are the acceptance reference.

- **P3-T1 Comparison grid.** TRD §17.9 Prices tab: sticky first column, vendor headers (coverage, validity, cleared ✓/✗, freight badge, total), cell renderer per state with legend and counts, per-line min highlight, basis toggle (unit/landed), show-original toggle, include-disqualified toggle. Done when MER-0419 renders all states visibly distinct.
- **P3-T2 Provenance drawer.** TRD §17.10 + `GET /api/rfx/{id}/cell/{line}/{vendor}`: source (signed URL; image crop with bbox via `sharp`; PDF page image with bbox overlay if bbox present, else page thumbnail; cell row text; text snippet), mapping alternatives with probabilities and provider label, conversion chain with assumption links, review history. Done when the five source types each open correctly (README §7 test 4).
- **P3-T3 Review queue.** TRD §12 + §17.8: list with filters, evidence rendering, actions confirm/override/exclude/map/ignore/ask-vendor(draft only for now)/mark-not-quoted/dismiss, bulk actions, keyboard J/K/C. Effects on `line_quotes`/`questionnaire_answers`/`assumptions` per §12.3; audit events. Done when clearing the seed queue leaves the grid with `reviewed` cells and no `open` items except informational.
- **P3-T4 Questionnaire, Documents, Ledger, Timeline tabs.** TRD §17.9. Done when each tab shows seed data.
- **P3-T5 Unmatched items panel + unmatched responses list + assign-vendor.** TRD §16. Test with `wrong_category_IT_quote.xlsx` and the WhatsApp PNG (unknown vendor). Done when neither crashes and both land where README §11 says.

**Checkpoint P3:** demo-able comparison. Deploy. Record a 2-minute screen capture for yourself to sanity-check pacing.

### Phase 4 — Ask panel and exports (target: hour 22)

- **P4-T1 SQL guard.** TRD §13.4 with unit tests: rejects `;`, `--`, DML, unknown identifiers, missing `rfx_id`; accepts the Q1 SQL. Done when tests pass.
- **P4-T2 Ask route.** TRD §13.1: P-SQL → guard → `run_readonly_query` → aggregates → P-NARRATE → `queries` row. `include_best_guess` variant via `v_comparison_bestguess` (add to `0002_views.sql`). Done when Q1 returns a 30-row table, total, exclusions (Westline disqualified; Anand not cleared; unsure cells excluded) and the SQL.
- **P4-T3 Ask UI.** TRD §17.9 right panel: input, history, answer cards (text, paginated table, chart via `ChartSpec`, "How I computed this", Show query, exclusions, unresolved notice + Include best guesses, Save as scenario (stub until P7), Export). Done when Q1–Q8 (PRD §13) all produce computed answers; note any that need prompt tuning in `PROGRESS.md`.
- **P4-T4 Exports.** `GET /api/export/comparison` (xlsx via exceljs with state colouring; csv), `GET /api/export/query/{id}`. Done when files open in Excel.

**Checkpoint P4:** the "analyst conversation" is recordable. Deploy.

### Phase 5 — RFx co-pilot, dispatch (mock), inbox, portal (target: hour 25)

- **P5-T1 New RFx page + co-pilot.** TRD §17.3 + P-COPILOT + P-LINESHEET; `POST /api/rfx/{id}/copilot` applies `rfx_patch`; editable Lines/Terms/Questionnaire/Vendors tabs; attachment parsing for xlsx/csv/txt. Done when pasting `rfx_lines.xlsx` yields 30 lines and "standard terms" fills the Terms tab.
- **P5-T2 Issue + dispatch (mock).** `POST /api/rfx/{id}/issue`: freeze v1, generate line-sheet xlsx (exceljs) and questionnaire PDF (react-pdf), P-DISPATCH per vendor, `sendEmail` via `lib/email/index.ts` with mock provider → `communications(outbound, mock, sent)`. Outbox page. Done when issuing MER-0418 creates five outbox entries with attachments downloadable.
- **P5-T3 Inbox (mock) + Vendor Portal Simulator.** TRD §15.2, §17.5–17.6. Done when a reply via the portal runs the pipeline.
- **P5-T4 RFx overview.** TRD §17.4: vendor cards, communications timeline, buttons. Done.

### Phase 6 — Gmail mode and clarification loop (target: hour 28)

- **P6-T1 Gmail send.** TRD §15.3 send via nodemailer; `settings.vendor_addresses` mapping; Reply-To tag via `lib/email/tag.ts` (unit test parse/format). Human prerequisite: App Password created, second Gmail account's plus-aliases decided, env set. Done when issuing MER-0418 in gmail mode delivers five emails to the second inbox with attachments.
- **P6-T2 IMAP sync.** `POST /api/email/sync`: imapflow, unseen since issue, parse with mailparser, tag from `to` → else subject → else `in_reply_to`; idempotent on `message_id`; attachments to raw; `responses(source='gmail')`; mark seen. Client polls every 30 s on the overview page + button. Done when replying from the second account with the Balaji xlsx creates a response and the pipeline runs.
- **P6-T3 Clarification loop.** `POST /api/clarify` (P-CLARIFY draft from selected review items) + `/send` (both modes); reply tag suffix `-clar-n`; ingestion of clarification replies per TRD §8.7 (targeted line upsert; review items → `resolved_by_reply`). Test with `westline_clarification_reply.txt` (mock paste) and, in gmail mode, a real reply. Done when Westline items 5/9/15/19 become `reviewed` with bundle sizes 25/20/50/40.

### Phase 7 — Scenarios, award memo, approval (target: hour 30)

- **P7-T1 Scenarios.** TRD §14.1–14.2 allocation rules (deterministic), Save-as-scenario from a query, compare page, per-line override with reason. Done when Q1 and Q5 saved as scenarios compare side by side.
- **P7-T2 Award memo.** TRD §14.3 react-pdf memo + P-MEMO narrative; `generate` and `approve` routes; RFx lock (grid read-only, actions disabled). Done when the PDF opens and contains all six sections with the ledger.

### Phase 8 — Eval page, settings, logs, polish, seed completion (target: hour 32)

- **P8-T1 Eval page** (TRD §17.14) and **Logs page** (§17.15). **Settings page** (§17.13) incl. provider switch and thresholds; changing thresholds re-derives states on next stage run only (document this).
- **P8-T2 Seed completed RFx.** `npm run pipeline:seed` against production for MER-0417 using the **realistic** set; clear its review queue as Sujit through the UI (this is real usage, leave the audit trail); ask Q1–Q8 once so history exists; save two scenarios; generate the memo; approve as Priya. MER-0419 stays as the "Load seeded responses" demo (clean set). MER-0418 stays draft for the live run.
- **P8-T3 Polish pass.** Empty states, loading skeletons, toasts, error states with Retry, consistent number formatting (Indian grouping ₹), legend everywhere states appear, the "measured (Jev) / LLM-estimated (Gemini)" label. No new features.
- **P8-T4 Test checklist.** Run TRD §22 items 1–12 on production; record results in `PROGRESS.md`.

---

## 4. Definition of "done" per phase (what the human checks)

| Phase | The human opens… | …and sees |
|---|---|---|
| P1 | Response Detail for each of the five seed responses | Files with kind badges; extracted items with snippets; terms |
| P2 | `npm run eval` output | ≥ 120/150 correct+flagged_ok; state distribution close to README §5 |
| P3 | Comparison page for MER-0419 | Colour-coded grid; click a cell → drawer with the source; Review Queue clears |
| P4 | Ask panel | Q1–Q8 computed; SQL visible; export works |
| P5 | New RFx → Issue | Outbox with five emails and attachments; portal reply runs pipeline |
| P6 | Second Gmail inbox | Five real emails; reply → appears in app; clarification round-trip |
| P7 | Award page | Memo PDF; Approve locks RFx |
| P8 | Login as Sujit/Priya | MER-0417 completed, MER-0418 draft, MER-0419 seeded; Eval page number |

---

## 5. Cut list (apply in this order if behind schedule)

1. Weighted award (P7-T1 `weighted` rule) — keep `cheapest_per_line` and `grouped`.
2. Landed-cost cost-of-money term — keep freight only.
3. Vendor Portal Simulator — keep Inbox upload/paste.
4. Documents tab page previews — keep file list with download.
5. Chart rendering in Ask — keep tables; keep `chart_spec` in the response for later.
6. PDF bbox overlays — keep page thumbnail + snippet.
7. Scenario compare page — keep Save-as-scenario and a simple list with totals.
8. Gmail IMAP polling timer — keep the manual Sync button.
9. Realistic-set extras (WhatsApp, scanned PDF) as tested inputs — keep code paths generic; don't tune for them.
10. **Never cut:** review queue, provenance drawer, computed answers with SQL shown, assumptions ledger, eval runner, the five seed files working.

---

## 6. Human tasks (Sabarish) and when

| When | Task |
|---|---|
| Before P0 | Create Supabase project; create Vercel project linked to the repo; Gemini key in hand; decide the sender Gmail account and create its App Password; decide the second Gmail account for plus-aliases |
| P0-T5 | Approve first deploy; paste env vars into Vercel |
| P1 end | Look at Response Detail for each vendor; tell Claude Code which extracted items look wrong |
| P2 end | Read the eval table; flag any cell you disagree with (use `gold_cells.csv`) |
| Any time | Print `OrientPack_Rate_Card_PRINT_ME.pdf`, add the pen note (README §11), photograph at an angle, save as `04_orientpack/OrientPack_Rate_Card_PHOTO.jpg`, add to `supabase/seed/` |
| P6 | Reply to the five RFx emails from the second Gmail account with the realistic files; reply to the clarification |
| P8 | Walk through TRD §22 on production; record the Loom (`docs/05_Demo_Script.md`); write the note (`docs/06_One_Page_Note.md`) |

---

## 7. Session start checklist for Claude Code

```
1. cat CLAUDE.md PROGRESS.md DECISIONS.md; skim design/DESIGN.md §0–1
2. git status && git log --oneline -5
3. Identify current phase + next task ID from PROGRESS.md
4. Read the TRD sections listed for that task
5. Run: npm run test (must be green before new work)
6. Work the task → commit → update PROGRESS.md
7. If the task touched extraction/mapping/normalise: npm run pipeline:seed → paste eval numbers into PROGRESS.md
8. End of phase: deploy; run the phase's "done" check from §4; push
```

`PROGRESS.md` template:
```
# Progress
## Current: Phase P2, next task P2-T5
## Deploy URL: https://…
## Eval (latest): 131/150 (correct 118, flagged_ok 13, wrong 12, missing 6) — 2026-09-25 03:10
## Done
- [x] P0-T1 … (commit abc123)
## In progress
- [ ] P2-T5 normalise stage — states for Westline ambiguous ok; Anand references_prior not filling → fixing
## Open questions (for Sabarish)
- Should total-level discounts default to gross or net? (PRD says gross; implemented gross)
## Known issues
- OrientPack line 14 read as 30.32 with confidence 0.7 on the synthetic photo — threshold or prompt tuning needed
```

`DECISIONS.md` template: date · what was specified · what was found/used instead · why · where it matters.

---

## 8. Moving targets to verify at build time (record in DECISIONS.md)

| Item | Where to check | What to record |
|---|---|---|
| Gemini model IDs (fast/strong), PDF+image input support, JSON schema support, context and output limits | https://ai.google.dev/gemini-api/docs/models and `/structured-output` | Chosen IDs; any schema limitations (e.g. unsupported JSON-schema keywords) |
| `@google/genai` SDK call shapes for inlineData and responseSchema | https://ai.google.dev/gemini-api/docs | Snippet used |
| OpenRouter Jev request/response shape (only if key present) | https://openrouter.ai/typesafe/jev-1.13 and TypeSafe docs | Adapter mapping |
| Vercel Hobby function limits with Fluid Compute | https://vercel.com/docs/functions/limitations | Max duration actually applied |
| Gmail App Password + IMAP settings | Google account security page | Confirmed working host/ports |
| shadcn/ui install commands and component names | https://ui.shadcn.com | Versions |
| Supabase Storage signed URL API | https://supabase.com/docs | Snippet |

---

## 9. Prompt-tuning protocol (so it doesn't eat the schedule)

1. Change one prompt at a time; keep the previous version in `prompts/archive/`.
2. Run `npm run pipeline:seed` (both clean and realistic sets, flag `--set`).
3. Compare eval tables; accept only if `correct + flagged_ok` does not drop for any vendor.
4. Time-box: max 45 minutes per tuning round in P1/P2; max 20 minutes in later phases.
5. Known hard cases and the intended fix direction:
   - Balaji generic descriptions → mapping must weight size + ply + type (already in the scorer); if still wrong, add "vendor row order matches our line order" as a weak prior (+0.15 when vendor S.No == line_no).
   - Kohinoor footnote → P-EXTRACT already asks for footnotes; if missed, add "Read every line below the table, including lines starting with * or **" to the prompt.
   - Westline prose → if items are merged, add "one item per price mentioned" to the prompt.
   - Anand quoted thread → must be stripped in preprocessing, not by the model.
   - OrientPack rotated photo → `sharp().rotate()` (EXIF) before anything; if no EXIF, try 0/90/180/270 and pick the orientation where the caption prompt reports "readable table".

---

## 10. Demo-readiness gate (before recording)

- [ ] Production URL loads in an incognito window; login works for both users.
- [ ] MER-0417 completed; MER-0418 draft; MER-0419 seeded with queue open.
- [ ] Eval page shows the latest number and per-cell diff.
- [ ] Drag-and-drop of `wrong_category_IT_quote.xlsx` into any Inbox → Unmatched, no crash.
- [ ] Q1–Q8 return computed answers within 15 s each.
- [ ] Gmail mode: one live round-trip tested within the last 12 hours.
- [ ] Settings → decision provider switch visible; Logs page shows provider per call.
- [ ] Memo PDF downloads.
- [ ] `PROGRESS.md` and `DECISIONS.md` up to date (interviewers may read the repo).

---

*End of Build Plan. Next: document 5 — Demo Script (written once P4 is done), document 6 — One-page Note (written last).*
