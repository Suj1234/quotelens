# PRD — "Kill the Quote Spreadsheet"
## AI-native RFx → Any-format vendor response → Normalised comparison → Plain-language analysis → Defensible award

| Field | Value |
|---|---|
| Document | 1 of 6 — Product Requirements Document |
| Version | 1.0 |
| Date | 23 September 2026 |
| Owner | Sujeet |
| Status | Approved for build |
| Related | 2 FSD/TRD · 3 Dataset Pack · 4 Build Plan (CLAUDE.md) |
| Build window | 48 hours, solo, Claude Code end to end |
| Working product name | **QuoteLens** (placeholder; rename freely) |

---

## 0. How to read this document

This PRD is written so that a person or an AI coding agent with no access to the original discussion can build the product from it together with the FSD/TRD (document 2) and the Dataset Pack (document 3). Nothing in the discussion is assumed to be known. Where a decision was made for a reason, the reason is recorded. Where something is deliberately excluded, it is listed in §5 so it is not accidentally built.

Terminology for non-technical readers is in §20 (Glossary). Technical implementation detail (database tables, prompts, API routes) lives in the FSD/TRD, not here.

---

## 1. Context — the assignment

### 1.1 The brief

The brief, titled "Kill the Quote Spreadsheet", asks for a working system that:

1. Lets a buyer **talk an RFx into existence** with an AI co-pilot — scope, line items, questionnaire, terms.
2. Sends it to vendors over **a channel the candidate chooses**.
3. Accepts vendor responses **in whatever format they arrive** — nobody is forced into a template.
4. Reads every response and lands them in **one side-by-side comparison** — same lines, same units, same currency — with questionnaire answers and attached documents alongside.
5. Lets the buyer **ask questions in natural language** over the whole comparison: text answers, tables, charts, exports.
6. Reaches a **defensible award decision**.

Demo size stated in the brief: **five vendors, thirty line items, a questionnaire, attached documents**, with a fabricated dataset a procurement person would recognise as real.

### 1.2 The one rule in the brief

> "Stub the plumbing, but the AI loops must be real. Fake the SMTP server if you like. Don't fake the extraction, don't fake the reasoning, don't hardcode the answers to your demo questions."

Every AI step in this product runs live on the actual uploaded content. No cached results, no pre-computed answers, no demo-question lookup tables.

### 1.3 What the evaluators say they grade

The brief states everyone can build the happy path; they care about:

| Criterion | Brief's wording (paraphrased) | This product's answer |
|---|---|---|
| **Ugly edges** | The angled photo. The vendor who quoted 27 of 30 lines. The one who quoted in USD. The one whose "per box" is someone else's "per 100 pieces". What does the system do — and show the buyer — when it isn't sure? | Explicit uncertainty: confidence per cell, a review queue, evidence shown next to every guess, "not quoted"/"ambiguous"/"references prior pricing" as first-class states. See §9. |
| **Trust** | Would a buyer with ₹4 crore on the line act on what's on the screen? | Provenance chain on every number, assumptions ledger, computed (not narrated) answers with the query shown, audit timeline, award memo. See §10. |
| **Judgment and taste** | A thousand decisions with no correct answer; can you say why? | Every product decision in this PRD carries its reason; the one-page note (document 6) summarises them. |

The brief adds: if the candidate finds "the interesting problem was actually somewhere else", say so. This product's answer is in §3.2.

### 1.4 Deliverables (from the brief)

1. A **working prototype**, live-deployed, ready for a demo the interviewers drive.
2. A **recorded walkthrough** of the analyst conversation (candidate picks the questions).
3. A **one-page note** on what was decided and what was deliberately left out.

### 1.5 Constraints established in the discussion

