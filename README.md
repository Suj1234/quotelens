# QuoteLens

**Kill the Quote Spreadsheet.** QuoteLens is an AI-native sourcing tool for a corrugated-packaging buyer at *Meridian Foods*. The buyer and a co-pilot agent put together an RFx by chatting, then issue it to vendors. Vendors can reply in any format. QuoteLens reads every reply and builds one side-by-side comparison with the same lines, units and currency. An analyst agent answers questions about that comparison with computed answers. The flow ends in an award memo that the approver signs.

**Live:** https://quotelens-seven.vercel.app. Sign in as **Sujit Menon** (Category Buyer) or **Priya Raghavan** (VP Procurement). The sign-in page has a button for each.

---

## Contents

1. [How it works, end to end](#how-it-works-end-to-end)
2. [The two AI agents](#the-two-ai-agents)
3. [Reading vendor replies: the pipeline](#reading-vendor-replies-the-pipeline)
4. [Review queue](#review-queue)
5. [Comparison and provenance](#comparison-and-provenance)
6. [Ask: questions over the data](#ask-questions-over-the-data)
7. [Award options, memo and approval](#award-options-memo-and-approval)
8. [Email, outbox and vendor portal (mock)](#email-outbox-and-vendor-portal-mock)
9. [Roles](#roles)
10. [Settings, evaluation and logs](#settings-evaluation-and-logs)
11. [Trust and safety built into the code](#trust-and-safety-built-into-the-code)
12. [Stack, setup and scripts](#stack-setup-and-scripts)
13. [Repo map](#repo-map)
14. [Not in this build](#not-in-this-build)

---

## How it works, end to end

| Step | Where | What happens |
|---|---|---|
| 1. Draft | **New RFx** (`/rfx/new`) | The buyer chats with the **Co-pilot agent**, which adds lines, terms, questionnaire and vendors, or imports them from an attached sheet, PDF or photo. A live preview on the right ticks off each section, and each section can also be edited by hand. |
| 2. Issue | Issue dialog | Issuing freezes the RFx as v1 and generates `{code}_Quote_Form.xlsx`, which has a *Line Items* tab and a *Questionnaire* tab with yellow input cells. Each vendor gets its own cover email and a reply tag. The buyer can preview every email before sending. |
| 3. Receive | Overview · Responses · Vendor portal | Replies come in through the mock inbox (*Sync inbox*, which also polls every 30 s), *Add response* (upload files or paste text) or *Load seeded responses*. |
| 4. Read | Response detail | Each reply runs through six stages: classify → extract → map → normalise → questionnaire → flags. Every stage can be re-run on its own. |
| 5. Review | **Review** tab | Everything the system isn't sure about becomes a card with its evidence and four buttons: Accept · Change · Ask vendor · Exclude. |
| 6. Compare | **Comparison** tab | Prices (unit / landed / as written), Questionnaire, Documents and the assumptions Ledger. Any cell opens its provenance drawer. |
| 7. Ask | **Ask** (every RFx tab) | The **Analyst agent** answers with computed tables, charts, what-ifs, scenarios, exports and drafts. |
| 8. Award | **Award** tab | The buyer builds award options, compares them and drafts the memo PDF. |
| 9. Approve | **Decide** tab (approver) | The approver reviews and then approves (which locks the RFx) or sends the memo back with a note. |

---

## The two AI agents

Both agents are built on **Google ADK** (`@google/adk`: `LlmAgent`, `FunctionTool`, `Runner`) and share one runner, [src/lib/ai/agent.ts](src/lib/ai/agent.ts). The runner applies the same rules to both agents:

- **Model.** Every agent turn uses the strong Gemini model.
- **Logging and retries.** Every model call is logged, and the runner retries once on 429, 5xx or a network error.
- **Tool checks.** A `check(tool)` hook runs before each tool call and can refuse it.
- **Reported changes.** The UI shows only the tool calls that actually succeeded, so the buyer sees what really changed, not what the model says it changed.
- **Streaming and limits.** Progress streams as NDJSON. Each agent has a step limit and a timeout, and falls back to a fixed message if it hits either.

### 1. Co-pilot: drafts the RFx (`/rfx/new`, buyer only)

Code: [src/lib/copilot.ts](src/lib/copilot.ts). The chat history is saved on the RFx. A hand edit is written into the transcript, so the co-pilot knows about it and never silently undoes it. The co-pilot's instructions are rebuilt on every turn from the current draft and the category template in *Settings → Masters*, which holds the naming, standard terms, line rules, question library and approved vendors.

| Tool | Does |
|---|---|
| `get_lines` | Reads every line, with its problems and gaps against the template rules |
| `read_attachment` | Reads an attached file (xlsx, csv, docx and txt through the preprocessors; PDF and images through the model) |
| `import_lines` | Parses an attached line sheet, replacing or appending lines. Refuses anything that isn't corrugated packaging. |
| `add_lines` · `update_lines` · `remove_lines` | Edit lines, with each field validated (ply, GSM layers, quantity) |
| `set_terms` · `apply_standard_terms` | Set scope, plants, deadline, currency, unit, Incoterm, freight, tax basis, payment, validity and contract length |
| `add_library_questions` · `add_questions` · `update_question` · `remove_questions` | Build the questionnaire, including disqualifying rules (`no`, `yes`, `lt:N`, `gt:N`, …) |
| `add_vendors` · `remove_vendors` | Pick vendors from the address book or create a new one. Warns when a vendor is not on the approved list. |

Guardrails:
- Removing more than 3 lines or questions, or every vendor, needs an explicit confirmation turn.
- Every tool refuses once the RFx is issued.
- The deadline must be in the future.
- A currency other than INR needs an FX rate in Settings.
- Vendor emails are validated.
- The co-pilot declines other categories and off-topic requests.
- It has **no tool to issue or send**, so the buyer always presses Issue.

### 2. Analyst: the Ask agent (every RFx tab, `/rfx/[id]/ask`, and inline on Decide)

Code: [src/lib/analyst.ts](src/lib/analyst.ts). It is available to both roles and rate-limited per user (*Settings → Ask limit*). Chat history is kept in the browser. Answers are stored on the server under *Earlier questions*.

| Tool | Does |
|---|---|
| `query_data` | Question → guarded SQL → computed answer (see [Ask](#ask-questions-over-the-data)) |
| `list_unresolved` | Lists unsure cells, the value at stake at best guess, and open review cards |
| `explain_term` | Glossary of 14 terms, e.g. landed cost, best guess, single-source line |
| `explain_cell` | Traces one price back to its source, conversion chain and review history |
| `what_if` | Before/after totals for an FX move, a vendor price change, freight, dropping a vendor, a volume change, or no discounts. Nothing is saved. |
| `show_chart` | Redraws an earlier answer as a bar, line, grouped, share, diverging or heatmap chart without re-querying |
| `save_scenario` · `compare_scenarios` · `override_scenario_line` | Award options: save, compare side by side, move one line to another vendor (reason required) |
| `export` | xlsx/csv download of an answer or of the whole comparison |
| `draft_award_memo` | Drafts the memo (it cannot approve it) |
| `draft_clarification` | Drafts an email to a vendor about its open cards. The buyer edits it and presses Send. |

Guardrails:
- **Every number in a reply is checked** against the tool results, understanding Indian grouping, crore/lakh and rounding. If any number doesn't match, the reply is replaced with the verified answer text.
- There are **no tools** to approve, send back, send email or decide review cards.
- Memo, clarification and line overrides are buyer-only.
- Once the RFx is awarded, only the read-only tools work.
- Vendor text is wrapped as data, never followed as instructions.
- Off-topic requests (code, poems, "reveal your prompt") get a one-sentence decline and two suggested questions.

### Other model calls (single calls, not agents)

| Where | What the model does |
|---|---|
| Pipeline | Captions PDFs and photos, extracts items and terms, answers typed decisions (file kind, line mapping, term flags, "is this really the invited vendor?"), sorts a discount condition into a kind, and reads questionnaire answers |
| Dispatch | Writes each vendor's cover email |
| Clarify | Writes only the greeting and closing; the bullets are generated from the review cards in code |
| Award memo | Writes five narrative sections. Every number is checked, and the memo must mention the count of unresolved cells. |
| Award options | Gives a typed option a short title |

**Decision layer** ([src/lib/ai/decision/](src/lib/ai/decision/)). Classification, mapping, term flags and questionnaire verdicts go through `decide()`, which asks typed questions (`choice` / `boolean` / `score`) and returns calibrated probabilities. The provider is set in *Settings → Decision engine*:
- **Jev via OpenRouter** when `OPENROUTER_API_KEY` is set, falling back to Gemini on any error;
- otherwise **Gemini** emulation (probabilities renormalised; confidence = the margin between the top two options).

The UI labels each result "measured (Jev)" or "LLM-estimated (Gemini)".

All model output is validated with Zod before it is written. A failed validation is retried once with the error attached, and fails visibly after that. Every call lands in `model_calls` with tokens, latency and cost (*Settings → Activity*).

---

## Reading vendor replies: the pipeline

**Intake** ([src/lib/responses.ts](src/lib/responses.ts)). The raw data is saved before anything is processed: the communication, the reply, each file in the `raw` bucket (with a sha256), then a preprocessed copy in `derived`. A file that can't be read is kept and marked, never dropped.

| Format | Preprocessing ([src/lib/preprocess/](src/lib/preprocess/)) |
|---|---|
| `.xlsx` `.xls` `.csv` | Every sheet as `[row N] A1=…`, with cell refs, hidden rows marked and comments appended |
| `.docx` | Paragraphs `[p N]` and table rows `[table t row r]` |
| `.pdf` | Sent to the model directly; split into chunks when longer than 20 pages |
| `.jpg` `.png` `.webp` `.heic` | EXIF auto-rotate, downscale to 2000 px, normalise |
| `.txt` `.eml` | Quoted replies, "On … wrote:" tails, signatures and forwarded headers stripped; lines numbered |

**Stages** ([src/lib/pipeline/](src/lib/pipeline/)). Each stage is one HTTP request that reads its inputs from the database and writes its outputs back. Every stage is idempotent, and *Run all* streams progress as NDJSON.

1. **classify.** Each file is labelled quotation, questionnaire, supporting or not relevant, and marked as containing prices or not. When the top probability is below 0.5, the file is `unknown`, which raises a *not a quote* card.
2. **extract.** The strong model extracts every item exactly as written (price, unit, pack, discount, location, confidence), plus terms, conditions (MOQ, tooling, spec, delivery) and the stated total. If the model returns far fewer items than there are priced rows, extraction retries once. Long sheets are chunked.
3. **map.** A shortlist is scored in code: size ±5%, ply, item type, word overlap, our SKU, an "item N" reference. The top 5 go to `decide()`, which also handles ranges like "items 1 to 12". The *act* and *review* thresholds decide whether an item is mapped, mapped with a card, or left unmatched. If two items land on the same line, the stronger one wins and the other gets a conflict card.
4. **normalise.** Every price is converted to **₹ per 1000 pcs**. The steps run in this order:
   1. apply the line discount;
   2. gross the price up if it is printed net of a discount whose condition the buyer won't meet;
   3. convert the unit: box, bundle, kg or tonne, using the pack size only when that number really appears in the vendor's text, otherwise the RFx weight or spec;
   4. convert the currency with the FX rate from Settings;
   5. apply any GST adjustment;
   6. add freight for the landed cost.

   Each cell gets a state: `confirmed`, `inferred`, `low_confidence`, `ambiguous` (a best guess is shown but not counted), `not_quoted`, `references_prior` or `conflict`. Every basis the vendor did not state goes into the **assumptions ledger**. A decision the buyer has already made is never overwritten.
5. **questionnaire.** Answers are read from the questionnaire, the quote and the email, then judged by `decide()`. A yes/no between 0.4 and 0.6 becomes *ambiguous*. `disqualify_if` rules decide pass or fail, and a missing mandatory answer raises a card.
6. **flags.** Vendor flags: prior pricing, freight excluded, short validity, not INR, total discount, partial quote, tax basis differs. This stage also updates vendor and RFx status and runs two checks:
   - **Vendor check:** is this really the invited vendor? It compares the same file arriving from two vendors, the issuer on the document and who the document is addressed to. A suspect reply's prices are held out of every total until the buyer decides.
   - **Price check:** a price more than 2× the median of the other vendors (or below half of it), or a ₹/kg outside the template band, raises a "Check unit" card.

**Unknown senders.** A reply with no vendor is still classified, extracted and mapped, but pricing waits for the buyer. The buyer assigns it to an existing vendor or a new one, and the pipeline carries on.

**Clarification replies** change only the lines that were asked about. They supersede the old ledger rows and close their cards as *resolved by reply*.

---

## Review queue

The Review tab (`/rfx/[id]/review`) groups cards under *Replies to sort · Prices to check · Not quoted · Line matching · Numbers we filled in · Vendor conditions · Questionnaire*. Each card shows its source evidence, says what happens if the buyer leaves it, and offers **Accept · Change · Ask vendor · Exclude**.

- **Card types:** ambiguous unit, low-confidence read, price check, conflict, total mismatch, prior pricing, missing line, unmapped item, freight, FX assumption, discount treatment, tax basis, short validity, vendor condition, questionnaire ambiguous or missing, vendor mismatch, unknown vendor, not a quote.
- **Actions** (17): confirm, override, exclude, map, ignore, ask-vendor, mark-not-quoted, dismiss, accept-yes, treat-no, enter-prices, set-freight, set-fx, set-gst, set-discount, answer, reassign.
  - Overrides, exclusions and every `set-*` action need a reason and write a ledger row.
  - `set-fx`, `set-gst` and `set-discount` rescale all of that vendor's cells.
  - `map` re-runs normalise.
  - Excluding a mismatched reply withdraws all of its prices and answers.
- **Ask vendor:** one drafted email per vendor covers all of its open askable cards. The buyer can untick items before sending, and the vendor's reply flows back through the pipeline.
- Filters: Open / Waiting on vendor / Decided, grouped by vendor or by type.

---

## Comparison and provenance

`/rfx/[id]/comparison` has four tabs:

- **Prices.** A 30-line × vendor grid with a sticky first column. Vendor headers show the annual total, coverage, questionnaire status and condition chips (validity, discount, freight, GST, payment, currency, MOQ, tooling, etc.; amber where they differ from what the RFx asked). Cells are coloured by state, and the lowest eligible price has a teal edge. The basis can be switched between Unit, Landed and As written. There is a legend with counts, xlsx/CSV export, and an *Unmatched items* panel below the grid.
- **Questionnaire.** Questions × vendors. ◆ marks disqualifying questions. Any answer opens its evidence.
- **Documents.** Every file with its classified kind, page count and what it was used for.
- **Ledger.** Every assumption in plain words, with a reliability grade.

**Provenance drawer.** Clicking any price shows:
- the source: spreadsheet row, PDF page, photo crop, paragraph or email line, with the phrase marked;
- the price as written;
- the mapping alternatives with probabilities and the provider label;
- the full conversion chain linked to the ledger;
- the review history.

---

## Ask: questions over the data

The **Ask** button opens the analyst on every RFx tab. The pipeline behind `query_data` is in [src/lib/query/](src/lib/query/):

1. **Plan.** The model writes one `SELECT` plus an eligibility rule, a chart hint and an answer template.
2. **Guard** ([sql-guard.ts](src/lib/query/sql-guard.ts)). The query must meet all of these:
   - `SELECT`/`WITH` only, at most 4000 characters;
   - no `;`, comments, DML, `pg_` or `information_schema`;
   - every view must be scoped to `rfx_id = '<this RFx>'`;
   - base tables are rejected;
   - only 10 whitelisted views and known columns and functions are allowed.

   If the guard or Postgres rejects the query, there is one repair round.
3. **Run.** The query runs through the read-only RPC `run_readonly_rows`, capped at 5000 rows. Totals are computed in code.
4. **Narrate.** The fast model writes 2–5 sentences in the question's language, and the narration is checked against the numbers.
5. **Show.** The answer card shows:
   - the sortable table, with rows that open the provenance drawer;
   - the chart;
   - the **SQL**;
   - **what was excluded and why**: disqualified vendors, and unsure cells with the value at stake;
   - vendor discounts that were not applied;
   - follow-up suggestions.

   Where unsure cells are in scope, **Include best guesses** re-runs the question with best guesses counted and shows both totals. Allocation answers can be saved as award options. Answers export to xlsx or CSV.

Suggested questions are generated from the data, for example the FX what-if, failed questionnaires, freight, discounts and single-source lines.

---

## Award options, memo and approval

**Award options** ([src/lib/scenarios/](src/lib/scenarios/)):
- **Ways to create one:** describe the split in words (*"5-ply to the cheapest qualified vendor, 3-ply to the cheapest overall"*), save one from an Ask answer, or build one by rule. The rules are:
  - cheapest per line;
  - **weighted**: price vs questionnaire score, default 70/30;
  - **grouped**: by ply, item type or plant, each group with its own sub-rule.

  Any rule can be limited to qualified vendors, use unit or landed cost, and count best guesses or not.
- **What each option shows:**
  - the total after vendor discounts whose conditions the split actually meets;
  - the comparison with the best single vendor;
  - the cost of the questionnaire rule;
  - who gets what and why;
  - single-source lines;
  - quotes expiring within 14 days.
- **Manual changes:** any line can go to another vendor (reason required), and the change can be undone.
- **Out of date:** when prices change, the option is marked outdated and shows which lines changed. *Refresh* recomputes it and keeps overrides that are still valid.
- **Compare:** two options side by side, showing only the lines that differ.

**Memo** ([src/lib/award/](src/lib/award/)). The memo is an A4 PDF with these sections: Recommendation · Basis of award · Allocation · Totals & baseline · Exclusions · Validity · Assumptions ledger · Open items (unresolved cells with best guess and value at stake, plus manual overrides) · Next steps · Signatures. Every draft is a new version, and the history shows what changed between versions.

**Decide** (the approver's home tab):
- A status card: nothing yet, waiting for you, out of date, sent back, or approved.
- **Before you approve:** held vendors, and the unsure cells the totals leave out.
- Three stats: cheapest qualified per line, against the best single vendor, and coverage.
- The analyst inline.

**Approve** re-signs the PDF and sets the RFx to *awarded*, which **locks** it: the grid, review, scenarios and memo become read-only, and the analyst keeps only its read-only tools. **Send back** requires a note, and the buyer sees that note next to what changed. A memo whose option changed can't be approved until it is drafted again.

---

## Email, outbox and vendor portal (mock)

Only **mock** email is enabled in this build, and nothing leaves the system:
- **Sending.** `sendEmail` builds a real RFC 822 `.eml` with nodemailer (with a Message-ID and a tagged Reply-To `sourcing+rfx-<code>-<vendor>@…`), stores it and writes a mock mailbox row.
- **Outbox** (`/rfx/[id]/outbox`) lists every email sent.
- **Vendor portal** (`/rfx/[id]/portal/[vendorId]`). The buyer plays the vendor: the vendor's inbox, and a reply form that builds a threaded `.eml` with attachments.
- **Sync inbox.** Collects the replies, matching the reply tag from To, then Subject, then the thread. Sync is idempotent on Message-ID and runs the pipeline on what it collects.
- **Audit trail → Emails** shows every message with its attachments and threading.

---

## Roles

| | Buyer (Sujit) | Approver (Priya) |
|---|---|---|
| Home tabs | Overview · Responses · Review · Comparison · Award · Audit trail | Decide · Comparison · Award |
| New RFx / co-pilot, pipeline, review actions, email, settings | ✓ | — |
| Ask analyst | ✓ all tools | ✓ (no memo, clarification or line overrides; options only from answers) |
| Award options | ✓ any | Own options only |
| Draft memo | ✓ | — |
| Approve / send back | — | ✓ |
| Audit log | ✓ | ✓ |

Sessions use an iron-session cookie (7 days), and passwords are hashed with scrypt. The `admin` role is treated exactly like `buyer`.

---

## Settings, evaluation and logs

- **Settings → General** (buyer):
  - Communication: email transport.
  - Decision engine: Auto / Gemini only / Jev only; act and review thresholds; the price-check ratio; the Ask rate limit.
  - Currency: FX rates with date and source.

  Every change is audited with its before and after values.
- **Settings → Masters** has four tabs:
  - Naming & terms
  - Line fields and allowed ply
  - Question library
  - Vendor directory, with a per-category *Approved* tick
- **Settings → Evaluation.** Scores a seeded RFx against the hand-built answer key in `supabase/seed/gold/`. Each cell is correct / flagged OK / wrong / missing, and questionnaire answers are scored too. The tab also has run history with the change between runs, and the seed dataset with downloads.
- **Settings → Activity:**
  - **Model calls:** purpose, provider, model, tokens, latency, cost, RFx.
  - **Audit log:** filterable by RFx and user.

---

## Trust and safety built into the code

- **No faking.** Nothing is cached by file content, no seed file is special-cased, and no demo answer is hardcoded. Every AI step runs live.
- **Uncertainty is visible.** Cell states, the review queue, best guesses that are shown but never counted silently, and "value at stake" on every total that leaves cells out.
- **Numbers are computed, not narrated.** Ask answers come from SQL that is shown with the answer. Agent replies and the memo are checked number by number against the data.
- **Read-only query path.** The SQL guard, the views scoped to the RFx and the read-only RPC keep Ask away from the base tables.
- **Prompt-injection defence.** Vendor content is wrapped as `<vendor_data>`, and the tests include injected instructions inside a vendor file.
- **Agents can't take irreversible steps.** No issue, send, approve or review-decision tools. Bulk removals need confirmation.
- **Audit everywhere.** Pipeline stages, review decisions, co-pilot edits, settings, scenarios and award actions are all audited, and the audit trail is append-only.
- **Secrets are server-only.** Every module that touches a key has `import "server-only"`, the database uses the service-role client on the server, and RLS locks out the anon key.

---

## Stack, setup and scripts

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui (restyled to [design/DESIGN.md](design/DESIGN.md), light and dark themes) · Supabase Postgres + Storage · Gemini (`@google/genai`) · Google ADK · Zod · exceljs · mammoth · sharp · nodemailer · mailparser · @react-pdf/renderer · Recharts · iron-session · Vitest · Vercel.

```bash
npm install
cp .env.example .env.local   # Supabase URL + service key, DATABASE_URL, GEMINI_API_KEY,
                             # GEMINI_MODEL_FAST / _STRONG, SESSION_SECRET, SEED_ADMIN_PASSWORD
npm run db:migrate           # apply supabase/migrations in order
npm run seed                 # users, vendors, RFx MER-0417/0418/0419, settings, dataset → storage
npm run seed:template        # "Corrugated packaging" category template
npm run dev                  # http://localhost:3000
```

| Script | Does |
|---|---|
| `npm test` | Vitest unit tests (preprocessors, units/FX/price, SQL guard, allocation, tags, formatting, …) |
| `npm run pipeline:seed` | Loads seed replies (`--set clean` → MER-0419, `--set realistic` → MER-0417), runs every stage, prints the eval |
| `npm run eval` | Re-scores MER-0419 against the answer key |
| `npm run check:models` | Lists Gemini models for your key and tests JSON, PDF and photo input |
| `npm run db:check` | Checks the database, buckets and the read-only query function |
| `npm run test:conversations` | Co-pilot and analyst conversations against the real model, checked in the database |
| `npm run test:guards` | Prompt injection, odd inputs, the "Check unit" card |
| `scripts/test-*.ts` | Live checks: every card × every button, review actions, the seed picker, the vendor check |
| `scripts/reprocess.ts` · `scripts/redraft-dispatch.ts` | Re-run replies from extract on (buyer decisions kept) · rewrite mock cover emails |

**Demo data.** MER-0417 is awarded (realistic, messy replies), MER-0418 is a draft for a live run, and MER-0419 is issued; press *Load seeded responses* to run the pipeline live. Five vendors reply as `.xlsx`, PDF, `.docx` prose, a photo of a printed rate card and a plain email. Between them the replies include a partial quote, USD FOB prices, "per bundle" with no bundle size, ₹/kg rates, "rest same as last year" and a conditional discount.

---

## Repo map

```
src/app/(app)/        signed-in pages: rfx list, new, [id]/{overview,responses,review,comparison,
                      ask,decide,award,audit,outbox,portal}, settings/{masters,eval,activity}
src/app/(public)/     help, privacy, terms
src/app/api/          thin route handlers (parse → lib → respond)
src/lib/ai/           Gemini client, ADK agent runner, decision layer (Gemini / Jev), vendor-data wrapper
src/lib/copilot.ts    Co-pilot agent        src/lib/analyst.ts   Analyst agent
src/lib/preprocess/   xlsx · docx · pdf · image · email
src/lib/pipeline/     classify · extract · map · normalise · questionnaire · flags · vendor check
src/lib/normalise/    units, FX, price, totals
src/lib/query/        P-SQL planner, SQL guard, charts, suggestions
src/lib/scenarios/    allocation engine, what-if, options
src/lib/award/        memo builder, PDF, versions
src/lib/email/        mock transport, tags, mailbox, sync (gmail stubbed)
src/lib/eval/         answer-key scoring
supabase/migrations/  schema, views, RPCs (0001–0019)
supabase/seed/        dataset pack (clean + realistic) and gold answer key
design/               DESIGN.md spec + prototype.html
docs/                 PRD, FSD/TRD, dataset pack notes, build handoffs
prompts/archive/      earlier prompt versions (live prompts are inline in src/lib)
```

Build history is in [PROGRESS.md](PROGRESS.md). Every departure from the spec and the reason for it is in [DECISIONS.md](DECISIONS.md).

---

## Not in this build

- **Gmail and Resend.** `src/lib/email/gmail.ts` is a stub, and Settings accepts only `mock`.
- **User management.** The two users are seeded, and `admin` has no extra rights.
- **Attachments inside a dropped `.eml`** are not unpacked. HTML files are stored as unsupported.
- **Cost of money in landed cost.** Landed cost is unit price + freight only.
- **One category.** Everything is set up for corrugated packaging.
