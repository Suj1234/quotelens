-- 0003_storage.sql — TRD §5 buckets (all private). Idempotent.
insert into storage.buckets (id, name, public) values
  ('raw', 'raw', false), ('derived', 'derived', false), ('outbound', 'outbound', false), ('seed', 'seed', false)
on conflict (id) do nothing;
