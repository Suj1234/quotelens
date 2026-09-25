You are continuing the QuoteLens build. Phases 0–6 are done, committed and deployed. Your job is **Phase 7** (CLAUDE.md §3: P7-T1 and P7-T2) — scenarios, the award memo and approval — finished to its checkpoint. Stop after the Phase 7 checkpoint and report.

The human (Sujeet) is not an engineer and will not be available during the run. Explain what you do in plain language as you go.

---

## 0. Two things to settle before you build (read, don't skip)

**A. The approver's Decide page (DESIGN §3.8).** This has been an open question since P5. It isn't in any CLAUDE.md task, but DESIGN makes it the approver's default tab. It shows:
- the headline total;
- the saving against the best single vendor;
- the Ask box with the Cost / Risk / Vendors suggestion groups;
- the answer cards.

Most of what it shows already exists (Ask, the Q1 total, the Q2 baseline).
- **If PROGRESS.md "Open questions" has Sujeet's answer, follow it.**
- **If not:** build it in P7 as the last task before the checkpoint (P7-T3 below), and record in DECISIONS that you chose to. It is small, and without it the approver's journey (open the RFx → decide → approve) has no landing page.

**B. Where scenarios live.**
- TRD §17.11 describes a **Scenarios** screen: cards, a compare table, a stacked bar, a "New scenario" dialog, per-line overrides.
- DESIGN §3.9 puts a **scenario table on the Award tab**, and DESIGN has no Scenarios tab.

DESIGN is the visual spec, and TRD wins on behaviour. So:
- build the comparison and the rule builder as a section of the **Award** tab (buyer and approver);
- keep TRD's content (compare table, share per vendor, stacked bar, overrides);
- record the placement in DECISIONS.

Don't add a sixth buyer tab.

---

## 1. Why this prompt is strict (read first)

Phases 3–6 taught these lessons. Keep them:
- "Done" is a ticked checklist with evidence, never a feeling.
- Every button gets tried in the real UI, as both users, including errors and repeat runs.
- **Bookkeeping bugs are real bugs.** In P6 the checklist-ticking helper twice wiped the requirement column of rows, because a row's leading `  | ` also matched the split. Number this phase's rows `7.1`, `7.2`, … and tick them with a helper that:
  - cuts the row by its fixed prefix `  | 7.x | `;
  - asserts the requirement text is unchanged after the write.

  Check the whole table at the end.
- **Test on a copy when an action can't be undone.** Approve locks an RFx. Never approve MER-0417, MER-0418 or MER-0419 (§3 says how to test).
- **The network on this machine drops.** P6 lost hours to hung calls. Gemini now times out at 120 s (one retry) and Supabase at 60 s.
  - If a stage fails with a timeout or `fetch failed`, re-run that stage. Don't assume a code bug.
  - If `npm run pipeline:seed` dies half-way, run it again (it is idempotent).
  - Wait for long jobs with `run_in_background` + an `until` loop, never chained sleeps.

---

## 2. Read first, in this order

1. **CLAUDE.md** (whole file; the §0 rules are mandatory; §5 cut list items 1 and 7 concern this phase), then **PROGRESS.md** and **DECISIONS.md**. Read every P4 entry (the Ask route, Save-as-scenario "lands with P7-T1", the Q1/Q2/Q5 answers) and every P6 entry.
2. **TRD** (`docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md`):
   - §6.3 `rfx` (status `awarded`), §6.12 `line_quotes`, §6.14 `assumptions`;
   - **§6.18 `scenarios` / `scenario_lines`**, **§6.20 `awards`**;
   - §6.21 views;
   - **§9.10 P-MEMO**;
   - §13.2 best guesses, **§13.5 Scenario save**;
   - **§14.1–14.3** (allocation rules, comparison, memo);
   - §16 routes `/api/scenarios*`, `/api/award/*`, `/api/export/memo/{award_id}`;
   - **§17.11 Scenarios, §17.12 Award**;
   - §22 item 7.
3. **PRD**:
   - §8 **Stage 8** (items 29–33) and Stage 9 (item 34: scenario saved, memo generated, approval in the Timeline);
   - §10 trust features (the memo);
   - §13 (Q1, Q2, Q5 "save as scenario");
   - §4 G1/G6.
