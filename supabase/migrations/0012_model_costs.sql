-- 0012_model_costs.sql — cost of every model call (Sujeet's request, 25 Sep 2026).
-- Prices: one row per model and period, USD per 1M tokens, from Google's pricing page; edit rows here (Supabase dashboard),
-- no screen in the app. Cost is stored on each call in USD and in ₹ at the Settings USD rate of the moment of the call.
-- Calls logged before this migration keep cost null (decided: leave empty, no estimates).

create table if not exists model_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gemini',
  model text not null,                              -- as sent to the API, e.g. 'gemini-3.8-flash'
  effective_from date not null,                     -- first day this price applies (UTC)
  effective_to date,                                -- last day; null = until changed
  input_usd_per_mtok numeric(12,4) not null,        -- text / image / video / audio / PDF input (uniform on the models priced here)
  cached_input_usd_per_mtok numeric(12,4),          -- context-cache reads; null = billed as normal input
  output_usd_per_mtok numeric(12,4) not null,       -- output, thinking tokens included (Google bills them as output)
  source_url text not null,
  checked_on date not null,                         -- when the price was read from source_url
  notes text,
  unique (model, effective_from)
);
alter table model_prices enable row level security;
revoke all on model_prices from anon, authenticated;

-- Read from https://ai.google.dev/gemini-api/docs/pricing on 2026-09-25 (page "Last updated 2026-09-24 UTC"), paid tier, Standard.
-- effective_from = the day checked: the page doesn't say since when these prices apply.
insert into model_prices (model, effective_from, effective_to, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok, source_url, checked_on, notes) values
  ('gemini-3.5-flash-lite', '2026-09-24', null,         0.30, 0.03,  2.50, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-25', 'Input same for text / image / video / audio. Cache storage $1.00 per 1M tokens per hour (not used).'),
  ('gemini-3.8-flash',      '2026-09-24', '2026-12-31', 0.75, 0.075, 3.75, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-25', 'Price "through December 31, 2026". Cache storage $0.50 per 1M tokens per hour (not used).'),
  ('gemini-3.8-flash',      '2027-01-01', null,         1.50, 0.15,  7.50, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-25', 'Price "starting January 1, 2027". Cache storage $1.00 per 1M tokens per hour (not used).')
on conflict (model, effective_from) do nothing;

-- Every token count Gemini reports (usageMetadata), plus the cost worked out from it.
alter table model_calls
  add column if not exists input_text_tokens int,       -- promptTokensDetails by modality (they add up to input_tokens)
  add column if not exists input_image_tokens int,
  add column if not exists input_document_tokens int,   -- PDFs
  add column if not exists input_audio_tokens int,
  add column if not exists input_video_tokens int,
  add column if not exists cached_input_tokens int,     -- cachedContentTokenCount: part of input_tokens, billed at the cached price
  add column if not exists tool_use_prompt_tokens int,  -- toolUsePromptTokenCount: billed as input
  add column if not exists thinking_tokens int,         -- thoughtsTokenCount: billed as output
  add column if not exists total_tokens int,            -- totalTokenCount as reported
  add column if not exists usage_raw jsonb,             -- the usageMetadata object as returned, for audit
  add column if not exists price_id uuid references model_prices(id),
  add column if not exists cost_usd numeric(14,8),
  add column if not exists usd_inr_rate numeric(10,4),  -- Settings USD rate at the time of the call
  add column if not exists cost_inr numeric(14,6),
  add column if not exists cost_note text;              -- why cost is null (no price for the model, call failed, no usage returned)

-- Totals per RFx and purpose (classify, extract, map, questionnaire, flags, ask_sql, ask_narrate, memo, copilot, dispatch, clarify, …).
-- rfx_id null = calls outside an RFx (model checks). Only calls with a cost count in the cost sums; costed_calls says how many.
create or replace view v_cost_by_rfx_purpose with (security_invoker = true) as
select
  mc.rfx_id,
  r.code as rfx_code,
  mc.purpose,
  count(*) as calls,
  count(mc.cost_usd) as costed_calls,
  coalesce(sum(mc.input_tokens), 0) as input_tokens,
  coalesce(sum(mc.input_text_tokens), 0) as input_text_tokens,
  coalesce(sum(mc.input_image_tokens), 0) as input_image_tokens,
  coalesce(sum(mc.input_document_tokens), 0) as input_document_tokens,
  coalesce(sum(mc.cached_input_tokens), 0) as cached_input_tokens,
  coalesce(sum(mc.thinking_tokens), 0) as thinking_tokens,
  coalesce(sum(mc.output_tokens), 0) as output_tokens,
  coalesce(sum(mc.total_tokens), 0) as total_tokens,
  round(coalesce(sum(mc.cost_usd), 0), 6) as cost_usd,
  round(coalesce(sum(mc.cost_inr), 0), 4) as cost_inr,
  min(mc.created_at) as first_call,
  max(mc.created_at) as last_call
from model_calls mc
left join rfx r on r.id = mc.rfx_id
group by mc.rfx_id, r.code, mc.purpose;
revoke all on v_cost_by_rfx_purpose from anon, authenticated;
