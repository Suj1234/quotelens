-- Review item type for a vendor whose mandatory questionnaire answers are missing (e.g. questionnaire not returned).
-- Such a vendor is "not cleared" in v_vendor_status (0004); the card lets the buyer ask for it.
alter table review_items drop constraint review_items_type_check;
alter table review_items add constraint review_items_type_check check (type in
  ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','questionnaire_missing','validity_short','not_a_quote'));
