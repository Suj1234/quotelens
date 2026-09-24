-- 0013_rfx_tax_basis.sql — P9 (human, 2026-09-25): the RFx states how prices must treat GST, so every vendor quotes on the
-- same basis. Default: prices exclusive of GST, rate stated separately (the Indian B2B norm; every seed vendor quotes this way).
alter table rfx add column if not exists tax_basis text not null default 'excl_gst' check (tax_basis in ('excl_gst', 'incl_gst'));

-- Review card when a vendor's tax terms contradict the RFx basis (flags stage).
alter table review_items drop constraint review_items_type_check;
alter table review_items add constraint review_items_type_check check (type in
  ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','questionnaire_missing','validity_short','not_a_quote','tax_basis'));
