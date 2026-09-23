# Demo Script and Recording Plan — QuoteLens
## Document 5 of 6

| Field | Value |
|---|---|
| Version | 1.0 — draft written before the build; revise numbers after P8 |
| Depends on | 01 PRD §13, §16 · 03 Dataset Pack §11 · 04 Build Plan §10 (demo gate) |
| Two uses | (A) the recorded walkthrough (Loom, 12–15 min) · (B) the live interview demo the interviewers drive (25–40 min) |

---

## 0. What the demo must prove (the grading criteria, in demo form)

| Criterion | The moment that proves it |
|---|---|
| The AI loops are real | A file dragged in live goes through classify → extract → map → normalise on screen; a document the interviewer supplies does the same |
| Ugly edges | Six specific cells: Westline item 9 (ambiguous → wrong guess avoided), OrientPack line 14 (obscured), Kohinoor footnote (printed ≠ payable), Anand per-kg + "same as last year", Kohinoor 27/30, OrientPack USD |
| Trust | Click any number → source; Ask → SQL shown; ledger; memo |
| Judgment | The one-line answers to "why did you…" in §6 |

Everything below is timed. Practise it twice before recording.

---

## 1. Setup state before recording / interview

- Production URL open in a clean browser profile, logged out. Second tab: the second Gmail inbox (the "vendors"). Phone: camera app, the printed OrientPack card with your pen note on the desk.
- RFx state: **MER-0417** completed and approved (realistic set). **MER-0419** seeded with the clean set, pipeline run, **review queue NOT cleared** (that's the demo). **MER-0418** draft with lines and vendors, not issued.
- Files on the desktop in a folder `demo-extras/`: `wrong_category_IT_quote.xlsx`, `whatsapp_quote_sunrise_packers.png`, `balaji_revised_offer_email.txt`, `westline_clarification_reply.txt`, `OrientPack_Product_Brochure.pdf`.
- Settings: email mode = **gmail** (with mock as fallback), decision provider = **auto** (Gemini, since no OpenRouter key).
- Close everything else. Zoom the browser to 110%.

---

## 2. Recorded walkthrough — 13 minutes, scripted

Record in one take if possible; two cuts maximum (after 2.4 and after 2.7). Speak in first person, present tense, no "as you can see".

### 2.1 Cold open (0:00–0:40) — on the RFx list
"This is QuoteLens. Thirty line items, five vendors, five formats — an Excel that ignored our template, a PDF with the discount in a footnote, a Word letter with prices in paragraphs, a photo of a rate card, and an email that says 'rest same as last year'. I'm going to show you how it reads them, what it does when it's not sure, and how a VP gets to a defensible award without opening Excel."

### 2.2 The RFx in 60 seconds (0:40–1:40) — open MER-0418 (draft)
- Show the co-pilot transcript already there (or type one line: "Standard terms, 12 months, both plants" → terms fill).
- Click Lines tab: 30 lines with specs and weight per piece. "Weight per piece matters later — one vendor quotes per kilogram."
- Questionnaire tab: point at Q1 and Q6 marked disqualifying.
- Do **not** issue yet. "I'll issue this one live at the end."

### 2.3 Watch it read (1:40–3:40) — MER-0419, Response Detail for Kohinoor
- Open Kohinoor's response. Files: quotation PDF (badge "quotation, 0.97"), company profile ("supporting"). "The classifier sorted the brochure out before any extraction ran."
- Pipeline strip: six stages, timings. Click **Retry** on Extract so it runs live on camera (20–40 s). While it runs: "This is a real call on the actual PDF. Nothing here is cached."
- Extracted items table: point at item 17 (the corrected price) and the terms card: `references footnote: rates net of 2.5% early-payment discount`. "It read the footnote. Most buyers don't."

### 2.4 The comparison and the ugly cells (3:40–6:40) — Comparison, Prices tab
- Legend first: eight states. "Grey is not quoted, amber is ambiguous, red-dot is low confidence, striped is 'references prior pricing'."
- Column headers: Kohinoor "27/30 · valid to 29 Oct · ✓ cleared"; Westline "✗ BRC"; OrientPack "USD · freight extra"; Anand "22/30 · freight extra".
- Click **Westline line 9** → drawer. "Vendor gave a price per bundle and didn't say how many per bundle. The pattern says 25. The system refused to guess silently — it's amber, with the guess shown, and an 'Ask vendor' button."
- Click **OrientPack line 14** → drawer shows the crop of the photo with the thumb over the price. "Read as 0.32-something with 40% confidence. It's in the queue, not in the total."
- Click **Kohinoor line 3** → conversion chain: printed 35,970 → ÷ 0.975 → 36,892 "because we pay at 45 days, not 10. That's a ₹11 lakh difference across the year, and it's in the ledger with the footnote quoted."
- Click **Anand line 1** → chain: ₹42/kg × 1,318 g = ₹55,360. "Cheapest column by far — because the weight came from *our* spec, not theirs. That's an assumption, so it's marked inferred."
- Toggle **Landed cost**: OrientPack and Anand move. "Freight assumption per vendor, editable, in the ledger."

### 2.5 The review queue and the vendor loop (6:40–8:40)
- Open Review Queue, filter Westline. Confirm items 5 and 15 ("bundle of 25 and 50 — consistent with everything else they wrote"). For item 9 click **Ask vendor** → drafted email appears listing items 9 and 19 → Send (gmail mode; or shows in Outbox).
- Switch to the Gmail tab, show the email arrived, reply by pasting `westline_clarification_reply.txt`, send.
- Back in the app: **Sync inbox** → new response "clarification" → pipeline runs on affected lines only → items 9 and 19 turn `reviewed`: bundle 20 and 40. "The guess would have been wrong by 25% on line 9. Asking cost one email."
- Confirm OrientPack line 14 with the value from your printed card (you can read it; the camera couldn't). Bulk-acknowledge FX and freight assumptions.

### 2.6 Priya asks questions (8:40–11:40) — switch user to Priya, Ask panel
Type these exactly; wait for each answer; read the "How I computed this" line aloud once.
1. "Cheapest vendor per line, only among vendors who cleared the quality questionnaire." → table, total, exclusions (Westline ✗ BRC; Anand not cleared — Q6 pending). Click **Show query**. "It wrote SQL over the normalised table and ran it. The model never eyeballed the grid."
2. "What does that save versus giving everything to Kohinoor?" → number + bar.
3. "Which lines have only one qualified quote?" → the three partition lines + any others.
4. "Split 5-ply to the cheapest qualified vendor and 3-ply to whoever is cheapest overall — better or worse?" → two totals; click **Save as scenario** "Split by ply".
5. "Which cells are you not sure about and how much money rides on them?" → list with value at stake.
6. "Why is Anand's 5-ply so cheap?" → answer must mention per-kg and the weight assumption.
7. "Export the first answer as Excel." → file downloads; open it for two seconds.

### 2.7 Award (11:40–12:40) — Scenarios → Award
- Scenarios page: "Cheapest qualified" vs "Split by ply" side by side.
- Pick one → override line 22 to Kohinoor "incumbent tooling" → **Generate award memo** → open PDF, scroll: allocation, exclusions, ledger, open items, the rule. "This is what goes to the CFO. Every number in it has a source."
- Approve as Priya → RFx locks.

### 2.8 Close (12:40–13:10) — Eval page, then Settings
- Eval: "143 of 150 cells right or honestly flagged on the seed set; the seven misses are listed. I'd rather show you the misses than claim 99%."
- Settings: decision provider "Gemini (LLM-estimated) — Jev via OpenRouter when a key is present". One sentence: "Reading and deciding are separate layers; the decider is built to Jev's typed-decision interface and runs on Gemini here."
- "The interesting problem wasn't the parsing. It was that two buyers normalise the same five quotes differently, silently. This makes that explicit." Stop.

---

## 3. Live interview demo — 25–40 minutes, interviewer-driven

You don't control the order. Prepare **stations** you can jump to from any question.

| If they say… | Go to | Do |
|---|---|---|
| "Show me it reading something" | MER-0419 Inbox | Drag the Kohinoor PDF (or their file) → Response Detail → watch stages |
| "Can I upload my own?" | Inbox, any vendor | Take their file; narrate classification; if wrong category → Unmatched panel |
| "What if it's not sure?" | Review Queue | Westline 9, OrientPack 14 |
| "How do I trust this number?" | Comparison → any cell | Drawer: source → mapping → chain → ledger |
| "Ask it something" | Ask panel as Priya | Hand them the keyboard; let them type; read the SQL |
| "What about email — is it real?" | MER-0418 | Issue in gmail mode → show the inbox → reply from phone with the photo → Sync |
| "How accurate is it?" | Eval page | Number + per-cell diff; explain flagged_ok |
| "Why not force a template?" | — | §6 answer |
| "Why Gemini / what's this Jev thing?" | Settings + Logs | Provider per call; the split between reading and deciding |
| "What happens with a second quote from the same vendor?" | Inbox | Paste `balaji_revised_offer_email.txt` → conflict items for 7, 16, 23 |
| "What about WhatsApp?" | Inbox | Drop the screenshot → unknown vendor → assign/create → 8 lines |

### Live-run sequence (if they let you drive for 10 minutes)
1. Issue MER-0418 (gmail) — 1 min.
2. Show five emails in the vendor inbox — 30 s.
3. Reply as Balaji with the realistic xlsx from the laptop; reply as OrientPack from the phone with the photographed card — 2 min.
4. Sync → two responses → pipeline — 2 min.
5. Comparison → the two columns fill; the photo's line 14 goes to the queue — 1 min.
6. One question in Ask — 1 min.

### Recovery paths
| Failure | Do |
|---|---|
| Gmail sync stalls | Settings → email mode mock → Inbox → upload the same file. Say: "transport is swappable; the pipeline is identical" |
| Gemini timeout on a stage | Click Retry once; if it fails again, open the same vendor on MER-0417 (completed) and continue |
| A cell reads wrong live | Don't hide it. Open the drawer, show the evidence, override with reason. "This is the product working — it showed me the source" |
| Interviewer's file is huge/odd | Let it classify; if `not relevant`, show the Documents tab and explain the gate |
| Ask panel produces a bad query | Show the SQL, say why it's wrong, rephrase once. Do not retype the answer manually |

---

## 4. The eight questions — expected shape and what to watch for

| # | Question | Expect | Watch |
|---|---|---|---|
| Q1 | Cheapest per line among cleared vendors | 30 rows; Balaji/Kohinoor/OrientPack winning; total ≈ ₹4.3–4.5 cr; exclusions list Westline (Q6 No) and Anand (Q6 pending); 1–4 cells excluded as unsure | The exclusions note must name the *reason* per vendor |
| Q2 | Savings vs all-to-Kohinoor | Kohinoor can't take lines 28–30 → answer must say so and either exclude or compare on 27 lines | Baseline logic in §13.5 of TRD |
| Q3 | Single qualified quote lines | Lines 28–30 (Kohinoor out, Westline disqualified, Anand prior) → likely only Balaji/OrientPack; count ≥ 3 | If zero, questionnaire states are wrong |
| Q4 | Landed cost ranking change | OrientPack loses on several lines | Freight assumption visible in note |
| Q5 | Split by ply | Two totals; save scenario | Scenario name prompt |
| Q6 | Unsure cells and money at stake | Westline 5/9/15/19 (before clarification), OrientPack 14, Anand 23–30; ₹ at stake = best_guess × annual qty | After clarification, list shrinks — good talking point |
| Q7 | OrientPack FX assumption, ±3% | Ledger entry 83.15 on 23 Sep; sensitivity ≈ ±₹14 lakh on their column | Must not recompute from memory; runs a query with rate × 1.03 |
| Q8 | Export Q1 as Excel | File | Opens cleanly |

---

## 5. Recording logistics

- Tool: Loom (desktop app), 1080p, mic on, camera bubble small or off.
- Length: 12–15 minutes. Do not exceed 15; interviewers won't.
- Title: "QuoteLens — Meridian Foods RFx MER-0417 walkthrough (13 min)".
- First frame must show the app, not your desktop.
- Speak slower than feels natural. Pause 2 seconds after every click that triggers a model call — the wait is the proof it's live.
- After recording: watch it once at 1.5× and note timestamps for the README ("2:10 footnote read; 5:05 obscured cell; 9:00 SQL shown").
- Deliverables: the Loom link, the production URL, the repo link, the one-page note (PDF), plus the login (Sujit / Priya) and the password in the submission email.

---

## 6. One-line answers to the predictable questions

| Question | Answer |
|---|---|
| Why not force vendors into a template? | Vendors already ignore templates; the brief says so. Reading what they send is the product; a template is the buyer's cost pushed to the vendor and then back. |
| Why a grid and not a chat? | Buyers sign off on grids. Chat is the question layer over the grid, not the surface. |
| Why show uncertainty instead of a best answer? | Because ₹4 crore rides on it and a wrong silent guess is undetectable. Westline line 9 would have been 25% wrong. |
| Why SQL for answers? | The brief forbids faked reasoning. A query is verifiable; a paragraph from a model is not. |
| What does the model actually decide? | Which document is a quote, which line an item maps to, yes/no on questionnaire answers. Never arithmetic, never prices — those are computed. |
| What's the Jev bit? | A decision-model interface (typed questions in, probabilities out). It runs on Gemini here; a key switches it to TypeSafe's Jev. Reading and deciding are separate on purpose. |
| Why no agent framework? | A sequence of typed calls is easier to debug and to explain. Frameworks add a runtime, not a capability, for this problem. |
| Why Gmail for email? | Real transport at zero cost. The webhook version (Resend) is a code path, not a rewrite. |
| What broke while building? | Answer honestly from `PROGRESS.md` — the photo, the prose extraction, the footnote — and what you changed. |
| What would you build next? | Prior-contract memory so "same as last year" resolves; vendor-side portal that shows them what we extracted so they correct it; calibrating the decision layer on real accepted/rejected mappings. |
| Where was the interesting problem? | Not parsing — normalisation. Two buyers, same five quotes, different spreadsheets. The ledger makes that explicit. |

---

## 7. Pre-recording checklist (tick all)

- [ ] Demo gate in Build Plan §10 passes.
- [ ] MER-0419 review queue is open (not cleared) — reseed if you cleared it during practice.
- [ ] Westline clarification not yet sent on MER-0419.
- [ ] Second Gmail inbox open and empty of old demo mail (archive it).
- [ ] Phone charged, printed card on desk, pen note written.
- [ ] Practised 2.4 and 2.6 twice; timings within ±30 s.
- [ ] Notifications off; browser zoom 110%; dark mode off (PDF thumbnails read better).

---

*End of Demo Script. Next: document 6 — One-page Note (written after the build).*
