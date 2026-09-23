# FSD / TRD — "Kill the Quote Spreadsheet" (QuoteLens)
## Functional Specification + Technical Requirements Document

| Field | Value |
|---|---|
| Document | 2 of 6 — FSD/TRD |
| Version | 1.0 |
| Date | 23 September 2026 |
| Depends on | 01 PRD (personas, flow, ugly edges, decisions) · 03 Dataset Pack (seed files, gold key) |
| Consumed by | 04 Build Plan (CLAUDE.md) — Claude Code builds from this document |
| Product name | QuoteLens (placeholder) · Buyer org: Meridian Foods Pvt Ltd (fictional) |

---

## 0. How to use this document

This is the build specification. Every table, prompt, route, screen and rule needed to implement the PRD is here. Where a value is a default that should be tunable, it is marked **(setting)** and appears in the `settings` table (§6.19). Where a library or model name may have changed since writing, it is marked **(verify)** with the URL to check. Do not invent alternatives to what is specified unless the specified thing is unavailable; if you substitute, record it in `DECISIONS.md` in the repo.

Section map: §1 architecture · §2 stack · §3 repo layout · §4 environment · §5 storage · §6 database (full SQL) · §7 file preprocessing · §8 ingestion pipeline · §9 prompts (full text) · §10 decision layer · §11 normalisation engine · §12 review queue · §13 query layer · §14 scenarios & award · §15 email · §16 API routes · §17 screens · §18 eval · §19 logging & errors · §20 seeding · §21 deployment · §22 test checklist · §23 cost & performance budget.

---

## 1. Architecture

