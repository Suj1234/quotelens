-- 0017_conditions_totals.sql — P10 (docs/handoff/P10_Review_Pricing_Plan.md).
-- C12: anything else a vendor attached to its prices (MOQ, tooling, spec notes), as the extractor listed it.
-- C13: the vendor's own grand total, to check against the sum of its lines.
alter table response_terms add column if not exists conditions jsonb;           -- [{text, kind: moq|tooling|spec|delivery|price_basis|other}]
alter table response_terms add column if not exists stated_total numeric;       -- as written, in stated_total_currency
alter table response_terms add column if not exists stated_total_currency text;
-- B2: the buyer's per-vendor corrections from the review card, read again by every re-run of normalise.
alter table rfx_vendors add column if not exists fx_rate_override numeric;       -- this vendor's rate instead of the company table
alter table rfx_vendors add column if not exists gst_adjust_pct numeric;         -- +18 = add GST to reach an incl.-GST RFx; −18 = take it out
-- New review cards: a vendor condition (C12) and a total that doesn't match the lines (C13).
alter table review_items drop constraint review_items_type_check;
alter table review_items add constraint review_items_type_check check (type in
  ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','questionnaire_missing','validity_short','not_a_quote','tax_basis','price_check','vendor_mismatch','vendor_condition','total_mismatch'));
