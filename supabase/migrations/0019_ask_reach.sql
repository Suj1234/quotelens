-- 0019_ask_reach.sql — P11 (docs/handoff/P11_Ask_Plan.md #5, #10, #11): Ask reads up to 5,000 rows (one more is fetched so the
-- app can tell the result was cut), per-line price statistics, the messages on an RFx and its review cards. Same guarded SQL
-- path as the other analyst views (sql-guard allowlist + run_readonly_rows); no grants to anon / authenticated.

create or replace function run_readonly_rows(q text) returns json
language plpgsql security definer set search_path = public as $$
declare result json;
begin
  set local statement_timeout = '8000ms';
  set local transaction read only;
  execute 'select coalesce(json_agg(t), ''[]''::json) from (select * from (' || q || ') as q_ limit 5001) t' into result;
  return result;
end $$;
revoke execute on function run_readonly_rows(text) from public, anon, authenticated;
grant execute on function run_readonly_rows(text) to service_role;

-- One row per RFx line: the spread of counted prices (confirmed / inferred / reviewed, unit price), who is lowest and second,
-- and the same among vendors who cleared the questionnaire. Unsure cells are not prices, as everywhere else.
create view v_line_stats with (security_invoker = true) as
with p as (
  select c.rfx_id, c.line_no, c.vendor, c.unit_price as price, (s.cleared_questionnaire is true) as cleared,
         row_number() over (partition by c.rfx_id, c.line_no order by c.unit_price, c.vendor) as rk,
         row_number() over (partition by c.rfx_id, c.line_no, (s.cleared_questionnaire is true) order by c.unit_price, c.vendor) as qrk
  from v_comparison c
  join v_vendor_status s on s.rfx_id = c.rfx_id and s.vendor_id = c.vendor_id
  where c.state in ('confirmed', 'inferred', 'reviewed') and c.unit_price is not null
)
select l.rfx_id, l.line_no, l.description, l.ply, l.item_type, l.annual_qty,
       count(p.price) as quotes,
       count(p.price) filter (where p.cleared) as qualified_quotes,
       min(p.price) as lowest_price,
       max(p.vendor) filter (where p.rk = 1) as lowest_vendor,
       max(p.price) filter (where p.rk = 2) as second_price,
       max(p.vendor) filter (where p.rk = 2) as second_vendor,
       percentile_cont(0.5) within group (order by p.price) as median_price,
       max(p.price) as highest_price,
       round((max(p.price) - min(p.price)) / nullif(min(p.price), 0) * 100, 1) as spread_pct,
       round((max(p.price) filter (where p.rk = 2) - min(p.price)) / nullif(min(p.price), 0) * 100, 1) as gap_to_second_pct,
       min(p.price) filter (where p.cleared) as lowest_qualified_price,
       max(p.vendor) filter (where p.cleared and p.qrk = 1) as lowest_qualified_vendor,
       min(p.price) * l.annual_qty / 1000.0 as lowest_annual_value
from rfx_lines l
left join p on p.rfx_id = l.rfx_id and p.line_no = l.line_no
group by l.rfx_id, l.line_no, l.description, l.ply, l.item_type, l.annual_qty;
revoke all on v_line_stats from anon, authenticated;

-- One row per email on an RFx, both ways (our RFx / clarification emails, vendor replies). No bodies: who, what, when.
create view v_messages with (security_invoker = true) as
select c.rfx_id, v.name as vendor, v.short_code as vendor_code, c.direction, c.kind, c.subject, c.status,
       c.sent_at, c.received_at, jsonb_array_length(c.attachments) as attachments
from communications c
left join vendors v on v.id = c.vendor_id;
revoke all on v_messages from anon, authenticated;

-- One row per review card. status: open | asked_vendor (waiting on the vendor) | confirmed | overridden | excluded |
-- resolved_by_reply | dismissed.
create view v_review_cards with (security_invoker = true) as
select r.rfx_id, v.name as vendor, v.short_code as vendor_code, l.line_no, r.type, r.title, r.status, r.created_at, r.updated_at
from review_items r
left join vendors v on v.id = r.vendor_id
left join rfx_lines l on l.id = r.rfx_line_id;
revoke all on v_review_cards from anon, authenticated;
