# Progress
## Current: Phase P1, next task P1-T4 (response intake)
## Deploy URL: https://quotelens-seven.vercel.app
## Eval (latest): — (P2-T8)
## Done
- [x] P0-T1 Scaffold — Next 16.3.6 + Tailwind v4 + shadcn (radix-nova, sonner instead of toast), all listed deps, DESIGN tokens in globals.css, IBM Plex via next/font, `.env.example`, vitest config. `npm run dev` shows a page.
- [x] P0-T2 Supabase — migrations 0001 (TRD §6.1–6.20 verbatim + RLS lock-down), 0002 (§6.21 views + `run_readonly_query`), 0003 (buckets); validated on embedded Postgres; `src/lib/db.ts`, `src/types/db.ts`. Applied 2026-09-23 with `npm run db:migrate`; `db:check`: rfx count ran, 4 private buckets, `run_readonly_query` OK. Publishable key blocked from `users` and views (42501).
- [x] P0-T3 Auth — iron-session cookie, `POST /api/auth/login` + `/logout`, `requireUser()`/`requireApiUser()`, sign-in at `/` per DESIGN §3.1 (demo rows prefill email). Verified: logged-out `/rfx` → 307 to `/`; bad body → 400 `{error,code}`. Real login verified for Sujit and Priya; wrong password → 401; signed-in `/` → `/rfx`.
- [x] P0-T4 Seed — `scripts/seed.ts` (users, 5 vendors, MER-0417/0418/0419 with 30 lines, 10 questions, 5 invited vendors + reply tags, settings defaults, dataset → bucket `seed`). App shell (top bar, rail, theme toggle, sign-out) and RFx list `/rfx` per DESIGN §2.1–2.2, §3.2. Build/lint/types/tests green. Ran twice (idempotent): 2 users, 5 vendors, 3 RFx, 90 lines, 30 questions, 15 invitations, 7 settings, 34 dataset files in bucket `seed`. `/rfx` lists MER-0417/0418/0419 for both users; New RFx button buyer-only.
- [x] P0-T5 Deploy — GitHub `Suj1234/quotelens`, Vercel Hobby project `quotelens`, functions pinned to `hnd1` (Tokyo, next to Supabase ap-northeast-1). Verified on production: sign-in renders, logged-out `/rfx` → `/`, wrong password 401, Sujit and Priya sign in and see MER-0417/0418/0419; `x-vercel-id` shows `hnd1`.
- [x] P0-T6 Model check — key works (32 Gemini models visible). FAST=`gemini-3.5-flash-lite`, STRONG=`gemini-3.8-flash`; both return valid schema JSON on text, the Kohinoor PDF and the OrientPack photo (`npm run check:models`). Details in DECISIONS.md.
- [x] P1-T1 Storage helpers — `src/lib/storage.ts` put/get/list/signedUrl with TRD §5 paths; round-trip + signed-URL fetch verified against Supabase.
- [x] P1-T2 Preprocessors — `src/lib/preprocess/` xlsx (cell refs, text numbers verbatim, comments, hidden rows marked, empty sheets dropped, 2,000-cell cap), docx (`[p N]`, `[table t row r]`), email/txt/eml (quoted blocks, `On … wrote:`, `-- ` and `Sent from my` removed; `[l N]`), image (EXIF rotate, ≤2000 px, normalise), pdf (page count, >20 pages split). 13 unit tests on the realistic seed files green.
- [x] P1-T3 Gemini client — `src/lib/ai/gemini.ts` `generateJSON` (Zod → `responseJsonSchema`, validate, one retry with the validation error, one retry on 429/5xx after 2 s, `MODEL_INVALID`/`MODEL_ERROR`), `generateText`, `inlineFile`; `src/lib/log.ts` `logModelCall`/`audit`. Live: strong model read the Kohinoor PDF (vendor, 2 pages, the * footnote verbatim); calls land in `model_calls`. 4 unit tests (mocked provider) green.
## In progress
## Open questions (for Sabarish)
- Recommended: reset the Supabase database password (it appeared once in a script error during setup) and update `DATABASE_URL` in `.env.local`.
- Add `NEXT_PUBLIC_APP_URL=https://quotelens-seven.vercel.app` in Vercel env (needed from P5 for links in emails; picked up on the next deploy).
## Known issues
- P0 checkpoint: sign-in and RFx list compared with the prototype at 1440 px (match; prototype renders in quirks mode, see DECISIONS) and checked at 375/768/1440/2560 px on production — no sideways page scroll, tables scroll inside their card on phones.
