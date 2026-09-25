-- 0018_vendor_status_hold.sql — a vendor whose own reply waits on the vendor check (0016) has not cleared the questionnaire
-- yet: its answers came from that reply, which may be another vendor's file (MER-0424: OrientPack's reply was Sri Balaji's
-- quote, so OrientPack showed ✓ on Balaji's answers). Same rule as heldVendors() in src/lib/comparison.ts.
-- Same columns in the same order as 0007, so create or replace is allowed.
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
                 when exists (select 1 from review_items ri join responses rs on rs.id = ri.response_id
                              where ri.rfx_id = rv.rfx_id and ri.vendor_id = v.id and ri.type = 'vendor_mismatch'
                                and ri.status in ('open', 'asked_vendor') and not rs.is_clarification) then null
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
