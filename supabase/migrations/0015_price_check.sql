-- 0015_price_check.sql — P9 D1: review card "check unit" when a price is far from the other vendors' median for the line or
-- implies an unusual ₹/kg (thresholds in settings.price_check). The cell keeps its state; the card asks the buyer.
alter table review_items drop constraint review_items_type_check;
alter table review_items add constraint review_items_type_check check (type in
  ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','questionnaire_missing','validity_short','not_a_quote','tax_basis','price_check'));
