-- 0009_mock_mailbox.sql — P6. Live Gmail is out of scope (DECISIONS 2026-09-24); this table stands in for the
-- mailboxes: every email we send lands here as `to_vendor` (the vendor portal reads it), every vendor reply as an
-- unread `to_buyer` message that "Sync inbox" pulls, matches by tag and marks seen — like IMAP on Gmail.
create table if not exists mock_mailbox (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid references rfx(id) on delete cascade,   -- where it was sent from; null for mail dropped in from outside. Sync never matches on it.
  vendor_id uuid references vendors(id),               -- the vendor's mailbox for to_vendor rows
  direction text not null check (direction in ('to_vendor','to_buyer')),
  from_addr text not null,
  to_addr text not null,
  subject text,
  message_id text not null unique,
  in_reply_to text,
  eml_path text not null,                              -- bucket `outbound` for to_vendor, `raw` for to_buyer
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mock_mailbox_unseen on mock_mailbox (direction, seen);

-- Same lock-down as every other table (0001): RLS on, no policies, nothing for anon/authenticated.
alter table mock_mailbox enable row level security;
revoke all on mock_mailbox from anon, authenticated;

-- Where the raw RFC 822 message of a communication is stored (outbound bucket for sent mail, raw for received).
alter table communications add column if not exists eml_path text;
