You are continuing the QuoteLens build. Phases 0–5 are done, committed and deployed. Your job is **Phase 6** (CLAUDE.md §3: P6-T1…P6-T3), finished to its checkpoint, **with Gmail mocked**. Stop after the Phase 6 checkpoint and report.

The human (Sujeet) is not an engineer and will not be available during the run. Explain what you do in plain language as you go.

---

## 0. The one scope change you must respect: Gmail is mocked

Sujeet decided (2026-09-24) that **there is no live Gmail integration in this build**. So:

- **Do not** connect to smtp.gmail.com or imap.gmail.com. **Do not** ask for, read or require `GMAIL_USER` / `GMAIL_APP_PASSWORD`. **Do not** add plus-address settings.
- **Do** build everything else in CLAUDE.md P6 and TRD §15.3 / §8.7 / §9.6 against a **mock mailbox** that behaves like Gmail:
  - real RFC 822 emails (`.eml`) with real `Message-ID`, `In-Reply-To` and tagged `Reply-To` headers;
  - an inbox of unread messages;
  - a **Sync inbox** step that pulls unread mail and matches it by tag;
  - idempotency on `Message-ID`, and "mark as seen".
- The live path stays a **documented stub**: `src/lib/email/gmail.ts` exports the same interface and throws `NOT_CONFIGURED` ("Live Gmail is out of scope for this build"), like TRD §15.4 does for Resend. `settings.email_mode` stays `mock`.
- Record this scope change in DECISIONS.md **in your first commit**, with where it matters:
  - CLAUDE.md P6 done-when lines;
  - CLAUDE.md §10 "Gmail mode: one live round-trip";
  - PRD §12 / TRD §15.3;
  - `docs/05_Demo_Script.md` if it mentions Gmail.

  Do not edit the PRD, TRD or CLAUDE.md themselves.

---

## 1. Why this prompt is strict (read first)

Phases 3–5 taught three lessons:
- "Done" must be a ticked checklist with evidence, never a feeling.
- Every button gets tried in the real UI, as both users, including errors and repeat runs.
- Bookkeeping bugs are real bugs. In P5 a helper that ticked checklist rows by number wrote Phase 4 evidence into the older Phase 3 table, because both tables had rows "1–9". **Number this phase's rows `6.1`, `6.2`, … so they are unique in PROGRESS.md**, and check after each tick that the right row changed.

---

## 2. Read first, in this order

1. **CLAUDE.md** (whole file; §0 rules are mandatory), then **PROGRESS.md** and **DECISIONS.md**. Read the P3 review-queue entries, the P3-T5 "second reply never overwrites" guard, and every P4/P5 entry.
2. **TRD** (`docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md`):
   - §6.6 `rfx_vendors`, §6.7 `communications`, §6.8 `responses`, §6.15 `review_items`;
   - §8.4 normalise, **§8.7 clarification replies**, **§9.6 P-CLARIFY**;
   - §12.3 review actions (ask-vendor);
   - **§15.1–15.3** (email common, mock, gmail) and §15.4 (resend stub);
   - §16 routes `/api/email/sync`, `/api/clarify`, `/api/clarify/send`;
   - §17.4 overview (Sync inbox, polling), §17.6 portal, §17.8 review queue;
   - §22 items 3, 5 and 8.
3. **PRD**: §8 Stages 3 and 5b, §12 email modes, §9 ugly-edges rows about clarification and unmatched replies.
4. **DESIGN.md**:
   - §2.3 RFx header ("Sync inbox" button, buyer only);
   - §2.11 review card (Ask vendor inline email block + Send / Cancel);
   - §2.16 email block;
   - §3.4 overview communications timeline;
   - §3.6 Review ("Sync inbox — Westline replied" and "Clarification sent to Westline Packaging for items 5, 9, 15 and 19. Waiting for their reply.");
   - §4 roles, §5 copy rules.

   Check `design/prototype.html` (the `sync`, `clarSent`, `clarified` states in `Overview()` and `Review()`).
5. **Dataset**: `docs/03_Dataset_Pack_README.md` §5 and §11 (hidden truth: Westline bundle sizes 5→25, 9→**20**, 15→50, 19→**40**), `supabase/seed/03_westline/westline_clarification_reply.txt`, and the `after_clarification` blocks in `supabase/seed/gold/gold.json`.
6. **AGENTS.md** (Next.js 16: read `node_modules/next/dist/docs/` before Next-specific code; run `npx next typegen` after adding routes).

Then run `git log --oneline -15`, `npm test` (55 tests, must be green) and `npm run eval` (must say 150/150).

---

