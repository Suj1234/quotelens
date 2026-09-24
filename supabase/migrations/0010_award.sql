-- 0010_award.sql — P7: what TRD §6.18 / §6.20 lack for scenarios and the award (DECISIONS P7).
-- (1) Send back (DESIGN §3.9): the approver returns a drafted memo with a note. TRD's awards.status has only
--     draft/approved, so a third status plus who/when/why.
alter table awards drop constraint if exists awards_status_check;
alter table awards add constraint awards_status_check check (status in ('draft','sent_back','approved'));
alter table awards add column if not exists sent_back_note text;
alter table awards add column if not exists sent_back_by uuid references users(id);
alter table awards add column if not exists sent_back_at timestamptz;
-- One live memo per RFx: a regenerate replaces the draft; an approved award is never replaced.
create unique index if not exists awards_one_per_rfx on awards (rfx_id);

-- (2) A manual override keeps what the rule allocated, so it can be reverted:
--     {"vendor_id","price","annual_value","runner_up_vendor_id","runner_up_price","gap_pct","reason"}.
alter table scenario_lines add column if not exists auto jsonb;

-- (3) TRD §13.5: "if none priced all lines, baseline over lines_priced with a note".
alter table scenarios add column if not exists baseline_note text;

-- Tables already have RLS on and no anon/authenticated grants (0001); new columns inherit that.
