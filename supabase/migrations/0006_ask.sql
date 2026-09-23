-- 0006_ask.sql — P4-T2 query layer (TRD §13.2, §13.4)

-- "Include best guesses": v_comparison with the system's best guess folded into the price columns, state untouched.
-- Landed best guess = best guess + the vendor's freight add-on seen on its priced cells (0 when freight is included).
create view v_comparison_bestguess with (security_invoker = true) as
select r.code as rfx_code, l.line_no, l.sku, l.description, l.ply, l.item_type, l.delivery_location,
       l.monthly_qty, l.annual_qty,
       v.name as vendor, v.short_code as vendor_code,
       q.state,
       coalesce(q.unit_price_inr_per_1000, q.best_guess_value) as unit_price,
       coalesce(q.landed_price_inr_per_1000, q.best_guess_value + coalesce(f.freight, 0)) as landed_price,
       q.original_value, q.original_unit, q.original_currency, q.mapping_probability,
       (coalesce(q.unit_price_inr_per_1000, q.best_guess_value) * l.annual_qty / 1000.0) as annual_value_unit,
       (coalesce(q.landed_price_inr_per_1000, q.best_guess_value + coalesce(f.freight, 0)) * l.annual_qty / 1000.0) as annual_value_landed,
       q.rfx_id, q.rfx_line_id, q.vendor_id
from line_quotes q
join rfx r on r.id = q.rfx_id
join rfx_lines l on l.id = q.rfx_line_id
join vendors v on v.id = q.vendor_id
left join (
  select rfx_id, vendor_id, max(landed_price_inr_per_1000 - unit_price_inr_per_1000) as freight
  from line_quotes group by rfx_id, vendor_id
) f on f.rfx_id = q.rfx_id and f.vendor_id = q.vendor_id;
revoke all on v_comparison_bestguess from anon, authenticated;

-- Same guarded execution as run_readonly_query (0002), with two differences:
--   * returns json, not jsonb, so each row keeps the query's column order (jsonb sorts keys);
--   * the query is wrapped as a subquery, so a query with its own LIMIT still gets the 500-row cap.
create or replace function run_readonly_rows(q text) returns json
language plpgsql security definer set search_path = public as $$
declare result json;
begin
  set local statement_timeout = '8000ms';
  set local transaction read only;
  execute 'select coalesce(json_agg(t), ''[]''::json) from (select * from (' || q || ') as q_ limit 500) t' into result;
  return result;
end $$;
revoke execute on function run_readonly_rows(text) from public, anon, authenticated;
grant execute on function run_readonly_rows(text) to service_role;
