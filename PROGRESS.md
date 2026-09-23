# Progress
## Current: Phase P0, next task P0-T4
## Deploy URL: — (P0-T5)
## Eval (latest): — (P2-T8)
## Done
- [x] P0-T1 Scaffold — Next 16.3.6 + Tailwind v4 + shadcn (radix-nova, sonner instead of toast), all listed deps, DESIGN tokens in globals.css, IBM Plex via next/font, `.env.example`, vitest config. `npm run dev` shows a page.
- [~] P0-T2 Supabase — migrations 0001 (TRD §6.1–6.20 verbatim + RLS lock-down), 0002 (§6.21 views + `run_readonly_query`), 0003 (buckets); validated on embedded Postgres; `src/lib/db.ts`, `src/types/db.ts`. **Not yet applied** — waiting for Supabase project + keys. Verify with `npm run db:check`.
- [~] P0-T3 Auth — iron-session cookie, `POST /api/auth/login` + `/logout`, `requireUser()`/`requireApiUser()`, sign-in at `/` per DESIGN §3.1 (demo rows prefill email). Verified: logged-out `/rfx` → 307 to `/`; bad body → 400 `{error,code}`. **Real login pending** seeded users (needs Supabase).
## In progress
## Open questions (for Sabarish)
## Known issues
