-- 0002_views.sql — TRD §6.21, extracted verbatim
create view v_comparison as
select r.code as rfx_code, l.line_no, l.sku, l.description, l.ply, l.item_type, l.delivery_location,
       l.monthly_qty, l.annual_qty,
       v.name as vendor, v.short_code as vendor_code,
       q.state, q.unit_price_inr_per_1000 as unit_price, q.landed_price_inr_per_1000 as landed_price,
       q.original_value, q.original_unit, q.original_currency, q.mapping_probability,
       (q.unit_price_inr_per_1000 * l.annual_qty / 1000.0) as annual_value_unit,
       (q.landed_price_inr_per_1000 * l.annual_qty / 1000.0) as annual_value_landed,
       q.rfx_id, q.rfx_line_id, q.vendor_id
from line_quotes q
join rfx r on r.id = q.rfx_id
join rfx_lines l on l.id = q.rfx_line_id
join vendors v on v.id = q.vendor_id;

create view v_vendor_status as
select rv.rfx_id, v.id as vendor_id, v.name as vendor, v.short_code as vendor_code,
       rv.status, rv.disqualified_reason,
       (select count(*) from line_quotes q where q.rfx_id=rv.rfx_id and q.vendor_id=v.id and q.unit_price_inr_per_1000 is not null) as lines_priced,
       (select count(*) from rfx_lines l where l.rfx_id=rv.rfx_id) as lines_total,
       (select bool_and(coalesce(qa.passes,true)) from questionnaire_answers qa
          join rfx_questions rq on rq.id=qa.question_id
          where qa.rfx_id=rv.rfx_id and qa.vendor_id=v.id and rq.disqualify_if is not null) as cleared_questionnaire,
       (select t.validity_until from responses rs join response_terms t on t.response_id=rs.id
          where rs.rfx_id=rv.rfx_id and rs.vendor_id=v.id order by rs.received_at desc limit 1) as validity_until,
       (select t.freight_included from responses rs join response_terms t on t.response_id=rs.id
          where rs.rfx_id=rv.rfx_id and rs.vendor_id=v.id order by rs.received_at desc limit 1) as freight_included
from rfx_vendors rv join vendors v on v.id=rv.vendor_id;

create view v_questionnaire as
select qa.rfx_id, rq.q_no, rq.text as question, rq.answer_type, rq.disqualify_if,
       v.name as vendor, v.short_code as vendor_code,
       qa.answer_bool, qa.answer_number, qa.answer_text, qa.probability, qa.state, qa.passes
from questionnaire_answers qa join rfx_questions rq on rq.id=qa.question_id join vendors v on v.id=qa.vendor_id;

create view v_assumptions as
select a.rfx_id, a.kind, a.description, a.basis, a.made_by, a.created_at,
       v.name as vendor, l.line_no
from assumptions a left join vendors v on v.id=a.vendor_id left join rfx_lines l on l.id=a.rfx_line_id
where a.superseded_by is null;
create or replace function run_readonly_query(q text) returns jsonb
language plpgsql security definer as $$
declare result jsonb;
begin
  set local statement_timeout = '8000ms';
  set local transaction read only;
  execute 'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (' || q || ' limit 500) t' into result;
  return result;
end $$;

-- Lock-down (addition, see DECISIONS.md)
-- Views run with the caller's rights so they never bypass RLS for anon/authenticated.
alter view v_comparison set (security_invoker = true);
alter view v_vendor_status set (security_invoker = true);
alter view v_questionnaire set (security_invoker = true);
alter view v_assumptions set (security_invoker = true);
revoke all on v_comparison, v_vendor_status, v_questionnaire, v_assumptions from anon, authenticated;
-- "Grant execute to the service role only" (TRD §6.21)
alter function run_readonly_query(text) set search_path = public;
revoke execute on function run_readonly_query(text) from public, anon, authenticated;
grant execute on function run_readonly_query(text) to service_role;
