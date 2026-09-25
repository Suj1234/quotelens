# P10 — Review, pricing and vendor conditions (build plan)

Agreed with the human on 2026-09-25, point by point. Every item here was discussed; tick it with evidence when done.
Rules: real prices everywhere; the AI reads and judges, code calculates, the buyer decides; no vendor-specific code;
every off-spec change goes in DECISIONS.md.

## Phase 1 — Settings: keep only company policy
- [x] S1 Remove "Total-level discounts (gross/net)": schema, defaults, Settings card, normalise.
- [x] S2 Remove "Freight default ₹180": a vendor who says "freight extra" without an amount gets "freight not stated"
      (landed price = unit price, marked), and the freight card asks the buyer (Change for vendor) or the vendor (Ask).
- [x] S3 Remove "Cost of money" (dead: shows "not in this build") and the unused `landed_cost` key.
- [x] S4 Move the ₹/kg band of the price check into the category template; the 2× median stays global.

## Phase 2 — Discounts and vendor conditions
- [x] D1 Grid, totals and Ask show real prices: a total-level discount is never taken off line prices.
      (Kept: rates printed net of a discount we won't earn are grossed up — generic, condition-checked.)
- [x] D2 The AI sorts each discount's condition: all lines awarded · at least N lines · at least ₹X · payment within N days ·
      no condition · unclear (→ card). Stored on the vendor's discount ledger row.
- [x] D3 Every award option applies a vendor's discount only when its condition is met by the lines that vendor wins.
- [x] D4 Decide, Award, scenarios and the memo show both totals side by side with the condition line
      ("Sri Balaji Packaging −3%: met — all 30 lines" / "not met — 16 of 30"), including an everything-to-one-vendor option.
- [x] D5 Vendor conditions visible: chips in the Comparison column header and the Overview vendor row; hover lists all of
      them (validity, discount + condition, freight, GST, payment, MOQ / other notes, item 12 conditions).
- [x] D6 Validity at award: warn when a winning vendor's quote expires before approval, with Ask vendor to extend.

## Phase 3 — Review tab: four buttons
- [x] B1 Every card: Accept · Change… · Ask vendor… · Exclude…, by the four rules (Accept only with a suggestion; Change
      always where there is something to change; Ask only if the vendor can answer; Exclude only if leaving it out makes
      sense). No "Change in settings" link.
- [x] B2 The 14 gaps from scripts/test-four-buttons.ts:
      1 mismatch Change (move the reply to its real vendor) · 2 mismatch Ask · 3 discount Change (% / condition) ·
      4 discount Ask · 5 FX Change (rate for this vendor) · 6 FX Ask · 7 freight Ask · 8 GST Change (incl./excl.) ·
      9 GST Ask · 10 questionnaire-missing Change (type the answer) · 11 validity Ask · 12 lines-not-quoted Change
      (type prices) · 13 lines-not-quoted Ask · 14 two-prices Ask.
- [x] B3 Fix the Ask vendor bug: the draft check wanted bare "3" where the AI rightly wrote "Q3".
- [x] B4 Groups: Replies to sort · Prices to check · Not quoted · Line matching · Numbers we filled in · Vendor conditions ·
      Questionnaire — the same on Overview (the "Assumptions" row becomes "Numbers we filled in", full vendor names).
- [x] B5 Reliability grade on every number we filled in: A vendor-stated · B our spec / official rate · C buyer-entered ·
      D default or AI inference. Only D needs a card; A–C are in the ledger.

## Phase 4 — Safety nets for cases nobody wrote a check for
- [x] C12 The extractor also lists anything else in the quote that changes the price or the comparison (MOQ, tooling,
      "sizes are inside dimensions", delivery terms) → a "vendor condition" card each, and in the hover (D5).
- [x] C13 Totals check: the vendor's own grand total vs the sum of its line prices × quantities → a card when they differ.

## Phase 5 — Proof
- [ ] T0 Re-process the existing RFx so stored prices follow the new rules (Balaji's cells were stored 3% off; ₹180 freight rows).
      Needs the human's go (changes live RFx data): scripts/reprocess.ts MER-0419 MER-0422 MER-0423 MER-0424.
- [x] T1 scripts/test-four-buttons.ts: every shown button PASS (target 48/48 on the kinds that occur; no GAP, no FAIL).
- [x] T2 scripts/test-vendor-check.ts (10 genuine replies, 0 false alarms; both wrong-vendor cases held) and scripts/test-review-actions.ts pass; 123 unit tests green; tsc + lint clean.
- [x] T3 Discount test: Balaji all-30 option gets −3%, the split doesn't (MER-0419 numbers: ₹4.45 cr vs ₹4.53 cr).
- [ ] T4 Browser pass: Settings, Comparison header hover, Review cards, Decide / Award totals.
      2026-09-25: Comparison, Review, Decide render with no app console errors; numbers on live RFx are stale until T0
      (Anand freight card still says ₹180; Balaji cells still stored 3% off). Re-check after T0.
- [ ] T5 DECISIONS.md + PROGRESS.md.