## 3. What already exists (reuse it, don't rebuild it)

- **Email:**
  - `src/lib/email/index.ts` has `sendEmail()` (communications row queued → sent, mode `mock`, placeholder `<mock-uuid@quotelens.local>` message id) and `replyToAddress(tag)` (mock: `sourcing+<tag>@meridianfoods.example`).
  - `src/lib/comms.ts` `listComms()` (signed attachment links); `src/components/comms/email-block.tsx`, `outbox-list.tsx`, `portal-reply.tsx`.
- **Dispatch:** `src/lib/dispatch.ts` (`issueRfx`, P-DISPATCH, `REPLY_SENTENCE`); `rfx_vendors.reply_tag` = `rfx-<code lowercased>-<vendor short_code>` (e.g. `rfx-mer-0419-westline`).
- **Intake and pipeline:**
  - intake: `src/lib/responses.ts` `createResponse()`, `seedReply()`, `loadSeedResponses()` (resets reloaded vendors to `invited`);
  - `POST /api/responses`, `src/components/rfx/add-response.tsx` (`submitReply`, `ReplyForm`);
  - Response Detail auto-runs the six stages when opened with `?run=1`;
  - pipeline: `src/lib/pipeline/*`, `run.ts` (`runAll`), `POST /api/responses/{id}/run-all` (NDJSON). The normalise guards live in `src/lib/pipeline/normalise.ts`.
- **Review queue:**
  - `src/lib/review.ts` `act()`. Its **ask-vendor** today is a template draft + "Mark as asked" (item → `asked_vendor`, `rfx_vendors.status` → `clarification_sent`), with Reply-To `…-clar-1`.
  - UI: `src/components/review/review-queue.tsx`, including the "Clarification asked of … Waiting for their reply" note.
- **Screens:** Overview `src/app/(app)/rfx/[id]/overview/page.tsx` + `src/lib/overview.ts`; portal `src/app/(app)/rfx/[id]/portal/[vendorId]/page.tsx`; Outbox `…/outbox/page.tsx`.
- **Eval:** `src/lib/eval/run.ts` already judges reviewed cells against `after_clarification` values.
- **Installed:** `nodemailer` (its `streamTransport: true, buffer: true` builds a complete RFC 822 message **without sending it** — use that for the mock), `mailparser` (`simpleParser`), `imapflow` (do not use).
- **Data:**
  - **MER-0419:** seeded clean set, 150/150, 14 open review items. It must look exactly like this again at the end (`npm run pipeline:seed`).
  - **MER-0417:** realistic set, 150/150.
  - **MER-0418:** untouched draft (v0, no communications, vendors not invited). **Keep it untouched**; issue tests go on a throwaway RFx created through the co-pilot, deleted with a script at the end (as in P5).
- **Environment:**
  - scripts run as `tsx --env-file-if-exists=.env.local --conditions=react-server scripts/x.ts`; throwaway scripts are `scripts/_*.ts` (git-ignored), deleted afterwards;
  - `git push origin main` deploys to https://quotelens-seven.vercel.app;
  - sign in with `POST /api/auth/login` using `SEED_ADMIN_PASSWORD` from `.env.local` (never echo it). Users: `sujit.menon@meridianfoods.example` (buyer), `priya.raghavan@meridianfoods.example` (approver);
  - new migrations start at `0009_*.sql`; never edit 0001–0008; apply with `npm run db:migrate`;
  - known local quirk: after adding route folders, the dev server can 404 every `/rfx/[id]/…` page until you delete `.next` and restart `npm run dev`.

---

## 4. How to work (mandatory)

