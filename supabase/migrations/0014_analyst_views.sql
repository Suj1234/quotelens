-- 0014_analyst_views.sql — P9 C1: two read-only views so the analyst agent can answer questions about vendor documents
-- ("which vendors sent an ISO certificate?") and vendor terms ("what payment terms did Kohinoor offer?") with the same
-- guarded SQL path as the comparison (sql-guard allowlist + run_readonly_rows).

-- One row per file a vendor sent on an RFx, with what the classifier decided it is and its one-line caption/reason.
create view v_documents with (security_invoker = true) as
select rs.rfx_id, v.name as vendor, v.short_code as vendor_code,
       f.original_name as file_name, f.mime, f.page_count,
       coalesce(f.file_kind, 'unknown') as kind,   -- quotation | questionnaire | supporting | not_relevant | unknown
       f.classify_reason as caption,
       rs.source, rs.is_clarification, rs.received_at
from response_files f
join responses rs on rs.id = f.response_id
left join vendors v on v.id = rs.vendor_id;
revoke all on v_documents from anon, authenticated;

-- One row per vendor on an RFx: the terms from its main reply (most grid cells, then latest — the v_vendor_status rule).
create view v_vendor_terms with (security_invoker = true) as
with main as (
  select distinct on (rs.rfx_id, rs.vendor_id) rs.rfx_id, rs.vendor_id, t.*
  from responses rs
  join response_terms t on t.response_id = rs.id
  where rs.vendor_id is not null
  order by rs.rfx_id, rs.vendor_id,
           (select count(*) from line_quotes q where q.response_id = rs.id) desc, rs.received_at desc
)
select rv.rfx_id, v.name as vendor, v.short_code as vendor_code,
       m.currency, m.payment_days, m.payment_terms_raw, m.validity_days, m.validity_until,
       m.freight_included, m.freight_terms_raw, m.taxes_included, m.tax_terms_raw,
       m.total_discount_pct, m.total_discount_condition,
       m.references_prior_pricing, m.references_prior_pricing_text, m.other_notes
from rfx_vendors rv
join vendors v on v.id = rv.vendor_id
left join main m on m.rfx_id = rv.rfx_id and m.vendor_id = rv.vendor_id;
revoke all on v_vendor_terms from anon, authenticated;
