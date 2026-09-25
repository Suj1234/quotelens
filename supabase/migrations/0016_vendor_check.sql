-- 0016_vendor_check.sql — "Is this reply really from this vendor?" (DECISIONS 2026-09-25 "Vendor check").
-- A review card when the document's issuer is another invited vendor / nobody we invited, when it is addressed to another
-- buyer, or when the same file already arrived from another vendor. The file fingerprint makes the last check a lookup.
alter table review_items drop constraint review_items_type_check;
alter table review_items add constraint review_items_type_check check (type in
  ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','questionnaire_missing','validity_short','not_a_quote','tax_basis','price_check','vendor_mismatch'));
alter table response_files add column if not exists sha256 text;
create index if not exists response_files_sha256 on response_files (sha256);