1. **Before any code, write the Phase 6 checklist into PROGRESS.md** (table `# | requirement (source) | status / evidence`, rows `6.1…`). Start from §5 below and add anything else you find in the §2 reading.
2. **Tick only with evidence:** a unit test, a script output, an API response, or a browser check with the gstack `/browse` skill (never the claude-in-chrome tools).
3. **Test every button you build in the real UI:** as Sujit and as Priya, the empty state, the error state, a repeat run. Model output varies, so run the clarification flow at least twice.
4. **Where specs disagree, choose** (TRD wins on design, DESIGN is the visual spec, CLAUDE.md wins on order and scope) and **record it in DECISIONS.md in the same commit**. DECISIONS.md is append-only.
5. **One commit per task** (`P6-T1: …`), each with the PROGRESS.md update (status, what works, what doesn't, next step).
6. **Prompt tuning** follows CLAUDE.md §9: one change at a time, previous version in `prompts/archive/`, at most 20 minutes per round.
7. **Before reporting done:** tests, lint and `npm run build` green; `npm run pipeline:seed` gives 150/150; push; check production; checklist fully ticked, or each open item listed with its reason.
8. **Product decisions** not covered by the specs go under "Open questions" in PROGRESS.md; pick the easiest-to-reverse option and keep going.
9. **Never:**
   - print env values;
   - special-case seed files or vendors (no `if vendor === "westline"`);
   - hardcode an answer;
   - cache model output by file content;
   - edit migrations 0001–0008.

---

## 5. Phase 6 requirement checklist

### P6-T1 Mock Gmail send + tag (TRD §15.1, §15.3 send half; CLAUDE P6-T1)
- [ ] 6.1 `src/lib/email/tag.ts`:
  - `formatTag(rfxCode, vendorShortCode, clarN?)` → `rfx-mer-0419-westline` / `rfx-mer-0419-westline-clar-2`;
  - `parseTag(textOrAddress, knownTags)` → `{reply_tag, clar_n}`, found in a To address, a subject or free text.
  - TRD's regex `/rfx-([a-z0-9-]+)-([a-z0-9]+)(?:-clar-(\d+))?/` is ambiguous: RFx codes contain hyphens and short codes can contain digits. So **resolve against the RFx's known `reply_tag` values** (longest match) rather than trusting the capture groups.
  - Unit tests: plus-address, bare tag in a subject, `-clar-n`, uppercase, vendor codes with digits (`testsupplier2`), two RFx whose codes share a prefix, no tag → null.
- [ ] 6.2 **Real `.eml` for every outbound email.** `sendEmail()` builds the message with nodemailer `streamTransport` (From, To, Reply-To tag, Subject, text, both attachments, a real `Message-ID`, plus `In-Reply-To`/`References` for clarifications).
  - It stores the `.eml` in bucket `outbound` (`rfx/{id}/outbound/mail/{commId}.eml`) and saves the generated Message-ID in `communications.message_id` (replacing today's placeholder).
  - Status goes queued → sent; mode stays `mock`.
- [ ] 6.3 **Mock mailbox** (migration `0009_mock_mailbox.sql`): a table standing in for Gmail. At least:
  - `id, rfx_id, direction ('to_vendor' | 'to_buyer'), from_addr, to_addr, subject, message_id (unique), in_reply_to, eml_path, seen boolean default false, created_at`;
  - locked down like the other tables (RLS on, no anon/authenticated grants).

  Every outbound email also lands here as `to_vendor`, so the vendor's mailbox shows it. Record the design in DECISIONS.
- [ ] 6.4 `src/lib/email/gmail.ts` stub: same send/sync interface; throws `NOT_CONFIGURED` with the out-of-scope message. `sendEmail()` routes on `settings.email_mode`; anything other than `mock` → a clear 501, never a silent no-op.
- [ ] 6.5 Proof: issue a throwaway RFx through the UI → 5 outbox entries. Download one `.eml` and parse it back with mailparser in a script: headers, Reply-To tag, Message-ID equal to the communications row, 2 attachments intact (XLSX = 30 lines, PDF opens). The Outbox and the vendor portal still render correctly.

### P6-T2 Mock inbox + Sync inbox (TRD §15.3 receive half; CLAUDE P6-T2)
- [ ] 6.6 **Vendor portal becomes the vendor's mailbox:**
  - `/rfx/{id}/portal/{vendorId}` lists every mailbox message to that vendor (dispatch and clarifications), newest first, each with "Reply".
  - A reply builds a real `.eml`: From the vendor's email, **To the tagged Reply-To of the message being answered**, Subject `Re: …`, `In-Reply-To` + `References`, attachments and text. It is stored in bucket `raw` (`mock-mailbox/{id}.eml`) and added to the mailbox as unread `to_buyer`.
  - It **does not create a response**: toast "Sent — it arrives when the buyer syncs the inbox".
  - Files over 4.5 MB get the existing clear error.
  - Record in DECISIONS that the P5 portal (which created the response directly) now goes through Sync, like Gmail.
- [ ] 6.7 `POST /api/email/sync {rfx_id}` (buyer/admin; approver 403; `maxDuration` 120). For each unread `to_buyer` message:
  1. parse with `simpleParser`;
  2. match the tag from **To** → then **Subject** → then **In-Reply-To** against `communications.message_id` (TRD order);
  3. **idempotent on Message-ID** (unique `communications.message_id`; a second sync skips it and reports it under `skipped`);
  4. store the `.eml` raw and each attachment raw;
  5. create the response through `createResponse()` (communication inbound, mode `mock`, `message_id`, `in_reply_to`, `from_addr`, subject; attachments linked);
  6. mark the message seen.

  Returns `{new_response_ids, skipped}`. No tag → a response with `vendor_id = null` plus the existing `unknown_vendor` card, **only if** it replies to something we sent or its subject mentions the RFx; otherwise it is ignored and reported (TRD §15.3).
- [ ] 6.8 Choose the response `source` value for mailbox replies (the check constraint allows `portal`, `gmail`, …). Don't claim `gmail` for mock mail unless you record why; `portal` or a new value via migration 0009 are both fine. Record the choice.
- [ ] 6.9 **"Sync inbox" button** in the RFx header, buyer only, left of "Ask" (DESIGN §2.3, §4):
  - click → sync → for each new response run the six stages (`run-all`, two at a time), with visible progress ("Syncing… 2 new replies, processing");
  - toast per DESIGN §5 ("Synced — 1 new reply from Westline Packaging" / "Nothing new");
  - errors toast with their code.
- [ ] 6.10 **Polling:** the Overview syncs every 30 s while it is open and visible (TRD §15.3; CLAUDE cut-list item 8 allows dropping this — build it, it's small). No overlapping syncs; pauses when the tab is hidden.
- [ ] 6.11 The Overview's "Vendor communications" timeline shows inbound mail with direction ←, Message-ID, In-Reply-To link to the email it answers, and attachments. The Outbox lists outbound only.
- [ ] 6.12 Proof on the throwaway RFx:
  1. reply from the portal as two vendors (one spreadsheet, one pasted text) → Sync → 2 responses, pipeline done, cells in the grid;
  2. **Sync again → 0 new, 2 skipped** (idempotent);
  3. a script drops an **untagged** `.eml` into the mailbox with an RFx-mentioning subject → unmatched sender with `unknown_vendor` card, no crash;
  4. an untagged, unrelated `.eml` → ignored and reported;
  5. MER-0419 untouched (eval 150/150).

### P6-T3 Clarification loop (TRD §8.7, §9.6, §12.3; DESIGN §2.11, §3.6; CLAUDE P6-T3)
- [ ] 6.13 `POST /api/clarify {rfx_id, vendor_id, review_item_ids}` → **P-CLARIFY** (§9.6 verbatim; drafting model; Zod `{subject, body_text}`).
  - Items are built from the review items: line number, description, what is missing ("Item 9 (550x350x350, 5-ply): bundle size not stated — please state pieces per bundle").
  - Draft only, nothing sent. Buyer only.
- [ ] 6.14 `POST /api/clarify/send {rfx_id, vendor_id, subject, body, review_item_ids}` → `sendEmail(kind 'clarification')`:
  - Reply-To tag `<reply_tag>-clar-<n>` (n = that vendor's clarification count + 1);
  - `In-Reply-To` / `References` = the dispatch Message-ID; `.eml` + mailbox entry;
  - review items → `asked_vendor` with the communication id in their resolution;
  - `rfx_vendors.status` → `clarification_sent`;
  - audit `clarification.sent`.
- [ ] 6.15 **Review queue UI** (DESIGN §2.11 / §3.6) replaces the P3 template + "Mark as asked":
  - "Ask vendor" on any of a vendor's open ambiguous / low-confidence / prior-pricing / questionnaire cards drafts **one** email covering all of that vendor's open askable items (DESIGN: "items 5, 9, 15 and 19"), with a way to untick items;
  - inline email block (To / Reply-To / Subject / body), editable subject and body, **Send** and **Cancel**;
  - toast "Sent — logged under vendor communications";
  - the lead note reads "Clarification sent to Westline Packaging for items 5, 9, 15 and 19. Waiting for their reply.";
  - once a tagged reply is waiting unread, the primary button reads **"Sync inbox — Westline replied"** (a cheap `GET /api/email/pending?rfx=` returning counts by vendor is fine).

  Approver: view only (no Ask vendor, no Send; API 403).
- [ ] 6.16 **Ingestion of a clarification reply** (TRD §8.7):
  - a synced reply whose tag carries `-clar-n` → `responses.is_clarification = true`, `supersedes_response_id` = the vendor's main response;
  - the pipeline runs fully, but **normalise only upserts cells for lines that were `references_prior`, `ambiguous`, `not_quoted` or `low_confidence`, or that were listed in the clarification request**; every other cell is untouched;
  - this deliberately overrides the P3-T5 "a second reply never overwrites another reply's cells" guard **for clarification replies only**; the guard stays for everything else (DECISIONS P3-T5 b already anticipates this);
  - the original response's review items for those lines → `resolved_by_reply`;
  - `rfx_vendors.status` → `clarified`;
  - ledger rows for the replaced best guesses are superseded, not deleted.

  Keep the clarification reply's own questionnaire answers from overwriting real ones (existing guard).
- [ ] 6.17 **Mock paste path** (CLAUDE: "test with westline_clarification_reply.txt (mock paste)"): the Add response sheet, for a vendor with an outstanding clarification, offers "This answers the clarification sent <date>". It then creates the same `is_clarification` response without going through the mailbox.
- [ ] 6.18 **Done-when on MER-0419**, both paths, each run twice. Clear nothing else in the queue first. Ask Westline about items 5, 9, 15 and 19 → reply with `westline_clarification_reply.txt`, once via portal + Sync and once via mock paste (reload MER-0419 between runs). Each time:
  - lines 5/9/15/19 become **reviewed** at **₹27,960 / ₹68,700 / ₹14,080 / ₹14,475** per 1000 (gold `after_clarification`; 9 and 19 differ from the old best guesses, which is the demo point);
  - their 4 ambiguous cards → `resolved_by_reply`;
  - Westline status `clarified`;
  - every other Westline cell and every other vendor byte-identical before/after (script diff);
  - `npm run eval` still 150/150 (judged on the after-clarification values);
  - the drawer's conversion chain says the pack size came from the vendor's clarification reply, with a link to it.
- [ ] 6.19 A clarification reply for items the vendor has since been asked about again (clar-2), or a reply to a clarification of an already-clarified line, behaves sensibly (latest reply wins, nothing duplicated). Record the rule.

### Phase 6 checkpoint
- [ ] 6.20 TRD §22 item 8, rewritten for the mock:
  1. issue a throwaway RFx;
  2. the 5 emails are in the vendor mailboxes (portal);
  3. reply from the portal with a photo (`04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg`);
  4. Sync;
  5. the response appears and extraction runs;
  6. cells land.

  Do this on **production**. Then the clarification loop once on production (on the throwaway RFx or MER-0419, then reload).
- [ ] 6.21 Approver on production: no Sync inbox, no Ask vendor, no Send; sync / clarify / clarify-send → 403.
- [ ] 6.22 Tests (tag parser, `.eml` round trip: build with nodemailer, parse with mailparser; clarification scoping of normalise if unit-testable), lint, build green; `npm run pipeline:seed` 150/150; push.
- [ ] 6.23 Final state:
  - MER-0419 reloaded to the seeded state (14 open review items, all vendors `responded`, no clarification rows);
  - MER-0417 unchanged;
  - MER-0418 untouched draft;
  - the RFx list shows exactly these three;
  - throwaway RFx, their mailbox rows and their files deleted by script.
- [ ] 6.24 Side by side with the prototype at 1440 px: Review with the clarification email block and the "Waiting for their reply" note, the Sync inbox button in the header, the Overview timeline with a clarification round trip, the portal mailbox. Fix differences or record them.
- [ ] 6.25 Rows 6.1–6.24 ticked in PROGRESS.md with evidence; PROGRESS header, eval line, "What works / what doesn't", Known issues and Open questions updated.

---

## 6. NOT in Phase 6 (don't build; list as "later" in the report)

- Live Gmail send (SMTP) and IMAP sync, App Passwords, vendor plus-address settings — **out of scope by decision**.
- Resend (TRD §15.4 stub only, if you touch it at all).
- Scenarios, Save as scenario, award memo, approve, lock bar (P7).
- The approver's Decide page (open question from P5).
- Settings page (the email-mode radios with Gmail shown as "not configured"), Eval page, Logs page (P8).

---

## 7. When Phase 6 is done: stop and report to Sujeet

Plain language (he is not an engineer):
1. **What was built**, screen by screen: what he can now do (portal mailbox, Sync inbox, Ask vendor → clarification → reply → prices fixed).
2. **The checklist** with ✓ and evidence, plus open items with reasons.
3. **The clarification result**: before/after for Westline items 5, 9, 15 and 19 (value, state), both runs, both paths.
4. **Eval numbers**: clean and realistic.
5. **Every decision made without him** (point to the DECISIONS.md entries), especially how Gmail is mocked and what switching to live Gmail later would take.
6. **Anything that needs him.** Still open from before:
   - review the P1 responses;
   - reset the Supabase database password;
   - delete `.env.vercel`;
   - photograph the OrientPack rate card;
   - record the 2-minute screen capture;
   - the Decide-page and co-pilot-initiative questions from P5.

   Also state that CLAUDE.md §10's "Gmail live round-trip" gate is replaced by the mock round trip, so he can update the demo script.

Do not start Phase 7.
