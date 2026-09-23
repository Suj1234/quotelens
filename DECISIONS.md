# Decisions

Format: date · what was specified · what was found/used instead · why · where it matters.

- **2026-09-23 · Doc filenames.** CLAUDE.md refers to `docs/01_PRD.md` / `docs/02_FSD_TRD.md`; the files are `docs/01_PRD_Kill_the_Quote_Spreadsheet.md` / `docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md`. Kept the files as delivered. Matters only when locating sections.
- **2026-09-23 · Next.js.** TRD §2 says 15.x (verify). `create-next-app@latest` gave **16.3.6** with React 19.2 and Tailwind **v4** (CSS-first config, no `tailwind.config`). Tokens live in `src/app/globals.css` (`:root` + `@theme inline`), which is how DESIGN.md's "tailwind.config theme extensions" maps to v4. Next 16 ships `AGENTS.md` with the rule to read `node_modules/next/dist/docs/` before writing Next-specific code; kept.
- **2026-09-23 · shadcn/ui.** CLI 4.21.0, style `radix-nova`, base Radix. `toast` is no longer offered for Radix projects → using **`sonner`**. shadcn CSS variables are mapped onto DESIGN.md tokens in `globals.css`; radii capped at 3/5/6px.
- **2026-09-23 · SheetJS.** npm `xlsx@0.18.5` has an unfixed high-severity advisory (prototype pollution / ReDoS) and we parse untrusted vendor files → installed **0.20.3 from `cdn.sheetjs.com`** (SheetJS's official distribution). Remaining `npm audit` item: `uuid@8` via exceljs (buffer path of v3/v5/v6 only; exceljs uses v4) — not reachable.
- **2026-09-23 · Fonts.** DESIGN.md §1.3 says self-host woff2 in `/public/fonts`. Using `next/font/google` (IBM Plex Sans 400/500/600, Mono 400/500), which downloads at build time and serves from our own origin — same outcome, no manual font files.
- **2026-09-23 · Theme.** DESIGN.md's `localStorage["ql-theme"]` + `data-theme` on `<html>` (prototype's mechanism); no stored value = follow OS. Tailwind `dark:` variant bound to `[data-theme="dark"]`.
- **2026-09-23 · `@types/node`.** Scaffold pinned `^20`; vitest 5 peers need ≥22. Runtime is Node 22 → `@types/node@^22`.
- **2026-09-23 · `server-only` in scripts/tests.** `tsx` scripts run with `--conditions=react-server` so `server-only` resolves to its empty module; vitest aliases it to a stub.