4. **DESIGN.md**:
   - §2.3 (tabs: buyer … Comparison · **Award**; approver **Decide** · Comparison · **Award**);
   - §2.4 button labels (Generate memo, Approve, Send back, Save as scenario);
   - §2.13 answer card (Save as scenario);
   - §2.14 Ask box;
   - §2.15 bar chart;
   - §2.16 **memo** styling;
   - **§3.8 Decide**, **§3.9 Award**;
   - §4 roles (who can save scenarios, generate, approve);
   - §5 copy ("Approved — RFx locked").

   Check `design/prototype.html`:
   - `Award()`, `Decide()`;
   - the `scenarios`, `award`, `approved` state;
   - the lock note "Awarded — read-only. Memo approved by Priya Raghavan.";
   - the memo markup (the memo `h1`, sections, signature grid).

   To render a prototype state, open it with the browse skill and set state from JS, e.g. `S.user='sujit'; S.route='rfx/MER-0419/award'; S.scenarios=[…]; render()`.
5. **AGENTS.md** (Next.js 16: read `node_modules/next/dist/docs/` before Next-specific code; run `npx next typegen` after adding routes). If `next typegen` hangs while the dev server runs, stop the dev server first.

Then run `git log --oneline -15`, `npm test` (67 tests, must be green) and `npm run eval` (must say 150/150, questionnaire 50/50).

---

## 3. What already exists (reuse it, don't rebuild it)

- **Comparison data:**
  - `src/lib/comparison.ts` `getComparison()`: the grid model — cells with state/unit/landed/best guess, vendor headers with `cleared`, `priced`, totals. Its "lowest eligible" rule = confirmed/inferred/reviewed cells of questionnaire-cleared vendors. This is the same rule as Ask Q1 and the Overview lead total. **The allocation engine must give the same Q1 total** (₹4,53,38,297 on MER-0419 today).
  - Views `v_comparison`, `v_comparison_bestguess`, `v_vendor_status`, `v_assumptions` (migrations 0002/0006/0007).
- **Ask:**
  - `src/lib/query/ask.ts` (P-SQL → guard → `run_readonly_rows` → aggregates → P-NARRATE, `queries` rows with `sql`, `rows`, column order);
  - `src/components/ask/*` answer cards. There is **no Save as scenario button yet**, on purpose (DECISIONS P4-T3 b).
  - The narrator's **number check** (every number in the text must match a supplied value): reuse it for P-MEMO.
- **Ledger and review:** `src/lib/rfx-tabs.ts` `getLedger()` (active assumptions, folded rows, clarification wording), `getTimeline()` (add rows for `scenario.saved`, `award.memo`, `award.approved`, `award.sent_back`).
- **PDF:** `@react-pdf/renderer` is installed; `src/lib/dispatch-docs.tsx` builds the questionnaire PDF with standard Helvetica. **Helvetica has no ₹ glyph.** The memo needs ₹, so register a font that has it (e.g. a TTF of Noto Sans or IBM Plex Sans, bundled or from `@fontsource`) and **check the glyph really renders** (extract the PDF text, or screenshot the embedded PDF). Record the font choice.
- **Exports:** `src/lib/export.ts` (XLSX with state fills, Indian grouping `#,##,##0`), `GET /api/export/*`.
- **Auth and roles:**
  - `requireUser(["buyer","admin"])` / `requireApiUser([...])`;
  - the approver's tabs are built in `src/app/(app)/rfx/[id]/layout.tsx` (today: Comparison only);
  - `/rfx/{id}` sends the approver to Comparison (`src/app/(app)/rfx/[id]/page.tsx` or the layout).
- **Mutating endpoints that the lock must stop** (find them all with `grep -rn "export const POST\|export const PATCH" src/app/api`):
  - review actions + bulk;
  - clarify / clarify-send;
  - email sync, vendor-reply;
  - `POST /api/responses`, seed-responses, run-all, stage, assign-vendor;
  - PATCH/copilot/issue (already draft-only);
  - scenario overrides.
