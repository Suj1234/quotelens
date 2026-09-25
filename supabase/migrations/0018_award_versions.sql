-- 0018_award_versions.sql — memo history (DECISIONS 2026-09-25 "Memo history").
-- One row per drafted memo: its content and PDF, and what the approver did with it (sent back with a note, or approved).
-- awards keeps the current memo; drafting again adds a version instead of losing the previous one.
-- memo_json / memo_path are empty for versions drafted before this table existed (rebuilt from the audit trail: their content was overwritten).
create table if not exists award_versions (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references awards(id) on delete cascade,
  rfx_id uuid not null references rfx(id) on delete cascade,
  version int not null,
  scenario_id uuid,                         -- no FK: the option may be deleted later; the name below stays
  scenario_name text,
  total_inr numeric,
  memo_json jsonb,
  memo_path text,                           -- bucket 'outbound'
  prepared_by uuid references users(id), prepared_at timestamptz,
  sent_back_note text, sent_back_by uuid references users(id), sent_back_at timestamptz,
  approved_by uuid references users(id), approved_at timestamptz,
  created_at timestamptz default now(),
  unique (award_id, version)
);
create index if not exists award_versions_rfx on award_versions (rfx_id);
alter table award_versions enable row level security;
