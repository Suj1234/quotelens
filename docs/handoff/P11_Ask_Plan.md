# P11 — Ask: guardrails, reach, charts (build plan)

Agreed with the human on 2026-09-25, point by point (the Ask review). Tick each with evidence when done.
Rules: every number from a query or our code, never the model; the model picks, code calculates; no vendor-specific code;
every off-spec change goes in DECISIONS.md. No commit / deploy without the human's go.

## Backend
- [x] 1  Guardrail tiers in the analyst instruction: (a) this RFx's data → tools; (b) procurement / app terms → `explain_term`
         (fixed glossary from our own rules, then one query that ties it to this RFx); (c) data we don't have → say which;
         (d) anything else (code, poems, chat) → decline in one sentence + two questions it can answer. Test E20 (attacks).
- [x] 3  The SQL planner gets only the current conversation (from the analyst), not the user's last 4 stored questions.
- [x] 4  Answers with totals name any vendor discount they leave out: "Before vendor discounts: … not applied here; the
         Award tab shows the after-discount total." Code, from the discount ledger; any vendor, any RFx.
- [x] 5  Row limit 500 → 5,000 (`run_readonly_rows`); over the limit → "result too large", no total, no chart.
- [x] 6  Question limit per user: 30 per 10 minutes (Settings → General → Decision engine, editable, audited).
- [x] 8  `explain_cell(line, vendor)` tool: as written → conversion steps → final price, source, open cards.
- [x] 9  `what_if` tool: FX ±%, vendor price ±%, freight per vendor, drop a vendor, volume ±%, discounts off; on a
         saved scenario (same winners, re-priced) or cheapest per line (re-allocated). Pure, unit-tested.
- [x] 10 View `v_line_stats`: per line lowest, second, median, spread, qualified quotes, gap to runner-up.
- [x] 11 Views `v_messages` (who replied when, clarifications waiting) and `v_review_cards` (open / waiting / decided).
- [x] 18 P-SQL v7: column dictionary with units and allowed values; 5 generic patterns (window cheapest, rank delta,
         single-source, sensitivity, share). v6 archived.
- [x] 20 Say which meaning was used (unit vs landed, all vs qualified) and offer the other as a follow-up button.
- [x] 21 Reply in the user's language; numbers in Indian format.

## Frontend
- [x] 12 Charts: Recharts; grouped bars (line × vendor), 100% share bar, diverging bars (savings / rank change),
         heatmap table (% over line minimum); fixed colour per vendor, light + dark tokens. Code picks from the result's
         shape. Overrides DESIGN §2.15 (DECISIONS).
- [x] 13 `show_chart(answer_id, type)` tool: redraw an existing answer, no re-query.
- [x] 14 Click a row with line + vendor → the provenance drawer for that cell.
- [x] 15 Tables: sortable columns, sticky header, "₹ / 1000 pcs" on price columns.
- [x] 16 Follow-up buttons worked out from each answer (code, not the model).
- [x] 17 Stream the reply text as it is written (replaced by the checked reply at the end).

## Later / not doing
- Roadmap: 2 (server keeps the chat), 23 (thumbs up / down). Left open: 22 (Ask eval). Dropped: 7, 19.

## Status log
- 2026-09-25 — plan written; building.
- 2026-09-25 — all rows built and tested locally (E12 8/8, E20 8/8, E21 9/9, 139 unit tests); views named v_messages (not v_replies). Not committed.
