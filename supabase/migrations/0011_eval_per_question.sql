-- P8: the Eval page lists questionnaire mismatches from the stored run (TRD §17.14), and the Model calls
-- section reads the newest calls first (TRD §17.15).
alter table eval_runs add column if not exists per_question jsonb not null default '[]'::jsonb;
create index if not exists model_calls_created_at_idx on model_calls (created_at desc);
create index if not exists eval_runs_rfx_ran_at_idx on eval_runs (rfx_id, ran_at desc);