- **Data:**
  - **MER-0419** is seeded with the clean set: 150/150, 14 open review items. Use it for scenarios (saving scenarios doesn't lock anything), then delete the scenarios, awards and queries you made, so it ends exactly as seeded.
  - **MER-0417** (realistic, 150/150): don't touch it. CLAUDE.md P8-T2 awards it later, through the UI.
  - **MER-0418** is an untouched draft: keep it that way.
  - **For generate → approve → lock, use a throwaway RFx:**
    1. create a draft by API from MER-0418's data (P6 did this with a small `scripts/_mk.ts`: POST `/api/rfx` + PATCH lines/terms/questions/vendors);
    2. issue it in the UI;
    3. click **Load seeded responses (clean set)** on its Overview, which gives the same 150 cells as MER-0419.

    Delete it with a script at the end (P6's `_cleanup.ts` pattern: rows + storage under `rfx/{id}/` in raw/derived/outbound + mailbox rows).
- **Environment:**
  - scripts run as `tsx --env-file-if-exists=.env.local --conditions=react-server scripts/x.ts`; throwaway scripts are `scripts/_*.ts` (git-ignored via `.git/info/exclude`), deleted at the end;
  - `git push origin main` deploys to https://quotelens-seven.vercel.app;
  - sign in with `POST /api/auth/login` using `SEED_ADMIN_PASSWORD` from `.env.local` (never echo it). Users: `sujit.menon@meridianfoods.example` (buyer), `priya.raghavan@meridianfoods.example` (approver);
  - new migrations start at `0010_*.sql`; never edit 0001–0009; apply with `npm run db:migrate`;
  - known local quirk: after adding route folders the dev server can 404 every `/rfx/[id]/…` page until you delete `.next` and restart `npm run dev`. Don't run `npm run build` while `npm run dev` is running (they share `.next`).

---

## 4. How to work (mandatory)

1. **Before any code, write the Phase 7 checklist into PROGRESS.md** (table `# | requirement (source) | status / evidence`, rows `7.1…`). Start from §5 below and add anything else you find in the §2 reading.
2. **Tick only with evidence:** a unit test, a script output, an API response, or a browser check with the gstack `/browse` skill (never the claude-in-chrome tools).
3. **Test every button you build in the real UI:** as Sujit and as Priya, the empty state, the error state, a repeat run (generate the memo twice; model output varies).
4. **Where specs disagree, choose** (TRD wins on design and behaviour, DESIGN is the visual spec, CLAUDE.md wins on order and scope) and **record it in DECISIONS.md in the same commit**. DECISIONS.md is append-only.
5. **One commit per task** (`P7-T1: …`), each with the PROGRESS.md update (status, what works, what doesn't, next step).
6. **Prompt tuning** follows CLAUDE.md §9: one change at a time, the previous version in `prompts/archive/`, at most 20 minutes per round.
7. **Before reporting done:** tests, lint and `npm run build` green; `npm run pipeline:seed` gives 150/150; push; check production; the checklist is fully ticked, or each open item is listed with its reason.
8. **Product decisions** not covered by the specs go under "Open questions" in PROGRESS.md; pick the easiest-to-reverse option and keep going.
9. **Never:**
   - print env values;
   - special-case seed files or vendors;
   - hardcode an answer or a total;
   - let the model write a number into the memo that the data didn't supply;
   - edit migrations 0001–0009;
   - approve MER-0417/0418/0419.

---

## 5. Phase 7 requirement checklist

### P7-T1 Scenarios (TRD §6.18, §13.5, §14.1–14.2, §17.11; PRD Stage 8 items 29–31; CLAUDE P7-T1)
- [ ] 7.1 `src/lib/scenarios/allocate.ts`: **deterministic, no model.** It builds scenario lines from the comparison. Rules:
  - `cheapest_per_line` { `qualified_only`, `price_basis` unit | landed };
  - `grouped` [{ filter { ply | item_type | delivery_location | line_nos }, rule }], where lines no group covers → **unallocated and flagged**;
  - `weighted` { price, questionnaire }: score = w_price × (min price on line ÷ vendor price) + w_q × (share of mandatory questions with `passes = true`).

  Eligible cells: confirmed / inferred / reviewed with a price. Best guesses (ambiguous / low_confidence) only with `include_best_guess`.

  Per line, record: winner, price, annual value (price × annual_qty ÷ 1000), runner-up vendor + price (the best eligible non-winner), gap %, reason ("cheapest qualified", "5-ply group: cheapest qualified", "weighted 0.7/0.3: score 0.94").

  Unit tests on a small fixture:
  - ties (lower vendor name wins, and say so);
  - a line nobody qualified for → unallocated;
  - grouped coverage gaps;
  - a weighted example worked by hand.
- [ ] 7.2 **Totals and baseline** (TRD §13.5):
  - total, vendors used, share per vendor, single-source lines (only one eligible quote), unallocated lines;
  - **baseline** = the cheapest single vendor among vendors who priced **every** line (if none did: over the lines each priced, with a note), with `savings_vs_baseline`.

  **Consistency check:**
  - `cheapest_per_line` qualified/unit on MER-0419 = Ask Q1 = ₹4,53,38,297;
  - the baseline = Q2's Sri Balaji ₹4,58,35,488 (saving ₹4,97,191, 1.08 %).

  If DESIGN §3.8's example ("Kohinoor … with the three partition lines filled from the next cheapest") disagrees with TRD's rule, TRD wins. Record it; the Decide page must show the same number as Q2.
- [ ] 7.3 **Migration 0010** only for what the schema lacks:
  - e.g. `scenarios.rule.include_best_guess`, `scenarios.query_id` (or keep it in `rule`);
  - `awards.status` needs a way to record **Send back** (DESIGN §3.9; TRD has only draft / approved) — add `sent_back` plus `sent_back_note`, or keep draft + a note (choose, record);
  - `rfx.awarded_scenario_id` if you need it.

  RLS on and no anon/authenticated grants, as in 0001/0009.
- [ ] 7.4 `POST /api/scenarios` `{rfx_id, name, rule}` or `{rfx_id, name, query_id}` → scenario + lines + totals.
  - **From a query** (TRD §13.5): allowed only when the answer's rows have `line_no` and `vendor` and one row per line. Copy the winners; runner-up, gap and totals are computed from `v_comparison` (not trusted from the query); `rule_text` = the question; keep the SQL for the memo.
  - `GET /api/scenarios?rfx=` → list with totals. `DELETE` for the buyer (and the cleanup).
  - **Both roles may save scenarios** (DESIGN §4). Only the buyer overrides lines and generates the memo.
- [ ] 7.5 **Save as scenario** on Ask answer cards (DESIGN §2.13; TRD §17.9). Shown only when the rows qualify (7.4); otherwise absent, no dead button. Name prompt defaulting to the question; toast "Saved — Q1 cheapest qualified per line"; available to Sujit and Priya.
- [ ] 7.6 **Per-line override** inside a scenario: `POST /api/scenarios/{id}/override` `{rfx_line_id, vendor_id, reason}`.
  - Buyer only. The reason is required; the vendor must have an eligible price on that line (or say why not).
  - Recomputes totals, sets `is_override` and the reason, adds an audit event and a ledger-style note in the memo's open items.
  - Reverting an override is possible.
- [ ] 7.7 **Scenario comparison on the Award tab** (§0 B; TRD §14.2; DESIGN §3.9 scenario table):
  - per scenario: Scenario (600, green "selected" chip) · Rule · Annual total · Vendors · Lines allocated · Single-source · vs first (and vs baseline);
  - share per vendor as an inline stacked bar (DESIGN §2.15 style, no chart library);
  - open a scenario to see its 30 lines (winner, price, runner-up, gap, reason, override badge) and override a line.
- [ ] 7.8 **New scenario** (TRD §17.11) as a compact rule builder on the Award tab, buyer only:
  - rule type (cheapest per line / by group / weighted);
  - qualified only; price basis (unit / landed); include best guesses;
  - groups by ply / item type / plant;
  - a price-vs-questionnaire slider for weighted.

  CLAUDE cut list item 1 allows dropping `weighted`; build it unless P7 is running late, and say which.
- [ ] 7.9 **Done-when (CLAUDE P7-T1):** on MER-0419, ask Q1 and Q5 in the Ask sheet → Save as scenario on both → they compare side by side.
  - Q1 = ₹4,53,38,297.
  - Q5 = ₹4,20,18,677, "better by ₹33,19,620 (7.32 %)" — P4's numbers; if the data moved, explain why.
  - Also build the same two with the rule builder (cheapest qualified; grouped 5-ply qualified + 3-ply overall) and show the totals match the query-saved ones.

### P7-T2 Award memo and approval (TRD §6.20, §9.10, §14.3, §17.12; PRD Stage 8 items 31–33; DESIGN §2.16, §3.9; CLAUDE P7-T2)
- [ ] 7.10 `src/lib/award/memo.tsx` (react-pdf) with the six TRD §14.3 parts, every number from the database:
  1. header (RFx code, title, category, dates, prepared/approved) + Recommendation + Basis of award;
  2. allocation table (line, description, annual qty, vendor, price/1000, annual value, runner-up, gap %, reason);
  3. totals and baseline; exclusions (vendor + reason, e.g. "Westline — Q6 BRC: No"); single-source lines; validity per vendor;
  4. **the assumptions ledger** (kind, vendor, lines, description, basis, made by) — the same rows as the Ledger tab;
  5. open items: unresolved cells with value at stake (best guess × annual qty ÷ 1000) and manual overrides with reasons;
  6. the rule in plain words + **the SQL if the scenario came from a query** + signatures ("Prepared — Sujit Menon, Category Buyer" / "Approved — Priya Raghavan, VP Procurement" or a blank line).

  DESIGN §2.16 look: memo width, 19 px title, uppercase section headings, `table.t`, signature grid. Indian grouping (₹4,53,38,297), ₹ renders (§3 font note).
- [ ] 7.11 **P-MEMO** (TRD §9.10 verbatim, strong model, Zod: five string fields). Inputs are the numbers only, pre-formatted.
  - **Number check** as in P4's narrator: every number in the narrative must be one supplied, one retry with the offenders listed, leftovers recorded (never shipped silently).
  - The narrative must mention unresolved cells when there are any.
- [ ] 7.12 `POST /api/award/{rfx}/generate` `{scenario_id}` (buyer/admin; approver 403):
  - builds `memo_json` (everything rendered), renders the PDF to `outbound` (`rfx/{id}/outbound/award/…pdf`), saves an `awards` row as draft;
  - a new generate replaces the previous draft (never an approved one);
  - audit `award.memo`.

  `GET /api/export/memo/{award_id}` streams the PDF (both roles).
- [ ] 7.13 `POST /api/award/{rfx}/approve` (**approver only**; buyer 403):
  - award → approved (`approved_by`, `approved_at`), `rfx.status = 'awarded'`, audit `award.approved`;
  - the PDF is re-rendered with Priya's signature;
  - toast "Approved — RFx locked".

  **Send back** (DESIGN §3.9, approver): a required note → award status per 7.3, back to Sujit, audit `award.sent_back`, toast "Sent back to Sujit with your note"; Sujit sees the note and can regenerate.
- [ ] 7.14 **Award tab** (DESIGN §3.9, both roles), leads per state:
  - "Pick a scenario and generate the memo. Every number in it comes from the grid and the ledger."
  - "Memo drafted from **<scenario>**. Read it and approve, or send it back."
  - "**Approved.** The grid is locked and the memo is on file."

  Controls:
  - buyer: scenario select + primary "Generate memo", then the amber chip "awaiting Priya";
  - approver: "Download PDF" · "Send back" · primary "Approve".

  Memo preview on the page: the memo sections rendered in HTML per DESIGN §2.16, plus the PDF download/embed (TRD §17.12).
- [ ] 7.15 **Lock** (PRD item 33; CLAUDE P7-T2 "grid read-only, actions disabled"). Once `rfx.status = 'awarded'`:
  - every mutating endpoint for that RFx returns **409 LOCKED** with a clear message (list them all; test each with a script);
  - the UI hides or disables those actions: review actions, Ask vendor, Sync inbox, Add response, Load seeded responses, Re-run stages, scenario overrides, New scenario, Generate memo;
  - a lock note (prototype: "Awarded — read-only. Memo approved by Priya Raghavan.") on Overview / Review / Comparison / Award;
  - Ask still works (read-only);
  - the header status reads "Awarded"; the RFx list shows **Awarded** and fills the **Annual value** column from the approved scenario (DECISIONS P0-T4 left it "—" until P7).
- [ ] 7.16 **Timeline** rows in words: "Sujit Menon saved scenario 'Q1 …' (₹4.53 cr)", "… generated the award memo from '…'", "Priya Raghavan approved the award — RFx locked", "… sent the memo back: '<note>'" (PRD item 34).
- [ ] 7.17 **Approver tabs** (DESIGN §2.3, §4): Priya gets **Award** (and **Decide** per §0 A); `/rfx/{id}` lands her on Decide if built, else Comparison. Sujit gets **Award** after Comparison.
- [ ] 7.18 **Done-when (CLAUDE P7-T2)** on the throwaway RFx (§3):
  1. Load seeded responses (clean);
  2. save the Q1 scenario;
  3. override one line with a reason;
  4. Generate memo → the PDF opens (read it back with a script: all six sections, the 30 allocation rows, the full ledger, the ₹ sign, the override in open items);
  5. Send back as Priya → regenerate as Sujit → Approve as Priya → locked (7.15 checks), memo re-rendered with both signatures;
  6. `npm run eval` on MER-0419 still 150/150.

### P7-T3 Decide page (only per §0 A)
- [ ] 7.19 DESIGN §3.8 for the approver:
  - computed lead;
  - "See the grid" · "Award"/"Read the memo";
  - the "Against the best single vendor" card (same number as 7.2);
  - the Ask box (§2.14) with the Cost / Risk / Vendors suggestion groups;
  - answer cards newest first (reuse the Ask components).

  Default tab for Priya. If you don't build it, row 7.19 says why and PROGRESS keeps the open question.

### Phase 7 checkpoint
- [ ] 7.20 TRD §22 item 7 on **production**, on a throwaway RFx: save a scenario; compare two; generate the memo; approve as Priya; the grid locks. Download the PDF from production and read it back. Then delete the throwaway RFx with a script.
- [ ] 7.21 Approver / buyer boundaries on production:
  - Priya can save a scenario, but can't override, generate, or use New scenario (API 403);
  - Sujit can't approve or send back (API 403);
  - an awarded RFx → 409 LOCKED on the mutating endpoints.
- [ ] 7.22 Tests (allocation rules, baseline, memo number check if unit-testable), lint, build green; `npm run pipeline:seed` 150/150; push.
- [ ] 7.23 Final state:
  - MER-0419 seeded (14 open review items, all vendors `responded`, **no scenarios, awards or saved queries left from P7 tests**, status reviewing);
  - MER-0417 unchanged and **not awarded**;
  - MER-0418 untouched draft;
  - the RFx list shows exactly these three;
  - throwaway RFx deleted with their files.
- [ ] 7.24 Side by side with the prototype at 1440 px:
  - the Award tab before a memo, with a draft memo (buyer and approver) and after approval (lock note);
  - the scenario comparison; the Decide page (if built);
  - the Ask card with Save as scenario.

  Fix differences or record them.
- [ ] 7.25 Rows 7.1–7.24 ticked in PROGRESS.md with evidence (script check that every row keeps its requirement text and no older phase's row changed); PROGRESS header, eval line, "What works / what doesn't", Known issues and Open questions updated.

---

## 6. NOT in Phase 7 (don't build; list as "later" in the report)

- Award / regret emails to vendors (PRD item 33 calls them optional).
- Awarding MER-0417 with the realistic set (P8-T2 does it through the UI).
- Settings, Eval and Logs pages (P8-T1).
- Live Gmail (out of scope by decision).
- Landed-cost cost-of-money (cut list item 2).

---

## 7. When Phase 7 is done: stop and report to Sujeet

Plain language (he is not an engineer):
1. **What was built**, screen by screen, and what he can now do: save a scenario from an answer, compare scenarios, override a line, generate the memo, send it back, approve, and what "locked" means.
2. **The checklist** with ✓ and evidence, plus open items with reasons.
3. **The numbers**, with the Ask answers they must match:
   - Q1 scenario total;
   - Q5 scenario total;
   - the best-single-vendor baseline and the saving.
4. **The memo**: what's on each of the six parts, the test RFx's PDF read back (page count, the ₹ sign, the ledger rows, the override), and the eval numbers (clean and realistic).
5. **Every decision made without him** (point to the DECISIONS.md entries), especially:
   - where scenarios live;
   - how Send back is stored;
   - the baseline rule;
   - the memo font;
   - whether the Decide page was built.
6. **Anything that needs him.** Still open from before:
   - review the P1 responses;
   - reset the Supabase database password;
   - delete `.env.vercel`;
   - photograph the OrientPack rate card;
   - record the 2-minute screen capture;
   - the co-pilot-initiative question from P5;
   - the "asked cards in the Open list" question from P6;
   - updating the demo script's Gmail steps (P6).

Do not start Phase 8.
