-- 0001_init.sql — TRD §6.1–6.20, extracted verbatim from docs/02_FSD_TRD (do not hand-edit tables here; change the TRD first)

-- 6.1 `users`
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  role text not null check (role in ('buyer','approver','admin')),
  password_hash text not null,
  created_at timestamptz default now()
);

-- 6.2 `vendors`
create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text unique not null,          -- 'balaji','kohinoor','westline','orientpack','anand'
  contact_name text,
  email text not null,
  city text, state text, country text default 'IN',
  default_currency text default 'INR',
  notes text,
  created_by text default 'seed',           -- 'seed' | 'user' | 'auto' (created from unmatched)
  created_at timestamptz default now()
);

-- 6.3 `rfx`
create table rfx (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                -- 'MER-0417'
  title text not null,
  category text not null,                   -- 'Corrugated packaging'
  status text not null default 'draft'
    check (status in ('draft','issued','receiving','reviewing','awarded','closed')),
  version int not null default 0,           -- 0 = draft, 1 = frozen v1
  frozen_at timestamptz,
  buyer_id uuid references users(id),
  currency text not null default 'INR',
  quote_unit text not null default 'per_1000_pcs',   -- required quoting unit key (§11.1)
  incoterm text not null default 'delivered',        -- 'delivered' | 'ex_works' | 'fob'
  freight_included_requested boolean not null default true,
  payment_terms_days int not null default 45,
  validity_days_requested int not null default 60,
  contract_months int not null default 12,
  response_deadline date,
  delivery_locations text[] not null default '{Hosur,Nelamangala}',
  cover_note text,                          -- co-pilot generated scope paragraph
  copilot_transcript jsonb not null default '[]', -- chat messages
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- 6.4 `rfx_lines`
create table rfx_lines (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  line_no int not null,
  sku text not null,                        -- 'MF-CB-5P-001'
  description text not null,                -- 'Export carton, 5-ply, 600x400x400 mm, BF 28'
  ply int,                                  -- 3 | 5 | null
  length_mm numeric, width_mm numeric, height_mm numeric,
  gsm_spec text,                            -- '150/120/150/120/150'
  burst_factor int,
  item_type text,                           -- 'box' | 'sheet' | 'partition' | 'other'
  weight_per_piece_g numeric,               -- used for per-kg conversion
  monthly_qty int not null,
  annual_qty int not null,
  delivery_location text not null,
  spec_attributes jsonb not null default '{}',  -- category-agnostic extras
  unique (rfx_id, line_no)
);

-- 6.5 `rfx_questions`
create table rfx_questions (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  q_no int not null,
  text text not null,
  answer_type text not null check (answer_type in ('yes_no','number','text')),
  mandatory boolean not null default true,
  disqualify_if text,                       -- 'no' | null  (for yes_no) ; for number: 'lt:<n>' e.g. 'lt:200'
  unique (rfx_id, q_no)
);

-- 6.6 `rfx_vendors`
create table rfx_vendors (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  reply_tag text not null,                  -- 'rfx-<shortRfx>-<vendorShortCode>' used in Reply-To
  invited_at timestamptz,
  status text not null default 'invited'
    check (status in ('invited','responded','clarification_sent','clarified','disqualified','excluded')),
  disqualified_reason text,
  freight_assumption_inr_per_1000 numeric,  -- landed cost input, editable
  freight_basis text,                       -- 'vendor_stated' | 'buyer_estimate' | 'included'
  unique (rfx_id, vendor_id)
);

-- 6.7 `communications`
create table communications (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  vendor_id uuid references vendors(id),
  direction text not null check (direction in ('outbound','inbound')),
  kind text not null check (kind in ('rfx_dispatch','clarification','award','regret','vendor_reply','other')),
  mode text not null check (mode in ('mock','gmail','resend')),
  from_addr text, to_addr text, reply_to text, subject text,
  body_text text, body_html text,
  message_id text,                          -- SMTP/IMAP Message-ID; unique for inbound idempotency
  in_reply_to text,
  sent_at timestamptz, received_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','received','processed')),
  attachments jsonb not null default '[]',  -- [{file_id, name, size, mime}]
  response_id uuid,                         -- set when inbound becomes a response
  error text,
  created_at timestamptz default now()
);
create unique index communications_message_id_uq on communications(message_id) where message_id is not null;

-- 6.8 `responses`
create table responses (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  vendor_id uuid references vendors(id),    -- null until matched (unmatched responses)
  source text not null check (source in ('mock_upload','mock_paste','portal','seed','gmail','resend','clarification_reply')),
  communication_id uuid references communications(id),
  email_text text,                          -- pasted or parsed body
  received_at timestamptz not null default now(),
  pipeline_status jsonb not null default '{}',
  -- {"classify":"done","extract":"running","map":"pending","normalise":"pending","questionnaire":"pending","flags":"pending"}
  stage_errors jsonb not null default '{}',
  summary jsonb not null default '{}',      -- counts: items, mapped, unmapped, queue, etc.
  is_clarification boolean not null default false,
  supersedes_response_id uuid,              -- clarification replies link to original
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- 6.9 `response_files`
create table response_files (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references responses(id) on delete cascade,
  original_name text not null,
  mime text not null,
  size_bytes int not null,
  storage_path text not null,               -- bucket 'raw'
  derived_text_path text,                   -- bucket 'derived' (csv/txt) when applicable
  derived_image_paths jsonb,                -- downscaled pages/images
  file_kind text,                           -- classification: 'quotation' | 'questionnaire' | 'supporting' | 'not_relevant' | 'unknown'
  file_kind_probability numeric,
  file_kind_provider text,                  -- 'jev' | 'gemini'
  classify_reason text,
  page_count int,
  created_at timestamptz default now()
);

-- 6.10 `extracted_items` (raw, as the vendor wrote it)
create table extracted_items (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references responses(id) on delete cascade,
  file_id uuid references response_files(id),
  item_index int not null,
  vendor_sku text,
  vendor_description text not null,
  quantity numeric,
  quantity_unit text,
  unit_price numeric,                       -- as written
  price_unit_raw text,                      -- 'per box', 'per 1000 pcs', 'per kg', 'USD/1000'
  currency_raw text,                        -- 'INR','USD','₹','$', null
  pack_size numeric,                        -- pieces per box if stated
  pack_size_unit text,
  discount_pct numeric,                     -- line-level
  notes text,                               -- footnotes or remarks tied to this line
  location jsonb not null,                  -- provenance: {"type":"cell","sheet":"Quote","ref":"D14"} | {"type":"pdf","page":2,"bbox":[x0,y0,x1,y1],"snippet":"..."} | {"type":"image","bbox":[...],"snippet":"..."} | {"type":"text","start":123,"end":180,"snippet":"..."}
  raw_confidence numeric,                   -- extraction confidence 0-1 (Gemini self-report)
  created_at timestamptz default now()
);

-- 6.11 `response_terms` (vendor-level commercial terms)
create table response_terms (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references responses(id) on delete cascade,
  currency text,                            -- normalised code
  validity_days int, validity_until date,
  freight_terms_raw text,                   -- 'FOB Chennai', 'freight extra', 'delivered'
  freight_included boolean,                 -- interpreted
  tax_terms_raw text, taxes_included boolean,
  payment_terms_raw text, payment_days int,
  total_discount_pct numeric, total_discount_condition text,  -- 'early payment within 10 days'
  references_prior_pricing boolean not null default false,
  references_prior_pricing_text text,
  other_notes text,
  location jsonb,
  created_at timestamptz default now()
);

-- 6.12 `line_quotes` (normalised cell — one per rfx_line × vendor)
create table line_quotes (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  rfx_line_id uuid not null references rfx_lines(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  response_id uuid references responses(id),
  extracted_item_id uuid references extracted_items(id),
  state text not null check (state in
    ('confirmed','inferred','reviewed','low_confidence','ambiguous','not_quoted','references_prior','excluded','conflict')),
  unit_price_inr_per_1000 numeric,          -- normalised value (null if not_quoted/ambiguous/references_prior)
  landed_price_inr_per_1000 numeric,        -- unit + freight (+ tax) per settings
  original_value numeric, original_unit text, original_currency text,
  mapping_probability numeric, mapping_provider text,   -- from decision layer
  conversion_chain jsonb not null default '[]',
  -- [{"step":"currency","from":"USD","to":"INR","rate":83.15,"rate_date":"2026-09-23","assumption_id":"..."},
  --  {"step":"unit","from":"per_box","to":"per_1000_pcs","factor":20,"basis":"pack_size 50 stated on line 7","assumption_id":"..."}]
  best_guess_value numeric,                 -- for ambiguous/low_confidence: system's proposal
  best_guess_note text,
  reviewed_by uuid references users(id), reviewed_at timestamptz, review_note text,
  updated_at timestamptz,
  unique (rfx_line_id, vendor_id)
);

-- 6.13 `questionnaire_answers`
create table questionnaire_answers (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  question_id uuid not null references rfx_questions(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  response_id uuid references responses(id),
  answer_raw text,
  answer_bool boolean, answer_number numeric, answer_text text,
  probability numeric,                      -- for yes_no: p(true); for others: extraction confidence
  provider text,
  state text not null check (state in ('answered','missing','ambiguous','reviewed')),
  passes boolean,                           -- computed vs disqualify_if
  location jsonb,
  reviewed_by uuid, reviewed_at timestamptz,
  unique (question_id, vendor_id)
);

-- 6.14 `assumptions` (the ledger)
create table assumptions (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  vendor_id uuid references vendors(id),
  rfx_line_id uuid references rfx_lines(id),
  line_quote_id uuid references line_quotes(id),
  kind text not null check (kind in
    ('fx_rate','unit_conversion','pack_size','weight_per_piece','discount_treatment','freight_treatment','tax_treatment','validity','mapping_override','value_override','exclusion','prior_pricing','other')),
  description text not null,                -- human sentence: "USD→INR at 83.15 (RBI ref, 23 Sep 2026)"
  value jsonb,                              -- {"rate":83.15,"date":"2026-09-23"} etc
  basis text,                               -- 'vendor_stated' | 'rfx_spec' | 'settings_default' | 'buyer_entered' | 'system_inferred'
  made_by text not null,                    -- 'system' | user id
  superseded_by uuid,                       -- when overridden
  created_at timestamptz default now()
);

-- 6.15 `review_items` (the queue)
create table review_items (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  vendor_id uuid references vendors(id),
  response_id uuid references responses(id),
  rfx_line_id uuid references rfx_lines(id),
  line_quote_id uuid references line_quotes(id),
  extracted_item_id uuid references extracted_items(id),
  question_id uuid references rfx_questions(id),
  type text not null check (type in
    ('low_confidence_read','ambiguous_unit','unmapped_item','missing_line','prior_pricing','fx_assumption','discount_treatment','freight_treatment','conflict','unknown_vendor','questionnaire_ambiguous','validity_short','not_a_quote')),
  title text not null,
  detail text,
  proposed_value numeric, proposed_state text, proposed_note text,
  probability numeric,
  evidence jsonb not null default '{}',     -- {"file_id","location":{...},"crop_path":"...","snippet":"..."}
  status text not null default 'open' check (status in ('open','confirmed','overridden','excluded','asked_vendor','resolved_by_reply','dismissed')),
  resolution jsonb,                         -- {"value":..,"note":..,"by":..,"at":..}
  created_at timestamptz default now(), updated_at timestamptz
);

-- 6.16 `unmatched_items`
create table unmatched_items (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  response_id uuid not null references responses(id) on delete cascade,
  extracted_item_id uuid not null references extracted_items(id) on delete cascade,
  best_candidate_line_id uuid references rfx_lines(id),
  best_candidate_probability numeric,
  status text not null default 'open' check (status in ('open','mapped','ignored')),
  mapped_line_id uuid references rfx_lines(id),
  created_at timestamptz default now()
);

-- 6.17 `queries` (Ask panel history)
create table queries (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  user_id uuid references users(id),
  question text not null,
  plan jsonb,                               -- {"intent":..,"filters":[..],"exclusions":[..],"needs_chart":bool}
  sql text,
  sql_ok boolean,
  result_rows jsonb,                        -- capped 500 rows
  row_count int,
  answer_text text,                         -- narration
  computed_note text,                       -- "How I computed this"
  chart_spec jsonb,
  exclusions jsonb,                         -- [{"vendor":"Kohinoor","reason":"failed Q1 (BIS)"}, {"cells":3,"reason":"ambiguous, excluded"}]
  unresolved_cells int,
  duration_ms int,
  error text,
  created_at timestamptz default now()
);

-- 6.18 `scenarios`, `scenario_lines`
create table scenarios (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  name text not null,
  rule_text text not null,                  -- plain words
  rule jsonb not null,                      -- {"type":"cheapest_per_line","qualified_only":true,"price_basis":"unit"|"landed","weights":{"price":0.7,"questionnaire":0.3},"groups":[{"filter":{"ply":5},"rule":...}]}
  total_inr numeric, vendor_count int, single_source_lines int,
  baseline_single_vendor_total numeric, baseline_vendor_id uuid,
  savings_vs_baseline numeric,
  created_by uuid references users(id), created_at timestamptz default now()
);
create table scenario_lines (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  rfx_line_id uuid not null references rfx_lines(id),
  vendor_id uuid references vendors(id),     -- null = unallocated
  price_inr_per_1000 numeric,
  annual_value_inr numeric,
  runner_up_vendor_id uuid, runner_up_price numeric, gap_pct numeric,
  reason text,                              -- 'cheapest qualified' | 'manual override: incumbent tooling'
  is_override boolean not null default false
);

-- 6.19 `settings`
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- 6.20 `awards`, `audit_events`, `model_calls`, `eval_runs`
create table awards (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null references rfx(id) on delete cascade,
  scenario_id uuid not null references scenarios(id),
  memo_path text,                           -- bucket 'outbound'
  memo_json jsonb not null,                 -- everything rendered (for re-render)
  prepared_by uuid references users(id), prepared_at timestamptz,
  approved_by uuid references users(id), approved_at timestamptz,
  status text not null default 'draft' check (status in ('draft','approved'))
);
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid references rfx(id) on delete cascade,
  actor text not null,                      -- user id | 'system'
  event text not null,                      -- 'rfx.created','rfx.frozen','dispatch.sent','response.received','pipeline.stage','review.confirm',...
  entity_type text, entity_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);
create table model_calls (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid, response_id uuid,
  purpose text not null,                    -- 'classify','extract','map','questionnaire','flags','copilot','sql','narrate','memo','clarification_draft'
  provider text not null,                   -- 'gemini' | 'jev-openrouter'
  model text not null,
  input_tokens int, output_tokens int, latency_ms int,
  ok boolean not null, error text,
  input_preview text, output_preview text,  -- first 500 chars
  created_at timestamptz default now()
);
create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  rfx_id uuid not null,
  ran_at timestamptz default now(),
  totals jsonb not null,                    -- {"cells":150,"correct":143,"flagged_ok":4,"wrong":3,"questionnaire_correct":47,"questionnaire_total":50}
  per_cell jsonb not null                   -- [{"line_no":12,"vendor":"westline","expected":..,"got":..,"state":..,"verdict":"correct|flagged_ok|wrong|missing"}]
);

-- Lock-down (addition, see DECISIONS.md): the app only uses the service role (bypasses RLS).
-- RLS on with no policies = anon/authenticated keys can read nothing through the Data API.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;
