-- 0007_vendor_status_validity.sql — P4-T2: v_vendor_status for the Ask panel.
-- (1) validity_until was only the date a vendor printed; most replies give days ("valid 30 days"), so the view now
--     falls back to received date + validity_days, and exposes validity_days as a new last column.
-- (2) terms come from the vendor's main reply (the one that supplied most of its grid cells), then the latest —
--     the same rule as the grid header (DECISIONS P3-T5 e), so a stray second file can't relabel a vendor.
-- Same columns in the same order as 0004 plus one appended, so create or replace is allowed.
create or replace view v_vendor_status with (security_invoker = true) as
with main as (
  select distinct on (rs.rfx_id, rs.vendor_id) rs.rfx_id, rs.vendor_id, rs.received_at,
         t.validity_days, t.validity_until, t.freight_included
  from responses rs
  join response_terms t on t.response_id = rs.id
  where rs.vendor_id is not null
  order by rs.rfx_id, rs.vendor_id,
           (select count(*) from line_quotes q where q.response_id = rs.id) desc, rs.received_at desc
)
select rv.rfx_id, v.id as vendor_id, v.name as vendor, v.short_code as vendor_code,
       rv.status, rv.disqualified_reason,
       (select count(*) from line_quotes q where q.rfx_id=rv.rfx_id and q.vendor_id=v.id and q.unit_price_inr_per_1000 is not null) as lines_priced,
       (select count(*) from rfx_lines l where l.rfx_id=rv.rfx_id) as lines_total,
       (select case
                 when count(*) = 0 then null
                 when bool_or(qa.passes = false or (qa.state = 'missing' and rq.mandatory)) then false
                 when bool_or(qa.state = 'ambiguous') then null
                 else true end
          from questionnaire_answers qa
          join rfx_questions rq on rq.id=qa.question_id
          where qa.rfx_id=rv.rfx_id and qa.vendor_id=v.id and rq.disqualify_if is not null) as cleared_questionnaire,
       coalesce(m.validity_until, (m.received_at at time zone 'Asia/Kolkata')::date + m.validity_days) as validity_until,
       m.freight_included,
       m.validity_days
from rfx_vendors rv
join vendors v on v.id = rv.vendor_id
left join main m on m.rfx_id = rv.rfx_id and m.vendor_id = rv.vendor_id;
