# Progress
## Current: Phase P0 — blocked on credentials (see Open questions); next P0-T5 after verifying T2–T4
## Deploy URL: — (P0-T5)
## Eval (latest): — (P2-T8)
## Done
- [x] P0-T1 Scaffold — Next 16.3.6 + Tailwind v4 + shadcn (radix-nova, sonner instead of toast), all listed deps, DESIGN tokens in globals.css, IBM Plex via next/font, `.env.example`, vitest config. `npm run dev` shows a page.
- [~] P0-T2 Supabase — migrations 0001 (TRD §6.1–6.20 verbatim + RLS lock-down), 0002 (§6.21 views + `run_readonly_query`), 0003 (buckets); validated on embedded Postgres; `src/lib/db.ts`, `src/types/db.ts`. **Not yet applied** — waiting for Supabase project + keys. Verify with `npm run db:check`.
- [~] P0-T3 Auth — iron-session cookie, `POST /api/auth/login` + `/logout`, `requireUser()`/`requireApiUser()`, sign-in at `/` per DESIGN §3.1 (demo rows prefill email). Verified: logged-out `/rfx` → 307 to `/`; bad body → 400 `{error,code}`. **Real login pending** seeded users (needs Supabase).
- [~] P0-T4 Seed — `scripts/seed.ts` (users, 5 vendors, MER-0417/0418/0419 with 30 lines, 10 questions, 5 invited vendors + reply tags, settings defaults, dataset → bucket `seed`). App shell (top bar, rail, theme toggle, sign-out) and RFx list `/rfx` per DESIGN §2.1–2.2, §3.2. Build/lint/types/tests green. **Not yet run** — needs Supabase. Verify: `npm run seed` then sign in → `/rfx` lists three RFx.
## In progress
## Open questions (for Sabarish)
- **Blocking P0-T2..T4:** Supabase project URL + service-role (or `sb_secret_…`) key; `SEED_ADMIN_PASSWORD`. Paste into `.env.local` (git-ignored). Then run `supabase/migrations/0001_init.sql`, `0002_views.sql`, `0003_storage.sql` in the Supabase SQL editor (or share the DB connection string and I apply them).
- **Blocking P0-T6:** Gemini API key.
## Known issues
- Side-by-side check vs prototype at 1440px not yet done for sign-in and RFx list (do at P0 end, once data is seeded).