| Constraint | Decision |
|---|---|
| Time | 48 hours total, calendar-bound. |
| Builder | The candidate, non-engineer background, using Claude Code end to end. No second engineer. |
| Cost | ₹0 beyond the Gemini API credit already purchased. No paid gateways, no domain purchase, no paid hosting tiers. |
| Hosting | Vercel Hobby (free) plan for the web app. Supabase free tier for database and file storage. |
| Models | Google Gemini via the candidate's own API key for all reading/extraction/generation. A Jev-compatible decision layer that routes to real Jev (TypeSafe AI) only if an OpenRouter key is present; otherwise Gemini answers decision questions. |
| Live demo | Interviewers may upload their own documents during the demo. Nothing may depend on the seeded dataset. |
| Email | Three transport modes behind one switch: mock, Gmail (free, real), Resend (only if a domain is ever bought — out of scope for the 48 hours). |
| Category | Corrugated packaging (the brief's own example; richest unit/spec ambiguity). Schema remains category-agnostic. |

---

## 2. Problem statement

A category buyer issues an RFx for ~30 line items to ~5 vendors. Responses come back over days in five incompatible shapes: an Excel that ignores the template, a PDF on letterhead with the discount in a footnote, a Word document with commercials written in prose, a phone photo of a printed rate card taken at an angle, and an email that says "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra".

The buyer retypes everything into a spreadsheet (three days), then the VP asks a question that the spreadsheet can't answer without another day of manual work ("what if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?").

The cost is not only the four days. It is that the resulting spreadsheet silently embeds dozens of normalisation decisions (which FX rate, whether "per box" meant 50 or 100 pieces, whether freight was included) that nobody can audit, so the award decision rests on numbers nobody can defend.

---

## 3. Product thesis

### 3.1 What we are building

One flow, end to end, where **every number the buyer sees can be traced to its source and every assumption behind it is explicit and reviewable**, and where analysis is **computed** from extracted data rather than narrated by a language model.

### 3.2 Where the interesting problem actually is

The comparison table is not the hard problem — several vendors already extract quotes from PDFs and spreadsheets. The hard problem is the **assumptions ledger**: two buyers given the same five responses produce two different spreadsheets because they normalise differently, silently. The product's job is to make normalisation explicit, reviewable and auditable — to show the buyer what the system is *not* sure about, rather than to hide it behind a "99% accurate" claim.

This is the thesis of the one-page note and the reason the review queue, provenance chain and ledger are core scope rather than polish.

### 3.3 Design principles (used to settle every open decision)

1. **Evidence before value.** No normalised number is displayed without a link to the raw text/cell/region it came from.
2. **Uncertainty is a state, not an error.** Missing, ambiguous, inferred, low-confidence and referenced-elsewhere are first-class cell states with their own visual treatment.
3. **Compute, don't narrate.** Any question involving numbers is answered by running a query over the extracted data, and the query is shown.
4. **The buyer decides; the system proposes.** Every automated judgement can be confirmed, overridden or excluded, and the override is logged with who and when.
5. **Nothing is faked in the AI loop; transport may be.** Email delivery can be mocked; extraction, mapping, normalisation, reasoning and answers cannot.
6. **Category-agnostic schema, category-specific dataset.** The demo is packaging; a live upload from any other category must still extract.

---

## 4. Goals and success criteria

### 4.1 Goals

| # | Goal | Measure |
|---|---|---|
| G1 | End-to-end flow works live on the deployed URL: draft → dispatch → receive → extract → compare → ask → award | Interviewer can drive it without the candidate touching the keyboard |
| G2 | All five seeded response formats extract correctly to the comparison grid | Eval page shows ≥ 90% of 150 price cells correct or correctly flagged (target 143+) |
| G3 | A document the interviewer uploads live is processed with visible progress and lands in the grid or the review queue | No crash, no silent drop, no "unsupported format" for xlsx/pdf/docx/jpg/png/txt/eml |
| G4 | Every ugly edge in §9 has a visible, specific behaviour | Demo script hits each one |
| G5 | Every numeric answer in the Q&A is computed and shows its query | Zero answers produced by the LLM reading the table |
| G6 | Award memo exports as PDF; comparison exports as XLSX/CSV | Files open cleanly |
| G7 | Live email works in Gmail mode; mock mode works without any email | Both demonstrated in the recording |

### 4.2 Definition of done for the demo

- Deployed URL loads with two seeded users (Sujit, Priya) and two RFx: one fully completed, one ready for a live run.
- A fresh RFx can be created, dispatched, receive a live reply (Gmail mode) or a simulated reply (mock mode), and reach award in under 15 minutes of demo time.
- The eval page shows extraction accuracy on the seeded set.
- Loom recording exists. One-page note exists.

---

## 5. Non-goals and deliberate exclusions

| Excluded | Reason |
|---|---|
| Supplier discovery / recommendation | A different procurement job (Fairmarkit, Keelvar do this); not in brief |
| Automated negotiation | Different job; dedicated negotiation products cover it |
| PO creation, ERP integration, invoicing | Downstream of award; not in brief |
| Real authentication, roles, SSO | Two seeded users suffice for the demo; hours saved go to extraction |
| Multi-tenant, org management | Single tenant |
| Resend/custom-domain email transport | Requires buying a domain; ₹0 constraint. The mode exists as a code path stub but is not configured |
| Real inbound webhooks | Free path is Gmail IMAP polling; webhook path is the Resend mode above |
| Agent framework (CrewAI, LangGraph, DSPy, ADK) | A sequence of typed model calls is sufficient, more debuggable, and avoids a second runtime. DSPy considered and excluded on time (see one-page note) |
| Voice input for the co-pilot | "Talks into existence" is satisfied by chat; voice adds risk, no grading value |
| Historical pricing database | "Same as last year" is handled by flagging and asking, not by storing prior contracts |
| Currency conversion beyond USD→INR and EUR→INR | Enough for the ugly edge; rate stored as an assumption |
| Mobile layout | Desktop demo |
| Fine-tuned models, prompt optimisation loops | Eval page measures; no optimiser in 48h |

---

## 6. Personas

### 6.1 Sujit Menon — Category Buyer, Packaging
- Employer: **Meridian Foods Pvt Ltd**, FMCG, Bengaluru HQ; plants at Hosur (TN) and Nelamangala (KA).
- Owns the RFx end to end. Comfortable with Excel; hates retyping. Accountable for the numbers in the award memo.
- Primary user of: RFx co-pilot, dispatch, review queue, comparison grid, clarification emails, award.
- Trust need: "If I confirm this cell, I want to see what it was read from."

### 6.2 Priya Raghavan — VP Procurement
- Never opens Excel. Asks questions, signs awards, gets audited.
- Primary user of: Q&A panel, scenarios, award memo, audit timeline.
- Trust need: "Show me why, in one sentence, and show me the filter you used."

### 6.3 Admin (Sujit in practice)
- Settings page: email mode, decision-layer provider, FX rate override, thresholds.

### 6.4 The five vendors (fabricated) and the ugliness each embodies

| # | Vendor | Location | Response format | Ugly edges carried |
|---|---|---|---|---|
| V1 | **Sri Balaji Packaging** | Hosur, TN | Excel — their own layout, ignores our template; extra columns; merged headers; a "discount 3% on total" line at the bottom | Template ignored; total-level discount that must be allocated or shown separately; quotes per **1000 pcs** as asked |
| V2 | **Kohinoor Corrugators** | Pune, MH | PDF on letterhead, two pages, table plus a **footnote**: "Prices net of 2.5% early-payment discount if paid within 10 days" | Discount buried in footnote; quotes **27 of 30 lines** (3 lines "not in our range"); validity 30 days |
| V3 | **Westline Packaging** | Ahmedabad, GJ | Word document — commercials in **paragraph form** with a small table; quotes **per box** and states pack size only for some SKUs | Prose extraction; per-box unit needing pack-size conversion; pack size missing for 4 lines → ambiguous |
| V4 | **OrientPack Ltd** | Chennai (Malaysian parent) | Printed rate card **photographed at an angle** on a phone (JPG); prices in **USD per 1000 pcs**; one row partially obscured | Vision extraction; USD→INR conversion as an assumption; one low-confidence cell; freight "FOB Chennai" |
| V5 | **Anand Box Works** | Bengaluru | **Email body text only**: "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra" | Per-kg unit needing weight-per-piece conversion from RFx spec; "rest same as last year" → references prior pricing not on file; freight excluded |

The vendor set is designed so each brief-named ugly edge is embodied by exactly one vendor, plus two extra edges (total-level discount, per-kg pricing) that a packaging buyer would expect.

---

## 7. Category and dataset (summary; full detail in Dataset Pack)

- **Category:** corrugated packaging — 3-ply and 5-ply boxes and sheets.
- **RFx:** 30 line items. Each line has: line number, our SKU code, description, ply, dimensions (L×W×H mm), GSM/burst factor spec, estimated monthly quantity, annual quantity, **required quote unit = ₹ per 1000 pieces**, delivery location (Hosur or Nelamangala), and a weight-per-piece (grams) figure derived from spec — needed to convert per-kg quotes.
- **Commercial terms in RFx:** 12-month contract; delivered-to-plant (freight included) requested; payment 45 days; quote validity 60 days; INR.
- **Questionnaire (10 questions):** BIS/ISO 9001 certification (Y/N, disqualifying if N), in-house corrugation (Y/N), monthly capacity in tonnes (number), sample lead time in days (number), FMCG clients in last 2 years (text), BRC/food-grade compliance (Y/N, disqualifying if N), minimum order quantity (number), lead time for regular orders in days (number), can supply both plants (Y/N), accepts 45-day payment (Y/N).
- **Attached supporting docs:** each vendor attaches 1–2 supporting files (a certificate PDF, a company profile) that must be listed alongside the quote but are not price sources.
- **Gold answer key:** 5 vendors × 30 lines = 150 price cells, each with the expected normalised value or expected state (not quoted / ambiguous / referenced-prior / low-confidence), plus expected questionnaire answers. Used by the eval page.

---

## 8. End-to-end flow (the product, stage by stage)

Each stage lists: who, what they do, what the system does, what they see, and what is logged. Screen names are in **bold**; the FSD/TRD specifies their layout.

### Stage 0 — Setup (once)
- **Settings** page holds: `EMAIL_MODE` (mock | gmail | resend), `DECISION_PROVIDER` (auto | gemini | jev), FX rates with date and manual override, confidence thresholds, vendor address book.
- In **gmail** mode: the app's sender is the candidate's Gmail account (App Password); the five vendor addresses are Gmail plus-aliases of a second personal address (e.g. `name+balaji@gmail.com`), all landing in one inbox.
- In **mock** mode: no email leaves the system; an **Outbox** page and a **Vendor Portal Simulator** page stand in.

### Stage 1 — Sujit drafts the RFx with the co-pilot
1. Sujit opens **New RFx** and types (or dictates via OS speech-to-text into the box): "Corrugated packaging for the Q4 run, ~30 SKUs, last year's list plus the new 5-ply export cartons, 12-month contract, delivered to Hosur and Nelamangala."
2. The co-pilot asks the questions a good procurement lead would: incoterms (delivered vs ex-works), payment terms, validity, whether freight must be included, quoting unit, whether a quality questionnaire applies, target vendors.
3. Sujit uploads last year's line sheet (xlsx/csv) or pastes it. The co-pilot proposes the 30-line table with all fields in §7; Sujit edits inline (add/remove line, change quantity, fix a spec).
4. The co-pilot proposes the questionnaire; Sujit marks which questions are **mandatory** and which are **disqualifying**.
5. Sujit adds vendors from the address book or types name + email.
6. Sujit clicks **Issue RFx**. The system freezes **RFx v1** (line items, terms, questionnaire, vendor list). All downstream data references this version.

What is logged: RFx created (who/when), each co-pilot suggestion accepted/edited, version frozen.

### Stage 2 — Dispatch
7. The system generates, per vendor, an email with: cover text (personalised with vendor name), the line-item table as an **attached XLSX**, the questionnaire as an **attached PDF**, commercial terms, response deadline, and the sentence: "Reply to this email with your quotation in any format convenient to you."
8. **gmail** mode: sends via Gmail SMTP from the sender account; `Reply-To` is set to a tagged address `sender+rfx-{rfxId}-{vendorId}@gmail.com`. **mock** mode: the same emails appear in **Outbox** with status "sent (mock)".
9. RFx status → **Issued — awaiting 5 responses**. The **Vendor Communications** timeline shows each dispatch with timestamp, recipient, attachments, and (gmail mode) the SMTP message id.

### Stage 3 — Responses arrive
10. **gmail** mode: the app polls the sender's inbox over IMAP when the RFx page is open (and on a **Sync inbox** button). New mail whose `To`/`Reply-To`/subject carries the RFx tag is pulled with attachments and stored raw. **mock** mode: Sujit opens **Inbox** → picks vendor → uploads files and/or pastes email text; or opens **Vendor Portal Simulator**, which shows the RFx "as the vendor received it" with a reply box and attachment upload; or clicks **Load seeded responses** which pushes the five Dataset-Pack files through the real pipeline.
11. Either path emits the same internal event **Response received** (vendor, RFx, raw files, raw email text). Everything after this point is one code path.
12. **Vendor matching** is by the tagged address the reply was sent to, not by sender (Gmail replies from the base address, and real vendors forward RFx internally). If no tag matches, the response goes to an **Unmatched responses** list where Sujit assigns it to a vendor or creates a new vendor.

### Stage 4 — Ingestion (the core)
13. For each response, a visible pipeline runs with per-stage status on the **Response Detail** page:
    - **Classify** each file/text: quotation | questionnaire answers | supporting document | not relevant. (Decision layer.)
    - **Extract** from quotation sources: every quoted item in raw form — vendor's own description, quantity, unit *as written*, unit price *as written*, currency, validity, freight/tax terms, discounts (line-level and total-level), footnotes, notes. (Gemini; files: xlsx/csv → text; docx → text; pdf/images → native; email → text.)
    - **Map** each raw item to one of the 30 RFx lines with a confidence score, or to **no line** (unmatched item). (Decision layer: choice over 30 lines + "none", with probability.)
    - **Normalise** to the RFx unit (₹ per 1000 pcs) and INR, recording each conversion as an **assumption** (unit conversion basis, FX rate and date, pack size used, weight-per-piece used, discount treatment, freight treatment).
    - **Questionnaire** answers: map free text to the 10 questions; yes/no with probability; numeric extraction; disqualification flags. (Decision layer.)
    - **Completeness & flags**: not-quoted lines, references-prior-pricing, freight-excluded, validity shorter than requested, currency ≠ INR, total-level discount present. (Decision layer + rules.)
14. Progress is visible per stage and per vendor ("3 of 5 vendors processed"). A single document typically takes 20–60 seconds; the UI must never show only a spinner.
15. Everything below a confidence threshold, every ambiguity and every flag lands in the **Review Queue**.

### Stage 5 — Sujit clears the Review Queue
16. Each queue item shows: the system's proposed value/state, the confidence, and the **evidence**: cropped image region (photo), PDF page snippet, spreadsheet cell reference and content, or the email sentence. Actions: **Confirm**, **Override** (enter value + reason), **Exclude from comparison** (reason), **Ask vendor** (drafts a clarification email — Stage 5b).
17. Items are grouped by vendor and by type (ambiguous unit, low-confidence read, unmapped item, missing line, prior-pricing reference, FX assumption, discount treatment).
18. Every action writes to the **Assumptions Ledger** with user, timestamp, before/after.

### Stage 5b — Vendor clarification loop
19. For "rest same as last year", missing lines, or unit ambiguity, **Ask vendor** drafts an email listing exactly the affected lines and the question. gmail mode: sent for real; mock mode: appears in Outbox. The reply comes back through Stage 3 and re-runs ingestion **for the affected lines only**, updating the grid and closing the queue items.

### Stage 6 — Comparison Grid
20. One grid: 30 rows × 5 vendor columns, values in ₹ per 1000 pcs. Cell states (with distinct visual treatment and a legend): **Confirmed** (high-confidence extraction), **Inferred** (normalised via an assumption — hover shows it), **Reviewed** (Sujit set/confirmed it), **Low-confidence** (in queue, not yet resolved), **Ambiguous** (unit or pack size unresolved), **Not quoted**, **References prior pricing**, **Excluded**.
21. Toggles: **Unit price ↔ Landed cost** (freight and taxes applied per vendor's stated terms; payment-term cost-of-money optional); **Show original currency/unit**; **Include/exclude disqualified vendors**.
22. Row/column summaries: per-line min, per-vendor total on quoted lines, coverage (lines quoted / 30), validity date, disqualification badge.
23. Tabs: **Prices**, **Questionnaire** (10 questions × 5 vendors, with pass/fail and evidence), **Documents** (attached files per vendor with type and pages), **Ledger** (all assumptions), **Timeline** (audit).
24. Clicking any cell opens the **Provenance Drawer**: source file → location (page/cell/region) → raw text → mapping decision (which line, probability, provider) → conversion steps → who confirmed → when.

### Stage 7 — Priya asks questions
25. The **Ask** panel sits beside the grid. Priya types a question. The system: (a) interprets the question into a query plan, (b) runs a query over the normalised data (SQL against the comparison tables; see FSD/TRD for guardrails), (c) renders the answer as text + table and/or chart, (d) shows a one-line "How I computed this" in plain words with a **Show query** link, (e) lists exclusions applied (disqualified vendors, unresolved cells) and how they were treated.
26. If the question needs a cell that is unresolved, the answer states it and offers the choices ("3 cells are ambiguous; I excluded them — click to include the system's best guess instead").
27. Any question whose result is an allocation (who gets which line) can be **saved as a Scenario** with a name.
28. **Export** any answer as CSV/XLSX; export the grid as XLSX.

### Stage 8 — Scenarios and award
29. **Scenarios** page: saved scenarios side by side — total cost, vendor count, per-vendor share, lines with a single qualified quote, savings vs the best single-vendor total.
30. **Weighted award** (optional): price weight vs questionnaire score weight (slider), producing a ranked allocation.
31. Sujit picks a scenario, overrides individual lines with a reason, and clicks **Generate award memo**.
32. **Award memo (PDF)** contents: award table (line → vendor → normalised price → runner-up and gap → reason), totals and savings vs single-vendor baseline, exclusions with reasons, full assumptions ledger, open items (unresolved cells, manual overrides), the plain-language rule that produced the allocation, signatures (Sujit prepared, Priya approved).
33. Priya clicks **Approve**. RFx status → **Awarded**, grid locks (view-only), memo stored. gmail mode: award/regret emails optional (Outbox in mock).

### Stage 9 — Audit
34. **Timeline** tab lists every event: RFx created, version frozen, each dispatch, each response received, each pipeline run, each review action, each question asked (with query), each scenario saved, memo generated, approval.

---

## 9. Ugly-edges matrix (required behaviours)

| Edge | Source in dataset | System behaviour | What the buyer sees |
|---|---|---|---|
| Template ignored | V1 Excel | Extract from any layout; map by description + spec similarity, not column position | Normal cells; provenance shows original column names |
| Discount in footnote | V2 PDF | Extract footnotes as terms; apply as **assumption** (net vs gross), default = show gross and show net toggle | Cell shows gross; ledger entry "2.5% early-payment discount available; not applied by default" |
| 27 of 30 lines | V2 | Missing lines get state **Not quoted**; vendor excluded from those lines in per-line awards; coverage 27/30 shown | Grey cells; column header "27/30 lines"; Q&A excludes automatically and says so |
| Commercials in prose | V3 Word | Extract from paragraphs; each extracted item links to the sentence | Provenance shows the sentence highlighted |
| Per box vs per 1000 pcs | V3 | Convert only when pack size is stated for that SKU; otherwise **Ambiguous** with the system's best guess (from the vendor's other lines or RFx spec) and a one-click confirm | Amber cell with "per box — pack size not stated; guess 50/box from line 7 pattern" |
| Angled photo | V4 JPG | Vision extraction; per-cell confidence; partially obscured row → **Low-confidence** | Queue item with the cropped region beside the read value |
| Quoted in USD | V4 | Convert at FX rate stored with date; rate editable in Settings | Cell in INR with "USD 5.20 @ 83.15 (23 Sep 2026)" in provenance; toggle shows original |
| FOB / freight excluded | V4, V5 | Landed-cost toggle applies a freight assumption (per-vendor, editable); unit price view leaves it out | Ledger entry per vendor; column badge "freight extra" |
| Per kg pricing | V5 email | Convert using weight-per-piece from the RFx spec; each conversion is an assumption | Inferred cell; provenance shows "₹42/kg × 0.412 kg/pc × 1000" |
| "Rest same as last year" | V5 | State **References prior pricing**; not converted; **Ask vendor** action pre-drafted; option to upload last year's sheet (out of scope beyond flag) | Cells marked; Q&A treats as unresolved and says so |
| Total-level discount | V1 | Stored as a vendor-level term; default not allocated to lines; toggle to allocate pro rata | Ledger entry; column badge |
| Vendor's SKU description differs from ours | all | Mapping by description/spec with probability; below threshold → queue | Queue item "Mapped 'Export Carton 5P 600x400x400' → Line 12 (p=0.78)" |
| Extracted item matches no line | any live upload | **Unmatched items** bucket; buyer can map manually or ignore | Panel under the grid |
| Document isn't a quote | live upload | Classified "not relevant" → shown under Documents with reason; not extracted | Notice on Response Detail |
| Unknown sender / vendor | live upload / gmail | **Unmatched responses**; assign or create vendor | List on RFx page |
| Validity shorter than requested | V2 | Flag; shown in column header; Q&A can filter | Badge "valid to 23 Oct" |
| Same line quoted twice in one response | possible | Keep both; flag conflict; buyer picks | Queue item |
| Interviewer uploads a doc from another category | live | Extracts into generic schema; most items land in Unmatched | Grid unchanged; Unmatched panel fills; nothing crashes |

---

## 10. Trust features (what earns "₹4 crore" confidence)

1. **Provenance chain on every cell** (§8 step 24).
2. **Assumptions ledger** — every conversion, rate, treatment and override, with source and author; exported in the memo.
3. **Review queue** — nothing low-confidence silently enters the grid.
4. **Computed answers with the query shown** — Q&A runs SQL over the data; the query and row set are one click away.
5. **Decision provenance** — every classification/mapping/pass-fail shows which provider decided (Gemini or Jev) and the probability.
6. **Audit timeline** — complete, exportable.
7. **Award memo** — the artifact a buyer forwards to a VP or an auditor.
8. **Eval page** — the product measures itself on the seeded set and shows the per-cell diff; honesty about misses.
9. **Versioned RFx** — every response is read against a frozen v1.

---

## 11. Decision layer (product-level requirements)

- The product separates **reading** (extraction, drafting, SQL generation — done by Gemini) from **deciding** (classification, line-mapping choice, yes/no questionnaire outcomes, completeness flags — done by the decision layer).
- The decision layer exposes one internal interface: *state + typed questions (choice from a list / score on a scale / yes-no probability) → typed answers with probabilities*. This mirrors the "System One" interface of TypeSafe AI's Jev model.
- **Provider routing:** if `OPENROUTER_API_KEY` is present, decisions go to real Jev via OpenRouter (model `typesafe/jev-1.13`) with Gemini as fallback on error. If absent (the default for this build, by the ₹0 constraint), decisions go to Gemini with structured output constrained to the option list and a self-reported confidence.
- **Labelling:** the UI labels probabilities from Jev as "measured" and from Gemini as "LLM-estimated". The interview narrative is: "Jev-compatible decision layer, run on Gemini for this build; drop in a key and it switches."
- **Thresholds (defaults, editable in Settings):** act automatically ≥ 0.85; review 0.60–0.85; below 0.60 → queue with "low confidence". These apply to mapping and questionnaire decisions.
- **Guardrails inherited from Jev's documented limits:** the decision layer never does arithmetic, dates or values outside the option list; it only judges text that has already been extracted; it receives only the relevant extracted snippet, never the whole document.

---

## 12. Email modes (product-level)

| Mode | Outbound | Inbound | Configured for demo? |
|---|---|---|---|
| mock | Outbox page; emails rendered, not sent | Inbox page (upload/paste), Vendor Portal Simulator, Load seeded responses | Yes — default |
| gmail | Nodemailer over Gmail SMTP with App Password; Reply-To tagged per vendor | IMAP polling of the same account; tag-based matching; attachments pulled | Yes — the "live" story |
| resend | Resend API from a verified domain | Resend inbound webhook | No — code path stubbed; needs a domain |

Requirements common to all modes: same **Response received** event; idempotent ingestion (a re-delivered or re-synced email is not processed twice); every send/receive logged in Vendor Communications with timestamps and ids; attachments stored raw before processing.

---

## 13. Analyst Q&A — required question coverage

The recording and live demo must answer at least these; none may be hardcoded:

| # | Question (Priya) | Expected answer shape |
|---|---|---|
| Q1 | Cheapest vendor per line, only among vendors who cleared the quality questionnaire | Table 30 rows; total; excluded vendors and why |
| Q2 | What does that save versus awarding everything to the cheapest single vendor? | Number + bar chart |
| Q3 | Which lines have only one qualified quote? | Risk list |
| Q4 | Show landed cost instead of unit price — does the ranking change? | Table with rank deltas |
| Q5 | Split 5-ply to the cheapest qualified and 3-ply to whoever is cheapest overall — better or worse than Q1? | Two totals; save as scenario |
| Q6 | Which cells are you not sure about, and how much money rides on them? | List of unresolved cells with value-at-stake |
| Q7 | What did OrientPack's USD conversion assume, and what if the rupee moves 3%? | Ledger entry + sensitivity |
| Q8 | Export the Q1 allocation as Excel | File |

Additional: "Who has the shortest validity?", "Who didn't quote line 22?", "Why is Anand's 5-ply so cheap?" (answer should surface the per-kg conversion assumption).

---

## 14. Screens (list; layouts in FSD/TRD)

1. Login (two seeded users)
2. RFx list
3. New RFx — co-pilot chat + structured editor (lines, terms, questionnaire, vendors)
4. RFx overview — status, vendor cards with response status, Vendor Communications timeline, Sync inbox
5. Outbox (mock) / Sent (gmail)
6. Inbox (mock) — upload/paste per vendor; Unmatched responses
7. Vendor Portal Simulator (mock)
8. Response Detail — pipeline progress, extracted items, flags, documents
9. Review Queue
10. Comparison — tabs Prices / Questionnaire / Documents / Ledger / Timeline; Ask panel; Provenance drawer; Unmatched items panel
11. Scenarios
12. Award — memo preview, approve
13. Settings
14. Eval

---

## 15. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | One document ≤ 60 s typical; each pipeline stage is its own request so no single request exceeds the host's function limit (300 s on Vercel Hobby with Fluid Compute; design for ≤ 60 s per call) |
| Live uploads | No caching of results keyed on file hash; every upload runs the full pipeline |
| File types | xlsx, xls, csv, pdf, docx, jpg, jpeg, png, txt, eml; anything else → "unsupported" notice, not a crash |
| File size | ≤ 10 MB per file; images downscaled before vision calls if needed |
| Cost | Gemini calls per seeded run ≤ ₹50; no other paid service |
| Security | API keys only in environment variables; never in the client; IMAP/SMTP credentials same; no keys in the repo |
| Data | Supabase free tier; raw files in Supabase Storage; nothing deleted during demo |
| Idempotency | Same email/file re-submitted does not duplicate a response |
| Observability | Every model call logged with provider, model, tokens, latency, purpose; visible on an admin-only Logs view |
| Reliability during demo | Decision provider fallback; pipeline stage retry once; clear error state per stage with "Retry" |

---

## 16. Demo requirements

- Two RFx in the seeded account: **MER-0417 (completed)** and **MER-0418 (fresh, ready to issue)**.
- Live moment: issue MER-0418 in gmail mode; reply from the phone with the photographed rate card; watch extraction land.
- Mock moment: Load seeded responses on a third RFx to show the pipeline on all five formats in one go.
- Interviewer upload: any document → Response Detail shows classification and outcome.
- Q&A: run Q1–Q8 live; save Q5 as a scenario; generate memo; approve as Priya.
- Show Eval page and Settings (provider switch) at the end.

---

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Extraction quality on the photo | Core demo moment fails | Build V4 first; keep the printed card high-contrast; per-cell confidence and queue absorb misses honestly |
| Gemini structured output drifts on odd layouts | Wrong cells | Strict JSON schema; validation; unmatched bucket; eval page catches it |
| Gmail IMAP polling flaky on serverless | Live email demo stalls | Sync inbox button + mock mode as the fallback story; test the night before |
| Vercel function timeout | Pipeline stage dies | Stage-per-request design; retry; visible error |
| Time overrun | Missing features | Build order in document 4 with cut lines: scenarios and weighted award go before landed-cost cost-of-money; clarification loop before Laya; resend mode never |
| Jev unavailable (no key by design) | "Used Jev" claim impossible | Narrative is "Jev-compatible layer on Gemini"; provider switch shown |
| Interviewer uploads something adversarial | Crash | Classification gate; unmatched bucket; unsupported-type notice |

---

## 18. Competitive context (for the note and interview)

| Player | Relevant capability | Gap this product targets |
|---|---|---|
| Fairmarkit | Bid Analysis Agent over images/sheets/PDFs → award recommendations | Recommendation without visible uncertainty/provenance |
| Keelvar | Sourcing Optimizer — scenario analysis, award recommendations | Scenario concept borrowed; Keelvar assumes structured bids |
| Quotable AI | Parser "99% accuracy" from PDFs/emails/sheets | Accuracy claim without per-cell confidence |
| Pipefy | Quote extraction, side-by-side, audit trail | Audit trail table stakes |
| Zip, Levelpath, Oro | Intake orchestration | Different job |
| Coupa, Ariba, Jaggaer, Zycus | Vendor portals forcing templates | The opposite thesis; the brief rejects it |

Market gap: nobody shows the buyer what the system is not sure about, or traces a number to its source.

---

## 19. Decisions log (with reasons)

| Decision | Reason |
|---|---|
| Corrugated packaging | Brief's own example; richest unit ambiguity; easy to fabricate believably |
| Table-first UI with an Ask panel | Buyers trust grids; chat-only reads as "ChatGPT with upload" |
| Compute answers via SQL, show query | Brief forbids faked reasoning; trust criterion |
| Review queue as core scope | Directly answers "what does it show when it isn't sure" |
| Evidence-first cells | ₹4 crore trust criterion |
| Gemini for reading; Jev-compatible layer for deciding | Separates generation from judgement; matches the newest model class without paying for it |
| No agent framework | Time; debuggability; a published competitor submission used CrewAI and the graders have seen it |
| Gmail SMTP/IMAP for live email | Free; real; no domain |
| Mock mode with vendor portal | Seeded demo needs it; makes stub look like product |
| Two seeded users, no auth | Hours to extraction |
| Eval page | AI-native teams respect measurement; substitutes for DSPy at ~1/3 the cost |
| Category-agnostic schema | Interviewers may upload anything |
| Award memo as PDF | The artifact a buyer forwards; strongest trust signal |

---

## 20. Glossary (for non-technical readers)

| Term | Meaning here |
|---|---|
| RFx | Generic term for Request for Quotation/Proposal/Information — the buyer's ask to vendors |
| Line item | One product/SKU row in the RFx (e.g. "5-ply export carton 600×400×400") |
| Normalisation | Converting a vendor's number into the RFx's unit and currency so cells are comparable |
| Assumption | Any choice made during normalisation that could reasonably have gone another way (FX rate, pack size, discount treatment) |
| Provenance | The chain from a displayed number back to the exact place in the source document it came from |
| Confidence / probability | A number 0–1 expressing how sure the system is about a mapping or judgement |
| Review queue | The list of items the system wants a human to confirm before they count |
| Decision layer | The part of the system that answers typed questions (which line? yes/no? how well?) with probabilities, as opposed to reading documents or writing text |
| Jev / System One | TypeSafe AI's model class that returns typed decisions with calibrated probabilities instead of text; used here as an interface, with Gemini answering by default |
| Structured output | Asking a language model to reply in a fixed JSON shape so software can use the result |
| SMTP / IMAP | The protocols for sending (SMTP) and reading (IMAP) email from an account |
| Plus-alias | Gmail feature where `name+anything@gmail.com` delivers to `name@gmail.com` |
| Idempotent | Doing the same thing twice has the same effect as doing it once (no duplicates) |
| Landed cost | Unit price plus freight, taxes and other costs to get goods to the plant |
| Scenario | A saved allocation of lines to vendors under a stated rule, for comparison |
| Eval | An automated check of the system's outputs against a known-correct answer key |

---

*End of PRD. Next: document 2 — FSD/TRD.*
