# Progress
## Current: Phase P0, next task P0-T5 (deploy) — then P0-T6 (needs Gemini key)
## Deploy URL: — (P0-T5)
## Eval (latest): — (P2-T8)
## Done
- [x] P0-T1 Scaffold — Next 16.3.6 + Tailwind v4 + shadcn (radix-nova, sonner instead of toast), all listed deps, DESIGN tokens in globals.css, IBM Plex via next/font, `.env.example`, vitest config. `npm run dev` shows a page.
- [x] P0-T2 Supabase — migrations 0001 (TRD §6.1–6.20 verbatim + RLS lock-down), 0002 (§6.21 views + `run_readonly_query`), 0003 (buckets); validated on embedded Postgres; `src/lib/db.ts`, `src/types/db.ts`. Applied 2026-09-23 with `npm run db:migrate`; `db:check`: rfx count ran, 4 private buckets, `run_readonly_query` OK. Publishable key blocked from `users` and views (42501).
- [x] P0-T3 Auth — iron-session cookie, `POST /api/auth/login` + `/logout`, `requireUser()`/`requireApiUser()`, sign-in at `/` per DESIGN §3.1 (demo rows prefill email). Verified: logged-out `/rfx` → 307 to `/`; bad body → 400 `{error,code}`. Real login verified for Sujit and Priya; wrong password → 401; signed-in `/` → `/rfx`.
- [x] P0-T4 Seed — `scripts/seed.ts` (users, 5 vendors, MER-0417/0418/0419 with 30 lines, 10 questions, 5 invited vendors + reply tags, settings defaults, dataset → bucket `seed`). App shell (top bar, rail, theme toggle, sign-out) and RFx list `/rfx` per DESIGN §2.1–2.2, §3.2. Build/lint/types/tests green. Ran twice (idempotent): 2 users, 5 vendors, 3 RFx, 90 lines, 30 questions, 15 invitations, 7 settings, 34 dataset files in bucket `seed`. `/rfx` lists MER-0417/0418/0419 for both users; New RFx button buyer-only.
## In progress
## Open questions (for Sabarish)
- Recommended: reset the Supabase database password (it appeared once in a script error during setup) and update `DATABASE_URL` in `.env.local`.
- **Blocking P0-T5:** Vercel project linked to the repo (and a GitHub remote to push to).
- **Blocking P0-T6:** Gemini API key.
## Known issues
- Side-by-side check vs prototype at 1440px not yet done for sign-in and RFx list (do at P0 end, once data is seeded).
