-- P2-T6: cleared_questionnaire semantics (TRD §8.5). The §6.21 view used bool_and(coalesce(passes, true)), which
-- counts an ambiguous or missing answer as a pass. Now, over the disqualifying questions:
--   false  if any answer fails, or a mandatory one is missing;
--   null   if any answer is still ambiguous (pending review), or nothing has been read yet;
--   true   otherwise.
-- Same columns as 0002, so create or replace is allowed.
create or replace view v_vendor_status with (security_invoker = true) as
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
       (select t.validity_until from responses rs join response_terms t on t.response_id=rs.id
          where rs.rfx_id=rv.rfx_id and rs.vendor_id=v.id order by rs.received_at desc limit 1) as validity_until,
       (select t.freight_included from responses rs join response_terms t on t.response_id=rs.id
          where rs.rfx_id=rv.rfx_id and rs.vendor_id=v.id order by rs.received_at desc limit 1) as freight_included
from rfx_vendors rv join vendors v on v.id=rv.vendor_id;