### 1.1 Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router, React, Tailwind, shadcn/ui, Recharts)       │
│  Screens: RFx list · New RFx (co-pilot) · RFx overview · Inbox/Outbox ·   │
│  Vendor Portal Sim · Response Detail · Review Queue · Comparison (tabs) · │
│  Ask panel · Scenarios · Award · Settings · Eval · Logs                   │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ HTTPS (Route Handlers under /app/api/**)
┌───────────────┴──────────────────────────────────────────────────────────┐
│  Next.js server (Vercel Functions, Node runtime, Fluid Compute)           │
│                                                                          │
│  /api/rfx/*        RFx CRUD, issue, dispatch                              │
│  /api/copilot/*    co-pilot chat, line-sheet parse, questionnaire draft   │
│  /api/responses/*  receive (mock/gmail), pipeline stage runners           │
│  /api/review/*     queue actions                                          │
│  /api/ask/*        question → plan → SQL → run → render                   │
│  /api/scenarios/*  save/compare                                           │
│  /api/award/*      memo generate, approve                                 │
│  /api/email/*      sync-inbox (IMAP), outbox                              │
│  /api/settings/*   read/write settings                                    │
│  /api/eval/*       run eval on seeded RFx                                 │
│  /api/export/*     xlsx/csv/pdf                                           │
│                                                                          │
│  lib/ai/gemini.ts        (reading: extraction, drafting, SQL generation)  │
│  lib/ai/decision/*.ts    (decision layer: interface + providers)          │
│  lib/pipeline/*.ts       (classify → extract → map → normalise → flags)   │
│  lib/normalise/*.ts      (unit dictionary, FX, discount, freight)         │
│  lib/email/*.ts          (mock, gmail smtp/imap, resend stub)             │
│  lib/query/*.ts          (SQL guardrails, execution, chart spec)          │
└───────┬───────────────────────────┬──────────────────────┬───────────────┘
        │                           │                      │
┌───────▼─────────┐   ┌─────────────▼──────────┐   ┌───────▼──────────────┐
│ Supabase        │   │ Google Gemini API      │   │ Gmail (SMTP/IMAP)    │
│ Postgres +      │   │ (candidate's key)      │   │ App Password         │
│ Storage buckets │   │                        │   │ [gmail mode only]    │
└─────────────────┘   └────────────────────────┘   └──────────────────────┘
                      ┌────────────────────────┐
                      │ OpenRouter → Jev       │  [only if key present]
                      └────────────────────────┘
```

### 1.2 Principles that shape the architecture
- **One repo, one language (TypeScript).** No Python service, no queue, no worker.
- **Stage-per-request pipeline.** Each pipeline stage for one response is its own HTTP call from the client (or a server-side chain with per-stage persistence), so no single Vercel function runs longer than ~60 s and progress is visible.
- **All state in Postgres.** No in-memory state between requests. Every stage reads its input from tables and writes its output to tables.
- **Raw before processed.** Every inbound file/email is stored raw in Supabase Storage and a `response_files` row before any model touches it.
- **Every model call logged** to `model_calls` with purpose, provider, model, tokens, latency, and a truncated input/output hash.

### 1.3 Request flow for one vendor response (gmail mode)
1. Client on RFx overview calls `POST /api/email/sync` → server opens IMAP, fetches unseen messages, for each with a valid tag creates `responses` + `response_files` (attachments to Storage), marks message seen, returns list of new response ids.
2. Client calls, in order, for each new response: `POST /api/responses/{id}/stage/classify` → `/extract` → `/map` → `/normalise` → `/questionnaire` → `/flags`. Each returns `{ status, summary }`; client renders progress.
3. Client navigates to Review Queue (`GET /api/review?rfx=`) or Comparison (`GET /api/rfx/{id}/comparison`).

Mock mode differs only in step 1 (`POST /api/responses` with multipart files or pasted text).

---

## 2. Tech stack

| Layer | Choice | Version guidance | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | Latest stable 15.x **(verify)** | Route Handlers for API; Server Components for reads; Client Components for interactive screens |
| Language | TypeScript | 5.x | `strict: true` |
| UI | Tailwind CSS + shadcn/ui | latest | Data table, sheet/drawer, tabs, badge, dialog, toast, slider |
| Charts | Recharts | latest | Bar, line; rendered from `ChartSpec` (§13.6) |
| DB | Supabase Postgres | free tier | Use `@supabase/supabase-js` with service-role key server-side only |
| Storage | Supabase Storage | free tier | Buckets in §5 |
| Validation | Zod | latest | All model outputs validated against Zod schemas |
| Gemini SDK | `@google/genai` (Google GenAI JS SDK) | latest **(verify)** — https://ai.google.dev/gemini-api/docs | Structured output via `responseMimeType: "application/json"` + `responseSchema`; PDFs/images via `inlineData` (base64) |
| Gemini models | `GEMINI_MODEL_FAST` default `gemini-3.8-flash`; `GEMINI_MODEL_STRONG` default `gemini-3.8-flash` **(verify)** — set to the strongest available Gemini 3-series model that supports PDF/image input and structured output; check https://ai.google.dev/gemini-api/docs/models | Fast: classification emulation, drafting, chat. Strong: extraction from PDFs/images, text-to-SQL |
| Decision provider (optional) | OpenRouter, model `typesafe/jev-1.13` | only if `OPENROUTER_API_KEY` set | Request shape per OpenRouter's TypeSafe listing **(verify)** https://openrouter.ai/typesafe/jev-1.13 |
| XLSX read/write | SheetJS (`xlsx`) for read; `exceljs` for styled write | latest | Read: sheet → array of arrays; Write: comparison export, dispatch attachment |
| DOCX read | `mammoth` | latest | `.docx` → plain text (and HTML for tables → convert to text rows) |
| PDF (read) | Sent natively to Gemini as `inlineData` (`application/pdf`) | — | No local PDF text extraction needed; optional `pdf-parse` fallback for text-only PDFs |
| PDF (write) | `@react-pdf/renderer` | latest | Award memo, questionnaire PDF attachment |
| Images | `sharp` | latest | Downscale to max 2000 px long side before vision; crop regions for provenance |
| Email send | `nodemailer` | latest | Gmail SMTP, App Password |
| Email receive | `imapflow` + `mailparser` | latest | IMAP polling, parse MIME, extract attachments |
| Auth | Cookie session with two seeded users; `iron-session` or a signed cookie | latest | No third-party auth |
| IDs | UUID v4 (Postgres `gen_random_uuid()`) | — | |
| Hosting | Vercel Hobby, Fluid Compute enabled | — | `export const maxDuration = 300` on pipeline routes; design ≤ 60 s |

---

## 3. Repository layout

```
quotelens/
  CLAUDE.md                     # build plan (document 4)
  DECISIONS.md                  # any substitutions made during build
  .env.example
  package.json
  next.config.ts
  vercel.json                   # functions maxDuration
  supabase/
    migrations/0001_init.sql    # §6
    migrations/0002_views.sql   # §6.21
    seed/                       # §20 (dataset pack copied here)
  src/
    app/
      (auth)/login/page.tsx
      rfx/page.tsx
      rfx/new/page.tsx
      rfx/[id]/page.tsx                  # overview + comms timeline
      rfx/[id]/inbox/page.tsx            # mock inbox
      rfx/[id]/outbox/page.tsx
      rfx/[id]/portal/[vendorId]/page.tsx# vendor portal simulator
      rfx/[id]/responses/[rid]/page.tsx  # response detail
      rfx/[id]/review/page.tsx
      rfx/[id]/compare/page.tsx          # tabs + ask panel
      rfx/[id]/scenarios/page.tsx
      rfx/[id]/award/page.tsx
      settings/page.tsx
      eval/page.tsx
      logs/page.tsx
      api/**                              # §16
    components/**                         # §17
    lib/
      db.ts                               # supabase client (server)
      auth.ts
      settings.ts
      ai/gemini.ts
      ai/decision/index.ts                # interface (§10)
      ai/decision/providers/gemini.ts
      ai/decision/providers/openrouterJev.ts
      pipeline/classify.ts
      pipeline/extract.ts
      pipeline/map.ts
      pipeline/normalise.ts
      pipeline/questionnaire.ts
      pipeline/flags.ts
      pipeline/run.ts                     # orchestrates stages with persistence
      preprocess/xlsx.ts docx.ts pdf.ts image.ts email.ts
      normalise/units.ts fx.ts discount.ts freight.ts
      review/queue.ts
      query/plan.ts sql-guard.ts run.ts chart.ts
      scenarios/allocate.ts
      award/memo.tsx                      # react-pdf
      email/index.ts mock.ts gmail.ts resend.ts tag.ts
      export/xlsx.ts csv.ts
      eval/run.ts
      log.ts
    types/                                # shared TS types (mirrors §6)
  scripts/
    seed.ts                               # loads dataset pack, creates users/vendors/RFx
    run-eval.ts
```

---

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Absolute URL of deployment (links in emails, memo) |
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only |
| `SUPABASE_ANON_KEY` | yes | Only if client-side reads are used; prefer server reads |
| `SESSION_SECRET` | yes | Cookie signing |
| `GEMINI_API_KEY` | yes | Candidate's key |
| `GEMINI_MODEL_FAST` | no | default `gemini-3.8-flash` (verify) |
| `GEMINI_MODEL_STRONG` | no | default see §2 (verify) |
| `OPENROUTER_API_KEY` | no | If set, decision layer uses Jev via OpenRouter |
| `OPENROUTER_JEV_MODEL` | no | default `typesafe/jev-1.13` |
| `EMAIL_MODE` | no | Overridden by `settings.email_mode`; default `mock` |
| `GMAIL_USER` | gmail mode | Sender account, e.g. `sabarish.sender@gmail.com` |
| `GMAIL_APP_PASSWORD` | gmail mode | 16-char App Password (2-step verification required on the account) |
| `GMAIL_IMAP_HOST` | no | default `imap.gmail.com` |
| `GMAIL_SMTP_HOST` | no | default `smtp.gmail.com` |
| `RESEND_API_KEY` | resend mode | stubbed, not configured |
| `FX_API_URL` | no | Optional free FX endpoint; if absent use `settings.fx_rates` |
| `SEED_ADMIN_PASSWORD` | yes | Password for both seeded users |

`.env.example` lists all with comments. Keys never appear in client bundles: any module importing `process.env.GEMINI_API_KEY` must be server-only (`import "server-only"`).

---

## 5. Storage buckets (Supabase Storage)

| Bucket | Public? | Contents | Path convention |
|---|---|---|---|
| `raw` | no | Every inbound file exactly as received; raw `.eml` for gmail mode | `rfx/{rfxId}/responses/{responseId}/{fileId}-{originalName}` |
| `derived` | no | Preprocessed text (xlsx→csv, docx→txt), downscaled images, provenance crops (PNG) | `rfx/{rfxId}/responses/{responseId}/{fileId}/…` |
| `outbound` | no | Dispatch attachments (line sheet xlsx, questionnaire pdf), award memo PDF, exports | `rfx/{rfxId}/outbound/…` |
| `seed` | no | Dataset pack originals | `seed/…` |

Signed URLs (60 min) are generated server-side for the browser to view files and crops.

---

## 6. Database schema (Postgres, Supabase)

All tables have `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and where mutable `updated_at timestamptz`. Foreign keys cascade on delete of an RFx. Enumerations are `text` with `check` constraints for simplicity.

### 6.1 `users`
```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  role text not null check (role in ('buyer','approver','admin')),
  password_hash text not null,
  created_at timestamptz default now()
);
```
Seed: Sujit Menon (buyer, admin), Priya Raghavan (approver).

### 6.2 `vendors`
```sql
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
```

### 6.3 `rfx`
```sql
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
```

### 6.4 `rfx_lines`
```sql
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
```

### 6.5 `rfx_questions`
```sql
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
```

### 6.6 `rfx_vendors`
```sql
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
```

### 6.7 `communications`
```sql
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
```

### 6.8 `responses`
```sql
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
```

### 6.9 `response_files`
```sql
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
```

### 6.10 `extracted_items` (raw, as the vendor wrote it)
```sql
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
```

### 6.11 `response_terms` (vendor-level commercial terms)
```sql
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
```

### 6.12 `line_quotes` (normalised cell — one per rfx_line × vendor)
```sql
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
```

### 6.13 `questionnaire_answers`
```sql
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
```

### 6.14 `assumptions` (the ledger)
```sql
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
```

### 6.15 `review_items` (the queue)
```sql
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
```

### 6.16 `unmatched_items`
```sql
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
```

### 6.17 `queries` (Ask panel history)
```sql
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
```

### 6.18 `scenarios`, `scenario_lines`
```sql
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
```

### 6.19 `settings`
```sql
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
```
Seeded keys: `email_mode` ("mock"), `decision_provider` ("auto"), `thresholds` ({"act":0.85,"review":0.60}), `fx_rates` ({"USD":{"rate":83.15,"date":"2026-09-23","source":"manual"},"EUR":{...}}), `landed_cost` ({"include_tax":false,"cost_of_money_annual_pct":0}), `discount_default` ("gross"), `vendor_addresses` (map shortCode → email for gmail mode).

### 6.20 `awards`, `audit_events`, `model_calls`, `eval_runs`
```sql
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
```

### 6.21 Views for the query layer (read-only surface for text-to-SQL)
```sql
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
```
Plus a Postgres function for guarded execution (§13.4):
```sql
create or replace function run_readonly_query(q text) returns jsonb
language plpgsql security definer as $$
declare result jsonb;
begin
  set local statement_timeout = '8000ms';
  set local transaction read only;
  execute 'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (' || q || ' limit 500) t' into result;
  return result;
end $$;
```
Grant execute to the service role only; the application additionally validates the SQL text before calling (§13.4).

---

## 7. File preprocessing (before any model call)

| Input | Steps | Output stored (bucket `derived`) | Sent to Gemini as |
|---|---|---|---|
| `.xlsx/.xls` | SheetJS read all sheets; for each sheet emit CSV with **cell references preserved**: each row prefixed `[row N]`, each non-empty cell as `{col}{row}=value`; drop empty sheets; cap 2,000 cells per sheet (log truncation) | `sheet-{n}.txt` | text |
| `.csv` | Normalise delimiter; same row/cell reference tagging | `sheet-1.txt` | text |
| `.docx` | `mammoth.convertToHtml` → convert `<table>` to pipe-delimited rows with `[table t row r]` prefix; paragraphs numbered `[p N]` | `doc.txt` | text |
| `.pdf` | Page count via `pdf-lib` or `pdfjs`; if ≤ 20 pages send whole PDF as `inlineData` (`application/pdf`); if > 20 pages split into 10-page PDFs and process sequentially (merge items). Also rasterise pages to PNG at 150 dpi with `pdfjs`+`canvas` **only if** provenance crops are needed (i.e. after extraction) | `page-{n}.png` (lazy) | file |
| `.jpg/.png` | `sharp`: auto-orient (EXIF), downscale to 2000 px long side, mild contrast normalise; keep original for crops | `image.png` | file |
| `.txt/.eml` / pasted text | Strip quoted reply blocks (`>`), signature heuristics; number lines `[l N]` | `body.txt` | text |
| Unsupported | Store raw; `file_kind='unknown'`; review item `not_a_quote` with note "unsupported type" | — | — |

Provenance location formats (`location` jsonb):
- cell: `{"type":"cell","sheet":"Quotation","ref":"D14","row_text":"..."}`
- text: `{"type":"text","file_id":"...","line":42,"snippet":"..."}`
- pdf: `{"type":"pdf","page":2,"snippet":"...","bbox":[x0,y0,x1,y1]}` (bbox in 0–1 normalised page coordinates; Gemini asked to estimate; if absent, page-level)
- image: `{"type":"image","bbox":[x0,y0,x1,y1],"snippet":"..."}` (0–1 normalised; crop generated with `sharp` for the review queue)

---

## 8. Ingestion pipeline (per response)

Orchestrated by `lib/pipeline/run.ts`. Each stage: idempotent (re-running replaces its own outputs for that response), persists status into `responses.pipeline_status`, writes an `audit_events` row `pipeline.stage` with `{stage, ok, ms, counts}`, and on error stores `stage_errors[stage]` and stops the chain. The client shows each stage with states pending/running/done/error and a Retry button per stage.

### 8.1 Stage `classify`
- Input: all `response_files` for the response + `responses.email_text`.
- For each file (and the email text as a pseudo-file): build a **state** of ≤ 3,000 characters: file name, mime, first 2,500 chars of derived text (or, for images/PDFs, a Gemini fast-model caption of ≤ 600 chars obtained with prompt P-CAPTION §9.4).
- Ask the decision layer (§10) one **choice** question: `file_kind ∈ {quotation, questionnaire, supporting, not_relevant}` and one **boolean**: `contains_prices`.
- Persist `file_kind`, probability, provider, reason.
- Rule: if no file is `quotation` and email text has no prices → response summary `no_quote_found`; review item `not_a_quote` (unless it is a questionnaire-only or supporting-only reply, which is valid).

### 8.2 Stage `extract`
- Input: files with `file_kind='quotation'` (and email text if `contains_prices`).
- For each: call Gemini strong model with prompt **P-EXTRACT** (§9.5) and the file (text or inlineData). Response schema: `ExtractionResult` (§9.5). Validate with Zod; on validation failure retry once with the error appended ("Your previous output failed validation: … fix and return only JSON").
- Write `extracted_items` (one per item) and `response_terms` (one per response; if multiple files yield terms, merge with precedence: quotation file > email text; conflicts noted in `other_notes`).
- Large sheets: if a text file exceeds 60,000 characters, chunk by rows (keep header rows in each chunk) and merge items.
- Summary counts: items, items_with_price, currency set, has_footnotes.

### 8.3 Stage `map`
- Input: `extracted_items` for the response; RFx lines (line_no, sku, description, ply, dims, item_type, spec).
- **Candidate shortlist (cheap, deterministic):** for each item compute a similarity score against every RFx line using: ply match, dimensions within ±5% (parsed from description with regex `(\d{2,4})\s*[x×*]\s*(\d{2,4})(\s*[x×*]\s*(\d{2,4}))?`), item_type keyword match, token overlap (Jaccard) on descriptions, vendor SKU substring match against our SKU. Keep top 5 candidates + "none".
- **Decision layer choice question** per item: options = the 5 candidate lines (rendered as "L12: Export carton 5-ply 600x400x400 BF28") + `none_of_these`. State = the item's vendor description, sku, unit, pack size, plus the vendor's neighbouring 2 items for context (≤ 1,500 chars).
- Thresholds **(setting)**: p ≥ 0.85 → mapped; 0.60 ≤ p < 0.85 → mapped but review item `low_confidence_read`? No — mapping uncertainty gets its own type: create `review_items.type='unmapped_item'` only when `none_of_these` wins or p < 0.60; between 0.60 and 0.85 create a review item of type `conflict`? **Rule:** 0.60–0.85 → mapped, cell state `inferred`, review item `low_confidence_read` with title "Mapping needs a look" (proposed_state='mapped', probability=p). Below 0.60 or `none_of_these` → `unmatched_items` row + review item `unmapped_item`.
- If two items map to the same line with p ≥ 0.60 → keep the higher; the other becomes `conflict` review item; cell state `conflict` until resolved.
- Write mapping onto `extracted_items` via a join table? Simpler: write directly into `line_quotes` in stage `normalise`; stage `map` stores `{extracted_item_id → line_id, p, provider}` in `responses.summary.mapping` (jsonb) and in `unmatched_items`.

### 8.4 Stage `normalise` (§11 has the rules)
- Input: mapping from 8.3, `extracted_items`, `response_terms`, RFx (quote_unit, lines with weight_per_piece_g), settings (fx_rates, discount_default).
- For each mapped item → upsert `line_quotes` (unique per line×vendor) with `conversion_chain`, `state`, values; create `assumptions` rows for every conversion step that used a non-vendor-stated basis, plus one `fx_rate` assumption per vendor per currency.
- For each RFx line with no mapped item for this vendor → `line_quotes.state='not_quoted'` (unless `references_prior_pricing` applies to it — see §11.6 — then `references_prior`).
- Compute `landed_price_inr_per_1000` per §11.7.
- Review items produced: `ambiguous_unit`, `fx_assumption` (one per vendor-currency, informational, auto-status `confirmed` if rate source is settings? **Rule:** create as `open` so the buyer acknowledges it once), `discount_treatment` (vendor-level, once), `freight_treatment` (vendor-level if freight excluded), `prior_pricing` (vendor-level once + per affected line), `low_confidence_read` for items with `raw_confidence < 0.60` (carry the crop/snippet as evidence).

### 8.5 Stage `questionnaire`
- Input: files with `file_kind='questionnaire'`, and — because vendors answer inside the quotation or the email — also quotation files and email text (all derived text, capped 12,000 chars; for PDFs use a Gemini extraction of Q&A pairs with prompt **P-QA-EXTRACT** §9.7 first).
- For each RFx question: decision layer question — `yes_no` → boolean; `number` → Gemini extraction (P-QA-EXTRACT) then boolean "is this number stated" ; `text` → Gemini extraction. State: the extracted Q&A text (≤ 2,000 chars) + question text.
- `passes` computed vs `disqualify_if`. `state='ambiguous'` when boolean p between 0.40 and 0.60 → review item `questionnaire_ambiguous`. `missing` when no answer found → passes=null (treated as not cleared if question is mandatory & disqualifying).
- Vendor `cleared_questionnaire` derives from the view.

### 8.6 Stage `flags`
- Deterministic + decision layer booleans on `response_terms` text: `references_prior_pricing`, `freight_excluded`, `validity_short` (validity_days < rfx.validity_days_requested), `currency_not_inr`, `total_discount_present`, `partial_quote` (lines_priced < lines_total).
- Creates the corresponding review items if not already created in normalise (dedupe by `(response_id, type, rfx_line_id)`).
- Updates `rfx_vendors.status='responded'`, `responses.summary` with all counts; if RFx status was `issued` → `receiving`; when all invited vendors have responded → `reviewing`.

### 8.7 Clarification replies
- A reply to a clarification (tag suffix `-clar-{n}` in Reply-To) creates a `responses` row with `is_clarification=true`, `supersedes_response_id` = original. Pipeline runs fully but **normalise** only upserts `line_quotes` for lines that were `references_prior`, `ambiguous`, `not_quoted`, `low_confidence` or listed in the clarification request; other lines untouched. Review items of the original response for those lines → `resolved_by_reply`.

---

## 9. Prompts (full text)

All Gemini calls: `temperature 0.1` for extraction/SQL, `0.7` for co-pilot/drafting; `responseMimeType: "application/json"` with a `responseSchema` where a schema is given. The decision layer's Gemini emulation prompt is in §10.4.

### 9.1 P-COPILOT (system prompt; New RFx chat)
```
You are the sourcing co-pilot for a category buyer at Meridian Foods Pvt Ltd (FMCG, India).
Goal: turn the buyer's description into a complete RFx: scope paragraph, line items, questionnaire, commercial terms, vendor list.
Rules:
- Ask at most 3 questions at a time. Ask only what is missing among: category, approximate number of lines, quoting unit, incoterm (delivered vs ex-works), freight included or not, payment terms (days), quote validity (days), contract duration, delivery locations, whether a supplier questionnaire applies, response deadline.
- Never invent line items. If the buyer has a line sheet, ask them to upload or paste it. If they describe lines verbally, draft them and mark each as "draft — please confirm".
- Default terms for Indian FMCG packaging if the buyer says "standard": delivered to plant, freight included, 45-day payment, 60-day validity, 12-month contract, INR, quote per 1000 pieces.
- When the buyer asks for a questionnaire, propose 8-12 questions relevant to the category with answer types yes_no / number / text, and suggest which are disqualifying.
- Output ONLY JSON matching the schema. The "reply" field is what the buyer sees; the "rfx_patch" field contains structured updates to apply.
```
Response schema (Zod → JSON schema):
```ts
CopilotTurn = {
  reply: string,
  questions_for_buyer: string[],           // 0-3
  rfx_patch: {
    title?: string, category?: string, cover_note?: string,
    quote_unit?: 'per_1000_pcs'|'per_piece'|'per_kg'|'per_box',
    incoterm?: 'delivered'|'ex_works'|'fob', freight_included_requested?: boolean,
    payment_terms_days?: number, validity_days_requested?: number, contract_months?: number,
    delivery_locations?: string[], response_deadline?: string,
    lines_add?: Array<{sku?:string, description:string, ply?:number, length_mm?:number, width_mm?:number, height_mm?:number, gsm_spec?:string, burst_factor?:number, item_type?:string, weight_per_piece_g?:number, monthly_qty:number, delivery_location:string, draft:boolean}>,
    questions_add?: Array<{text:string, answer_type:'yes_no'|'number'|'text', mandatory:boolean, disqualify_if?:string}>,
    vendors_add?: Array<{name:string, email?:string}>
  }
}
```

### 9.2 P-LINESHEET (parse uploaded/pasted line sheet into lines)
```
You are given a buyer's line-item sheet for a corrugated packaging RFx (text with row/cell references).
Return every line item as structured data. Parse dimensions (L x W x H mm), ply (3 or 5), GSM spec, burst factor, item type (box|sheet|partition|other), monthly quantity, delivery location.
If a field is absent, set null. Do not invent quantities. Preserve the buyer's SKU codes exactly.
Estimate weight_per_piece_g only if the sheet gives it; otherwise null.
Return ONLY JSON: { "lines": [ {...} ] } matching the schema.
```
Schema: array of the `lines_add` element type above (without `draft`).

### 9.3 P-DISPATCH (vendor email body)
```
Write a professional RFx cover email from {buyer_name}, {buyer_title}, Meridian Foods Pvt Ltd to {vendor_name}.
Include: RFx code {code}, title, one-paragraph scope ({cover_note}), commercial terms (currency, quoting unit, incoterm, freight, payment terms, validity requested, contract duration, delivery locations), response deadline {deadline}, a note that the line-item sheet (Excel) and supplier questionnaire (PDF) are attached, and this exact sentence: "Please reply to this email with your quotation in any format convenient to you — we will process it as sent."
Sign off with buyer name and email. Plain text, no markdown. Under 220 words.
Return ONLY JSON: {"subject": string, "body_text": string}
```

### 9.4 P-CAPTION (fast model; image/PDF summary for classification state)
```
Describe this document in under 80 words for a procurement system: what type of document it appears to be (price quotation, filled questionnaire, certificate, company profile, invoice, unrelated), whether it contains a price table or price list, the currency symbols visible, and the company name if visible. Return plain text.
```

### 9.5 P-EXTRACT (strong model; quotation extraction)
```
You are extracting a supplier's price quotation for a procurement comparison. The buyer issued an RFx with these line items (for context only — DO NOT map items to them, DO NOT convert units, DO NOT convert currency):
{rfx_lines_compact}   # "L1 MF-CB-5P-001 Export carton 5-ply 600x400x400 BF28 | L2 ..."

Extract EVERY quoted item exactly as the supplier wrote it. For each item capture:
- vendor_sku (if any), vendor_description (verbatim), quantity and quantity_unit if given,
- unit_price as a number exactly as written, price_unit_raw verbatim (e.g. "per box", "/1000 pcs", "per kg", "USD per thousand"),
- currency_raw verbatim (symbol or code) or null if not stated,
- pack_size and pack_size_unit if the supplier states pieces per box/bundle for that item,
- discount_pct if a line-level discount is stated, notes for any remark or footnote marker tied to the item,
- location: where in the document the item appears (sheet+cell ref for spreadsheets; page + short verbatim snippet + approximate bounding box [x0,y0,x1,y1] in 0-1 page coordinates for PDFs/images; line number + snippet for text),
- raw_confidence 0-1: your confidence that the numbers were read correctly (lower for blurry/obscured/ambiguous text).
Also extract supplier-level terms into "terms": currency, validity (days or date), freight terms verbatim and whether freight is included, tax terms and whether included, payment terms, any total-level discount with its condition (read footnotes and fine print carefully), any statement that prices reference a previous quote/contract ("same as last year", "as per previous PO") with the verbatim text, other notes, and the location of each.
Rules:
- Never skip an item because it seems irrelevant. Never merge two items.
- If a number is unreadable, still create the item with unit_price null, notes explaining, raw_confidence ≤ 0.3.
- If the document contains no prices at all, return items: [] and explain in terms.other_notes.
- Return ONLY JSON matching the schema.
```
Schema `ExtractionResult`:
```ts
{
  items: Array<{
    vendor_sku: string|null, vendor_description: string,
    quantity: number|null, quantity_unit: string|null,
    unit_price: number|null, price_unit_raw: string|null, currency_raw: string|null,
    pack_size: number|null, pack_size_unit: string|null,
    discount_pct: number|null, notes: string|null,
    location: { type:'cell'|'pdf'|'image'|'text', sheet?:string, ref?:string, page?:number, line?:number, bbox?:number[], snippet:string },
    raw_confidence: number
  }>,
  terms: {
    currency: string|null, validity_days: number|null, validity_until: string|null,
    freight_terms_raw: string|null, freight_included: boolean|null,
    tax_terms_raw: string|null, taxes_included: boolean|null,
    payment_terms_raw: string|null, payment_days: number|null,
    total_discount_pct: number|null, total_discount_condition: string|null,
    references_prior_pricing: boolean, references_prior_pricing_text: string|null,
    other_notes: string|null,
    location: {...}|null
  }
}
```

### 9.6 P-CLARIFY (clarification email draft)
```
Draft a short, polite clarification email from {buyer_name} (Meridian Foods) to {vendor_name} regarding RFx {code}.
We need explicit answers for the following, listed as bullet points the supplier can reply against:
{items}   # e.g. "- Line 14 (5-ply export carton 600x400x400): your quote says 'same as last year'. Please state the current price in INR per 1000 pieces."
Ask them to reply to this email. Keep under 150 words. Plain text.
Return ONLY JSON: {"subject": string, "body_text": string}
```

### 9.7 P-QA-EXTRACT (questionnaire Q&A extraction)
```
The buyer asked a supplier these questions:
{questions}   # "Q1 (yes_no): Do you hold BIS or ISO 9001 certification? | Q2 (yes_no): ... | Q3 (number): Monthly capacity in tonnes ..."
From the supplier's text below, extract the supplier's answer to each question if present: the verbatim answer text, a normalised yes/no (for yes_no), a number (for number), and where it appears (line/page + snippet). If a question is not answered, return found=false.
Do not infer answers from unrelated statements; only from explicit answers or clearly equivalent statements (e.g. "ISO 9001:2015 certified" answers a certification question).
Return ONLY JSON: { "answers": [ {"q_no": number, "found": boolean, "answer_raw": string|null, "answer_bool": boolean|null, "answer_number": number|null, "answer_text": string|null, "location": {...}|null, "confidence": number } ] }
```

### 9.8 P-SQL (query planner + SQL generation; strong model)
```
You convert a procurement buyer's question into ONE PostgreSQL SELECT over these read-only views. Return JSON only.

Views:
v_comparison(rfx_code, line_no, sku, description, ply, item_type, delivery_location, monthly_qty, annual_qty, vendor, vendor_code, state, unit_price, landed_price, original_value, original_unit, original_currency, mapping_probability, annual_value_unit, annual_value_landed, rfx_id, rfx_line_id, vendor_id)
  -- one row per line × vendor. state ∈ confirmed|inferred|reviewed|low_confidence|ambiguous|not_quoted|references_prior|excluded|conflict.
  -- unit_price/landed_price are INR per 1000 pieces; null when not priced.
v_vendor_status(rfx_id, vendor_id, vendor, vendor_code, status, disqualified_reason, lines_priced, lines_total, cleared_questionnaire, validity_until, freight_included)
v_questionnaire(rfx_id, q_no, question, answer_type, disqualify_if, vendor, vendor_code, answer_bool, answer_number, answer_text, probability, state, passes)
v_assumptions(rfx_id, kind, description, basis, made_by, created_at, vendor, line_no)

Hard rules:
- Always filter rfx_id = '{rfx_id}'.
- Only SELECT. No CTE-free restriction (CTEs allowed), no INSERT/UPDATE/DELETE/DROP/ALTER, no semicolons, no comments, no functions other than aggregates, coalesce, round, case, string/number functions.
- "Priced" means unit_price IS NOT NULL. Unless the buyer explicitly asks to include unsure cells, treat state IN ('low_confidence','ambiguous','references_prior','conflict','excluded') as NOT priced and report how many such cells you excluded.
- "Qualified" / "cleared the questionnaire" means v_vendor_status.cleared_questionnaire = true.
- Default price basis is unit_price; use landed_price only if the buyer says landed/delivered/all-in.
- Cheapest per line = the minimum price per line_no among eligible vendors; return the winning vendor and price per line and the total of price × annual_qty / 1000.
- Round money to 0 decimals in output columns named *_inr.
- Prefer returning tidy columns the buyer can read: line_no, description, vendor, price, annual_value_inr, etc.

Return JSON:
{
 "intent": string,                         // one line
 "sql": string,
 "eligibility_rule": string,               // plain words: which vendors/cells were eligible
 "exclusions_note": string,                // plain words: what was excluded and why
 "needs_chart": boolean,
 "chart": {"type":"bar"|"line"|null, "x": string|null, "y": string|null, "series": string|null, "title": string|null},
 "answer_template": string                 // a sentence with {placeholders} referencing result columns/aggregates, e.g. "Cheapest qualified vendor per line totals {total_inr}; {n_lines} lines allocated across {n_vendors} vendors."
}
Question: {question}
Conversation so far (last 4 Q&A, for follow-ups like "and landed?"): {history}
```

### 9.9 P-NARRATE (turn result rows into the answer text; fast model)
```
You are explaining a computed result to a VP of Procurement. You are given the question, the SQL intent, the eligibility rule, the exclusions note, the result rows (JSON, max 50 shown), and aggregate numbers computed by the application (totals, counts). Write 2-5 sentences that state the answer with the key numbers, mention exclusions in one clause, and never introduce any number that is not in the rows or aggregates. Indian number formatting (₹12,34,567). Return ONLY JSON: {"answer_text": string}
```

### 9.10 P-MEMO (award memo narrative sections; strong model)
```
Write the narrative sections of a procurement award memo for RFx {code} at Meridian Foods. Inputs: the allocation table, totals, baseline comparison, exclusions with reasons, the assumptions ledger, open items, the allocation rule in plain words, and manual overrides with reasons.
Sections: 1) Recommendation (3-4 sentences), 2) Basis of award (the rule and eligibility), 3) Key assumptions (bullet list rewritten for a reader, one per ledger kind, referencing vendors), 4) Exclusions and risks (single-source lines, validity, unresolved cells with value at stake), 5) Next steps.
Use only supplied numbers. Formal, concise, Indian number formatting. Return ONLY JSON with those five string fields.
```

---

## 10. Decision layer

### 10.1 Interface (`lib/ai/decision/index.ts`)
```ts
export type ChoiceQ  = { type:'choice';  options: string[]; instruction?: string };
export type ScoreQ   = { type:'score';   scale: {min:number; max:number; labels?: string[]}; instruction?: string };
export type BoolQ    = { type:'boolean'; statement: string };
export type Question = ChoiceQ | ScoreQ | BoolQ;

export type ChoiceA = { type:'choice'; answer: string; probabilities: Record<string, number>; confidence: number };
export type ScoreA  = { type:'score';  answer: number; confidence: number };
export type BoolA   = { type:'boolean'; probability: number };   // p(true)

export interface DecisionResult {
  answers: Record<string, ChoiceA|ScoreA|BoolA>;
  provider: 'jev-openrouter'|'gemini';
  model: string;
  latency_ms: number;
  raw?: unknown;
}

export async function decide(
  state: string,                              // ≤ 6,000 chars, curated
  questions: Record<string, Question>,        // question id → question
  ctx: { rfx_id?: string; response_id?: string; purpose: string }
): Promise<DecisionResult>;
```
Routing: `settings.decision_provider` = `auto` → Jev if `OPENROUTER_API_KEY` present else Gemini; `jev` → Jev, fall back to Gemini on any error; `gemini` → Gemini only. Every call logged to `model_calls`. Each answer written to the consuming table with `provider` and probability, so the UI can label "measured (Jev)" vs "LLM-estimated (Gemini)".

### 10.2 Question sets used in the pipeline

| Purpose | State (curated) | Questions |
|---|---|---|
| classify | file name, mime, first 2,500 chars of derived text or caption | `file_kind`: choice[quotation, questionnaire, supporting, not_relevant]; `contains_prices`: boolean "This document contains item prices or a price list." |
| map | item description/sku/unit/pack + 2 neighbouring items + the 5 candidate lines rendered | `line`: choice[L12…, L14…, …, none_of_these] |
| questionnaire yes/no | question text + extracted answer snippet(s) | `answer`: boolean "The supplier answers YES to: <question>." ; `explicit`: boolean "The supplier explicitly addresses this question." |
| flags | response_terms text fields | booleans: `references_prior_pricing`, `freight_excluded`, `taxes_excluded`, `total_discount_conditional` |
| not-a-quote gate | caption/text | boolean "This document is a price quotation from a supplier." |

### 10.3 OpenRouter → Jev provider
- Endpoint and request shape per OpenRouter's listing for `typesafe/jev-1.13` **(verify at build time; the native TypeSafe shape is `POST /v1/systemone` with `{model, state, questions:{id:{noul|choice|score…}}}` and OpenRouter may expose it as a JSON payload in the message content)**. Implement a thin adapter that maps `Question` → TypeSafe primitives (`boolean`→`noul`, `choice`→`choice`, `score`→`score`) and back. If the adapter cannot parse the response, throw → fallback to Gemini and log `error`.
- Timeout 8 s. Retry once on 429/5xx with backoff.

### 10.4 Gemini emulation provider
Prompt (fast model, `temperature 0`, JSON schema enforced):
```
You are a decision engine. You will be given STATE and a set of typed QUESTIONS. Answer every question strictly within its type:
- choice: pick exactly one option from the list; also give a probability for every option (they must sum to 1).
- boolean: give the probability (0-1) that the statement is TRUE of the state.
- score: give a number within the scale.
Base answers only on the STATE. Do not explain. Calibrate: if the state does not settle the question, spread probability instead of guessing.
STATE:
{state}
QUESTIONS (JSON):
{questions}
Return ONLY JSON: {"answers": {"<id>": {"type":..., "answer":..., "probabilities":{...}, "confidence": 0-1} | {"type":"boolean","probability":0-1} | {"type":"score","answer":n,"confidence":0-1}}}
```
Post-processing: renormalise choice probabilities; clamp; `confidence` for choice = top probability − second probability (mirrors the margin style used by open reproductions).

### 10.5 Thresholds (setting `thresholds`)
- `act` = 0.85, `review` = 0.60. Consumers: mapping (§8.3), questionnaire yes/no (`ambiguous` if 0.40–0.60), classification (`unknown` if top < 0.50 → treat as `supporting` and flag).

---

## 11. Normalisation engine

### 11.1 Unit dictionary (`lib/normalise/units.ts`)
Canonical unit keys: `per_piece`, `per_1000_pcs`, `per_100_pcs`, `per_box`, `per_bundle`, `per_kg`, `per_tonne`, `per_sqm`, `per_set`, `unknown`.
Parsing `price_unit_raw` (case-insensitive regex, in order):
- `/per\s*1000|\/1000|per thousand|per 1,000|\/k\b|per 1k/` → `per_1000_pcs`
- `/per\s*100\b|\/100\b/` → `per_100_pcs`
- `/per\s*(pc|piece|pcs|nos|no\.|unit|each)|\/pc|\/piece|\/nos/` → `per_piece`
- `/per\s*(box|carton|ctn)|\/box/` → `per_box`
- `/per\s*bundle|\/bundle/` → `per_bundle`
- `/per\s*kg|\/kg|kilogram/` → `per_kg`
- `/per\s*(mt|ton|tonne)|\/mt/` → `per_tonne`
- `/sq\.?\s*m|sqm|m2/` → `per_sqm`
- else `unknown` → cell `ambiguous`, review `ambiguous_unit`.
Currency parsing: `₹|INR|Rs\.?` → INR; `\$|USD|US\$` → USD; `€|EUR` → EUR; null → assume RFx currency **and** create assumption `other` "currency not stated; assumed INR" (basis `system_inferred`).

### 11.2 Conversion to `per_1000_pcs` (target from `rfx.quote_unit`)
| From | Factor | Basis required | If basis missing |
|---|---|---|---|
| per_1000_pcs | 1 | — | — |
| per_100_pcs | ×10 | — | — |
| per_piece | ×1000 | — | — |
| per_box / per_bundle | ×(1000 / pack_size) | `pack_size` on the item (vendor_stated) → else pack_size on the same vendor's other items with same ply/dims pattern (system_inferred, p=0.6) → else RFx `spec_attributes.pack_size` if present (rfx_spec) | `ambiguous`; `best_guess_value` computed from the inferred basis if any; review `ambiguous_unit` |
| per_kg | ×(weight_per_piece_g / 1000) × 1000 = × weight_per_piece_g | `rfx_lines.weight_per_piece_g` (rfx_spec) | `ambiguous` |
| per_tonne | ×(weight_per_piece_g / 1,000,000) × 1000 | same | `ambiguous` |
| per_sqm | needs blank area from dims (L×W×H → sheet area) — implement only if `spec_attributes.blank_area_sqm` exists | rfx_spec | `ambiguous` |
| unknown | — | — | `ambiguous` |
Every conversion appends a `conversion_chain` step and, when basis ≠ `vendor_stated`, an `assumptions` row (`unit_conversion` / `pack_size` / `weight_per_piece`).

### 11.3 Currency
`rate = settings.fx_rates[currency].rate` (or `FX_API_URL` fetch once per pipeline run, cached in settings with date). Chain step `currency`; assumption `fx_rate` once per vendor×currency; review item `fx_assumption` once per vendor×currency (informational, buyer acknowledges).

### 11.4 Discounts
- Line-level `discount_pct` → applied (net) with chain step `line_discount`; no assumption needed (vendor stated).
- Total-level `total_discount_pct` → **not applied** by default (`settings.discount_default='gross'`); stored as assumption `discount_treatment` "3% total discount available (condition: …); not applied — toggle to allocate pro rata"; review item `discount_treatment` (vendor-level). If buyer sets treatment to `net` → recompute all that vendor's cells × (1 − pct).

### 11.5 Cell state assignment
| Condition | State |
|---|---|
| mapped p ≥ act AND raw_confidence ≥ 0.60 AND no non-vendor-stated basis used | `confirmed` |
| mapped p ≥ review AND any conversion used a non-vendor-stated basis (fx counts) | `inferred` |
| raw_confidence < 0.60 | `low_confidence` (value shown as best_guess; excluded from computations until reviewed) |
| unit unknown or basis missing | `ambiguous` |
| item notes / terms indicate prior pricing for this line (see 11.6) | `references_prior` |
| no item mapped | `not_quoted` |
| two items compete | `conflict` |
| buyer confirmed/overrode | `reviewed` |
| buyer excluded | `excluded` |

### 11.6 "Rest same as last year" handling
If `response_terms.references_prior_pricing = true`: every RFx line for that vendor **without** an explicit mapped item gets state `references_prior` (not `not_quoted`), `best_guess_note` = the verbatim text. Review item `prior_pricing` at vendor level with actions: Ask vendor (pre-drafted for the affected lines), or Mark as not quoted. The gold key expects `references_prior` for those cells.

### 11.7 Landed cost
`landed = unit + freight_per_1000 (+ tax_per_1000 if settings.landed_cost.include_tax) (+ cost_of_money if pct > 0: unit × pct/100 × (payment_days − rfx.payment_terms_days)/365, only when vendor demands shorter payment)`.
`freight_per_1000` = 0 if `freight_included=true`; else `rfx_vendors.freight_assumption_inr_per_1000` (buyer-entered, default from settings `freight_default_inr_per_1000` e.g. 180, basis `settings_default`) → assumption `freight_treatment` per vendor; review item `freight_treatment`.

---

## 12. Review queue

### 12.1 Generation rules — see §8; dedupe key `(response_id, type, coalesce(rfx_line_id,'-'), coalesce(question_id,'-'))`.
### 12.2 Evidence
`evidence.crop_path` generated for image/pdf locations with bbox via `sharp` (pad 4%); for cells: the row text; for text: ±1 line context. Signed URL served to UI.
### 12.3 Actions and effects
| Action | Effect on `line_quotes` / `questionnaire_answers` | Ledger |
|---|---|---|
| Confirm | state → `reviewed`; value = proposed/best_guess; `reviewed_by/at` | assumption `value_override`? No — assumption `other` "buyer confirmed system value" only for `ambiguous` and `low_confidence`; fx/discount/freight confirms just close the item |
| Override (value + reason) | state → `reviewed`; value = entered; chain step `buyer_override` | `value_override` with before/after |
| Exclude (reason) | state → `excluded`; value null | `exclusion` |
| Map to line (for unmapped) | creates/updates `line_quotes` for that line; unmatched row → `mapped` | `mapping_override` |
| Ignore (unmapped) | unmatched row → `ignored` | — |
| Ask vendor | drafts clarification (P-CLARIFY) with the item(s); on send: `rfx_vendors.status='clarification_sent'`; item status `asked_vendor` | — |
| Mark not quoted (prior_pricing) | affected lines → `not_quoted` | `prior_pricing` "treated as not quoted" |
| Dismiss (informational items) | status `dismissed` | — |
Bulk: "Confirm all FX assumptions", "Acknowledge all informational".

---

## 13. Query layer (Ask panel)

### 13.1 Flow
`POST /api/ask` `{rfx_id, question}` →
1. Load last 4 Q&A for history.
2. Gemini strong: P-SQL → `{intent, sql, eligibility_rule, exclusions_note, needs_chart, chart, answer_template}`.
3. `sql-guard.ts` validates (§13.4). If invalid → one repair round: re-prompt with the validation error. If still invalid → answer "I couldn't form a safe query for that; try rephrasing" and log.
4. Execute via `run_readonly_query(sql)`; cap 500 rows; measure ms.
5. Compute aggregates in TS from rows: sum of any column matching `/annual_value|total/`, count rows, distinct vendors, plus `unresolved_cells` = count of `v_comparison` rows for this rfx with state in the unsure set (so the UI can offer "include best guesses").
6. Gemini fast: P-NARRATE → `answer_text`.
7. Build `chart_spec` (§13.6) if `needs_chart`.
8. Persist `queries` row; return `{answer_text, computed_note: eligibility_rule + ' ' + exclusions_note, sql, rows, chart_spec, exclusions, unresolved_cells, query_id}`.

### 13.2 "Include best guesses" toggle
Re-runs the same SQL after the server rewrites the eligibility clause: replaces `unit_price` with `coalesce(unit_price, best_guess_value)` via a second view `v_comparison_bestguess` (identical to v_comparison but with `best_guess_value` folded in and `state` untouched). The Ask panel shows both totals side by side.

### 13.3 Follow-ups
"And on landed cost?" — the history in P-SQL lets the planner re-issue with `landed_price`. Nothing else special.

### 13.4 SQL guard (`sql-guard.ts`)
- Must start with `select` or `with` (case-insensitive) after trim.
- Reject if matches `/\b(insert|update|delete|drop|alter|create|grant|truncate|copy|call|do)\b/i`, `;`, `--`, `/*`, `pg_`, `information_schema`, `current_user`, `set\s`, `lateral`, `into\s`.
- Must reference only tokens from an allowlist of view names and columns (tokenise identifiers; anything not in the allowlist and not a known function/keyword → reject with the token named).
- Must contain `rfx_id = '<the rfx id>'` literally (server injects/validates).
- Length ≤ 4,000 chars.

### 13.5 Scenario save
If the result rows contain `line_no` and `vendor` columns and one row per line, the UI offers **Save as scenario**; `POST /api/scenarios` with `{name, rule_text: intent, rule: {type:'from_query', query_id}}` copies rows into `scenario_lines`, computes totals, runner-up per line from `v_comparison` (min among eligible excluding winner), baseline = min over vendors of Σ(price × annual_qty/1000) counting only vendors who priced all lines (if none priced all lines, baseline over lines_priced with a note).

### 13.6 ChartSpec
```ts
{ type:'bar'|'line', title:string, x:string, series:Array<{name:string, y:string}>, data: Array<Record<string,number|string>> }
```
Rendered by Recharts. Exports: `GET /api/export/query/{query_id}?format=csv|xlsx`.

---

## 14. Scenarios and award

### 14.1 Built-in allocation rules (`lib/scenarios/allocate.ts`) — deterministic, no model
- `cheapest_per_line` with `qualified_only` boolean and `price_basis` unit|landed.
- `grouped`: array of `{filter:{ply?|item_type?|delivery_location?|line_nos?}, rule}`; lines not covered by a group → unallocated (flagged).
- `weighted`: per vendor score = `w_price × (min_price_on_line / vendor_price) + w_q × questionnaire_score` where questionnaire_score = fraction of mandatory questions answered `passes=true`; winner = highest score per line.
Eligible cells: state in (`confirmed`,`inferred`,`reviewed`) with non-null price; include `low_confidence/ambiguous` best guesses only if `include_best_guess=true`.

### 14.2 Scenario comparison page
Columns per scenario: total (annual, INR), vendors used, share per vendor (%), single-source lines (count), unallocated lines, savings vs baseline, savings vs previous scenario. Charts: stacked bar of share per vendor.

### 14.3 Award memo (`lib/award/memo.tsx`, react-pdf)
Pages: (1) Header (RFx code, title, category, dates, prepared/approved), Recommendation, Basis of award. (2) Allocation table: line_no, description, annual_qty, vendor, price/1000, annual value, runner-up, gap %, reason. (3) Totals & baseline; exclusions (vendor + reason); single-source lines; validity per vendor. (4) Assumptions ledger (kind, vendor, line, description, basis, made by). (5) Open items (unresolved cells with annual value at stake = best_guess × annual_qty/1000; manual overrides). (6) Rule in plain words + the SQL if from a query; signatures. Narrative sections from P-MEMO; all numbers from the DB.
`POST /api/award/{rfx}/generate` → stores PDF in `outbound`, `awards.status='draft'`. `POST /api/award/{rfx}/approve` (approver role) → `approved`, `rfx.status='awarded'`, grid read-only, audit event.

---

## 15. Email

### 15.1 Common (`lib/email/index.ts`)
`sendEmail({rfx_id, vendor_id, kind, to, subject, text, attachments:[{name, path|buffer, mime}]})` → dispatches to mode implementation; writes `communications` row before send (status queued) and updates after. Reply-To tag: `${GMAIL_USER local}+${reply_tag}@gmail.com` where `reply_tag = rfx-${rfx.code.toLowerCase()}-${vendor.short_code}` and for clarifications `…-clar-${n}`. `tag.ts` parses any address/subject for `/rfx-([a-z0-9-]+)-([a-z0-9]+)(?:-clar-(\d+))?/`.

### 15.2 Mock mode
- `sendEmail` marks status `sent` with `mode='mock'`, `sent_at=now()`; Outbox page lists them with "Open" (renders body + attachments).
- Inbox page: per vendor card → drop zone (multiple files) + textarea "Paste email body" → `POST /api/responses` (multipart) → creates `responses(source='mock_upload'|'mock_paste')`, `response_files`, `communications(direction inbound, mode mock)`; then client runs stages.
- Vendor Portal Simulator: `/rfx/{id}/portal/{vendorId}` renders the dispatch email as the vendor sees it, with a reply form (same endpoint, `source='portal'`).
- Load seeded responses: `POST /api/rfx/{id}/seed-responses` copies the five Dataset Pack files from bucket `seed` into `raw`, creates five responses (`source='seed'`), returns ids; client runs stages for each (sequentially or two in parallel).

### 15.3 Gmail mode
- **Send:** `nodemailer.createTransport({host:'smtp.gmail.com', port:465, secure:true, auth:{user:GMAIL_USER, pass:GMAIL_APP_PASSWORD}})`; `from: "Sujit Menon (Meridian Foods) <GMAIL_USER>"`; `replyTo` tagged; attachments from Storage buffers; capture `info.messageId` → `communications.message_id`, status `sent`.
- **Receive:** `POST /api/email/sync` `{rfx_id}`: `imapflow` connect (host imap.gmail.com, 993, secure), `mailbox='INBOX'`, search `{seen:false}` (and, for robustness, `since: rfx.issued_at`), fetch `source` for each, `mailparser.simpleParser`, parse tag from `to`, `cc`, `replyTo`? — the *reply* arrives addressed **to** the tagged Reply-To, so parse `to` first, then subject, then `in_reply_to` matched against `communications.message_id`. If tag found → create `responses(source='gmail')`, store `.eml` raw, attachments to `raw`, `communications(inbound, message_id=parsed.messageId)`; mark `\Seen` and add label/flag `QuoteLens/processed`. If no tag → still store as `responses(vendor_id=null)` + review item `unknown_vendor` (only if the message is a reply to something we sent or the subject mentions RFx; otherwise ignore). Idempotency: unique `communications.message_id`; on conflict skip.
- Client polling: RFx overview page calls sync every 30 s while open and on button click; each returned response id triggers the stage chain.
- Vendor addresses for demo: `settings.vendor_addresses` maps short_code → `secondaccount+balaji@gmail.com` etc.; `vendors.email` shows the "real-looking" address on screen, and the send uses the mapped demo address when present. (Both stored; UI shows a small "demo address" badge in gmail mode.)

### 15.4 Resend mode
Stub: `resend.ts` exports `sendEmail` that throws `NotConfigured` and a webhook route `POST /api/email/resend-webhook` that validates the signature header shape and returns 501 unless `RESEND_API_KEY` set. Documented as a future path.

---

## 16. API routes (App Router route handlers)

All JSON unless noted; all require session cookie; errors `{error, code}`.

| Method & path | Body / params | Returns | Notes |
|---|---|---|---|
| `POST /api/auth/login` | `{email,password}` | `{user}` | seeded users |
| `POST /api/auth/logout` | — | — | |
| `GET /api/rfx` | — | list with status, counts | |
| `POST /api/rfx` | `{title?, category?}` | `{rfx}` draft | |
| `GET /api/rfx/{id}` | — | rfx + lines + questions + vendors + comms + response summaries | overview |
| `PATCH /api/rfx/{id}` | partial rfx fields, lines (replace set), questions, vendors | `{rfx}` | draft only |
| `POST /api/rfx/{id}/copilot` | `{message, attachments?:[{name, text}]}` | `CopilotTurn` applied + `{rfx}` | uses P-COPILOT; line sheets parsed via P-LINESHEET |
| `POST /api/rfx/{id}/issue` | — | `{rfx}` | freezes v1, generates attachments (xlsx via exceljs, questionnaire pdf via react-pdf), sends per vendor via `sendEmail`, status `issued`, audit |
| `POST /api/rfx/{id}/seed-responses` | — | `{response_ids}` | mock |
| `POST /api/responses` | multipart: `rfx_id, vendor_id?, email_text?, files[]`, `source` | `{response_id}` | mock/portal |
| `POST /api/responses/{id}/stage/{stage}` | — | `{status, summary, errors}` | stage ∈ classify, extract, map, normalise, questionnaire, flags; `maxDuration=300` |
| `POST /api/responses/{id}/run-all` | — | streamed NDJSON of stage events | optional convenience; server chains stages |
| `GET /api/responses/{id}` | — | files (signed urls), items, terms, status, summary | |
| `POST /api/responses/{id}/assign-vendor` | `{vendor_id | new_vendor:{name,email}}` | | unmatched |
| `GET /api/review?rfx=` | filters `type, vendor, status` | items with evidence urls | |
| `POST /api/review/{id}/{action}` | action ∈ confirm, override, exclude, map, ignore, ask-vendor, mark-not-quoted, dismiss; body per action | updated item + affected cells | |
| `POST /api/review/bulk` | `{ids, action}` | | |
| `GET /api/rfx/{id}/comparison` | `?basis=unit|landed&original=1` | grid model: lines × vendors with cells (state, value, chain, prob, provider), vendor headers (coverage, validity, cleared, freight), legend counts | |
| `GET /api/rfx/{id}/cell/{line}/{vendor}` | — | provenance drawer payload (file signed url, crop url, snippet, chain, assumptions, review history) | |
| `GET /api/rfx/{id}/unmatched` | — | items with candidates | |
| `GET /api/rfx/{id}/ledger` | — | assumptions (active) | |
| `GET /api/rfx/{id}/timeline` | — | audit events | |
| `POST /api/ask` | `{rfx_id, question, include_best_guess?}` | see §13.1 | |
| `GET /api/ask/history?rfx=` | — | last 20 | |
| `POST /api/scenarios` | `{rfx_id, name, rule | query_id}` | scenario with lines | |
| `GET /api/scenarios?rfx=` | — | list with totals | |
| `POST /api/scenarios/{id}/override` | `{rfx_line_id, vendor_id, reason}` | recomputed | |
| `POST /api/award/{rfx}/generate` | `{scenario_id}` | `{award, memo_url}` | |
| `POST /api/award/{rfx}/approve` | — | | approver only |
| `POST /api/email/sync` | `{rfx_id}` | `{new_response_ids, skipped}` | gmail |
| `GET /api/email/outbox?rfx=` | — | comms outbound | |
| `POST /api/clarify` | `{rfx_id, vendor_id, review_item_ids}` | draft `{subject, body}` (not sent) | P-CLARIFY |
| `POST /api/clarify/send` | `{rfx_id, vendor_id, subject, body, review_item_ids}` | comm | |
| `GET/PUT /api/settings` | — / `{key,value}` | | admin |
| `POST /api/eval/run` | `{rfx_id}` | eval_run | |
| `GET /api/export/comparison?rfx=&format=xlsx|csv&basis=` | — | file | |
| `GET /api/export/query/{id}?format=` | — | file | |
| `GET /api/export/memo/{award_id}` | — | pdf | |
| `GET /api/logs?rfx=` | — | model_calls | admin |

---

## 17. Screens (component-level)

### 17.1 Global
- Left nav: RFx, Settings, Eval, Logs. Top-right: user switcher (Sujit/Priya) — implemented as logout + login shortcut for demo speed.
- Toasts for every action; skeletons for loads; empty states with one-line guidance.

### 17.2 RFx list — table: code, title, category, status badge, vendors (responded/invited), lines, deadline, updated. Button **New RFx**.

### 17.3 New RFx — two panes. Left: co-pilot chat (messages, attachment button accepting xlsx/csv/txt whose parsed text is sent with the message, suggested questions as chips). Right: tabs **Lines** (editable data table: line_no, sku, description, ply, L/W/H, gsm, BF, type, weight g, monthly qty, annual qty (auto = ×12, editable), location; add/remove; import from parsed sheet), **Terms** (form), **Questionnaire** (editable list with type, mandatory, disqualify), **Vendors** (list with name/email; add from address book). Button **Issue RFx** (confirm dialog listing what will be sent and to whom; in gmail mode shows the demo addresses).

### 17.4 RFx overview — header (code, title, status, version, deadline). Vendor cards ×N: name, status chip (invited / responded / clarification sent / disqualified), lines priced x/30, validity, queue count, buttons **Open response**, **Portal (mock)**. **Vendor Communications** timeline (all comms with direction icon, timestamp, subject, attachments, message id, status). Buttons **Sync inbox** (gmail), **Load seeded responses** (mock), **Go to Review**, **Go to Comparison**. Unmatched responses panel if any.

### 17.5 Inbox (mock) — vendor cards each with drop zone + textarea + **Submit as vendor**. After submit → redirect to Response Detail with pipeline running.

### 17.6 Vendor Portal Simulator — looks like a mailbox: "From Sujit Menon", subject, body, attachments (download), then **Reply** form (files + text) → same as Inbox submit with `source='portal'`.

### 17.7 Response Detail — top: vendor, source, received_at. **Pipeline strip**: six stages with state and duration, Retry per stage, **Run all**. Sections: Files (name, kind badge with probability + provider, preview link), Extracted items table (raw fields + location snippet + raw_confidence bar; click → highlights source), Terms card, Flags chips, Summary counts, **Go to Review Queue (n)**.

### 17.8 Review Queue — filters (vendor, type, status). List of cards: title, vendor, line, type chip, probability bar with provider tag, **Evidence** (image crop / snippet / cell row), proposed value/state, action buttons (Confirm · Override · Exclude · Ask vendor · Map to line · Ignore · Mark not quoted · Dismiss), history. Bulk bar. Keyboard: J/K move, C confirm.

### 17.9 Comparison — toolbar: basis toggle (Unit / Landed), Show original, Include disqualified, Export XLSX/CSV, legend (state colours + counts). Tabs: **Prices** (data table; sticky first column; vendor header cells with coverage, validity, cleared ✓/✗, freight badge, total on priced lines; per-line min highlighted; cell renders value or state label; icons for inferred/reviewed; click → Provenance drawer), **Questionnaire** (10 × N grid with ✓/✗/?/– and probability tooltip; click → evidence), **Documents** (per vendor list: file, kind, pages, preview), **Ledger** (table: kind, vendor, line, description, basis, made by, when; filter), **Timeline**. Right panel **Ask** (input, history list, answer cards each with: answer_text, table (paginated), chart, "How I computed this" + Show query (code block), exclusions list, unresolved_cells notice with **Include best guesses** button, **Save as scenario**, **Export**). Bottom collapsible **Unmatched items**.

### 17.10 Provenance drawer — header (line, vendor, state, value); **Source** (file name, page/cell; image crop or PDF page image with bbox overlay; text snippet highlighted); **Mapping** (chosen line, probability, provider label "measured (Jev)" or "LLM-estimated (Gemini)", alternatives with probabilities); **Conversion chain** (step list with basis and assumption links); **Review history**; buttons to open in Review Queue.

### 17.11 Scenarios — cards per scenario with totals; compare table; stacked bar; **New scenario** dialog (rule builder: type, qualified only, basis, groups, weights slider); per-line override inside a scenario (dialog with reason); **Generate award memo** from a selected scenario.

### 17.12 Award — memo preview (PDF embed), status, **Approve** (approver only), download.

### 17.13 Settings — email mode (radio; gmail requires env vars present — show check), decision provider (auto/gemini/jev with detected key status), thresholds (two sliders), FX rates table (currency, rate, date, source; edit), landed cost options, discount default, vendor demo addresses map, freight default. Save → audit event.

### 17.14 Eval — select seeded RFx; **Run eval**; totals cards (cells correct / flagged-OK / wrong / missing; questionnaire correct); per-cell table (line, vendor, expected, got, state, verdict) with filters; link each row to Provenance.

### 17.15 Logs — model_calls table (time, purpose, provider, model, tokens, ms, ok) with filters.

---

## 18. Eval (`lib/eval/run.ts`)
- Gold key file `seed/gold.json` (Dataset Pack §): `cells: [{line_no, vendor_code, expected_state, expected_unit_price_inr_per_1000|null, tolerance_pct}]`, `questionnaire: [{q_no, vendor_code, expected_bool|expected_number|expected_text_contains}]`.
- Verdict per cell: `correct` if states match and (for priced) |got − expected| ≤ tolerance (default 1.0%); `flagged_ok` if expected is a priced value but got is `ambiguous`/`low_confidence` with best_guess within tolerance (system was honest); `wrong` if priced and out of tolerance, or state mismatch not covered above; `missing` if no cell.
- Runs against the **current** state (pre- or post-review); page shows which. Stores `eval_runs`.

---

## 19. Logging, errors, retries
- `log.ts` wraps every model call: start/end, tokens from response metadata, latency; on exception writes `ok=false, error`.
- Gemini: retry once on 429/5xx with 2 s backoff; on JSON validation failure retry once with error feedback (§8.2).
- Pipeline stage errors are surfaced as `{stage, message}` in `responses.stage_errors` and shown in the UI with Retry; never swallow.
- Client: all API errors → toast with `code`; long operations show elapsed time.
- Audit events for every user action (login excluded).

---

## 20. Seeding (`scripts/seed.ts`)
1. Create users (Sujit buyer/admin, Priya approver) with `SEED_ADMIN_PASSWORD`.
2. Create five vendors (§PRD 6.4) with short codes; demo Gmail aliases into `settings.vendor_addresses`.
3. Create RFx **MER-0417**: lines from `seed/rfx_lines.csv`, questions from `seed/questions.json`, terms per PRD §7, vendors invited, status `issued`, frozen v1; copy dataset files to bucket `seed`.
4. Create RFx **MER-0418**: identical lines/questions, status `draft` (for the live demo), and **MER-0419** draft copy for the mock "Load seeded responses" run.
5. Insert settings defaults.
6. Optionally (flag `--run-pipeline`) load seeded responses into MER-0417 and run all stages so the demo account opens with a completed RFx; then run eval and store.
`npm run seed` and `npm run seed:full`.

---

## 21. Deployment
1. Supabase: new project → run `0001_init.sql`, `0002_views.sql` (via Supabase SQL editor or MCP `apply_migration`); create buckets `raw`, `derived`, `outbound`, `seed` (private); copy service role key.
2. Vercel: import repo; set env vars (§4); enable **Fluid Compute** in project settings; `vercel.json`:
```json
{ "functions": { "src/app/api/responses/**": { "maxDuration": 300 }, "src/app/api/ask/**": { "maxDuration": 120 }, "src/app/api/rfx/**": { "maxDuration": 120 }, "src/app/api/email/**": { "maxDuration": 120 } } }
```
   and `export const maxDuration = 300` inside the pipeline route files (both required for Next.js).
3. Gmail (gmail mode): sender account with 2-step verification → App Password; second personal account for the five plus-aliases; add both to env/settings.
4. Run `npm run seed:full` against production (or via a protected `POST /api/admin/seed` route guarded by `SEED_ADMIN_PASSWORD` header) so the demo account is ready.
5. Smoke test §22.

---

## 22. Test checklist (manual, before demo)
1. Login both users.
2. New RFx via co-pilot: paste line sheet → 30 lines parsed; questionnaire proposed; terms set; vendors added; Issue → Outbox shows 5 (mock) / Gmail shows 5 sent with message ids.
3. Load seeded responses on MER-0419 → all five reach `flags: done`; Review Queue contains: 1 low-confidence (OrientPack obscured row), 4 ambiguous units (Westline), 1 prior-pricing (Anand) + its lines, 1 FX (OrientPack), 1 discount treatment (Balaji), 1 freight (OrientPack, Anand), 3 not-quoted for Kohinoor visible in grid, footnote discount ledger entry (Kohinoor).
4. Provenance drawer on: an Excel cell, a PDF footnote, a Word sentence, an image crop, an email line.
5. Clear the queue; confirm cell states update.
6. Q1–Q8 return computed answers with SQL visible; "include best guesses" changes totals; export works.
7. Save scenario; compare two; generate memo; approve as Priya; grid locks.
8. gmail mode: Issue MER-0418 → emails in second account; reply from phone with photo → Sync → response appears → extraction runs → cell lands.
9. Upload an unrelated PDF (e.g. a certificate) as a vendor response → classified supporting/not relevant; no crash.
10. Upload a quote from a different category → items land in Unmatched; grid unchanged.
11. Eval page shows ≥ 143/150 or the honest number.
12. Logs page shows provider per call; switch decision provider in Settings and re-run classify on one response.

---

## 23. Cost and performance budget
| Operation | Model | Approx tokens | Calls per seeded run | Est. time |
|---|---|---|---|---|
| Caption (images/PDFs) | fast | 1–3k in / 0.2k out | ≤ 8 | 3 s each |
| Classify (decision) | fast/Jev | 1–2k | ≤ 10 | 1–2 s |
| Extract | strong | 5–30k in / 2–6k out | 5–6 | 15–45 s each |
| Map (decision) | fast/Jev | 1k | ~150 (batch 10 items per call → 15) | 1–2 s |
| Questionnaire | strong + fast | 4–12k | 5 + 50 booleans (batch per vendor → 5) | 5–10 s |
| Flags | fast | 1k | 5 | 1 s |
| Ask | strong + fast | 3–5k | 2 per question | 4–8 s |
| Memo | strong | 6k | 1 | 10 s |
Total per seeded run: ~5–8 minutes wall time when stages run sequentially; run vendors two at a time. Gemini cost per full run: well under ₹50 at current Flash pricing **(verify)**.

Batching note: decision questions are batched — one `decide()` call per response for classification of all files; one call per 10 items for mapping; one call per vendor for all yes/no questionnaire booleans. This keeps call counts low whether Jev or Gemini answers.

---

*End of FSD/TRD. Next: document 3 — Dataset Pack.*
