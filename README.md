# QuoteLens

**Kill the Quote Spreadsheet.** QuoteLens takes a buyer from an RFx to a defensible award. Vendors reply in whatever format they like (spreadsheet, PDF, Word, a photo of a printed rate card, a plain email). QuoteLens reads every reply and puts them all into one side-by-side comparison with the same lines, units and currency. When it isn't sure about something, it says so.

**Live demo:** https://quotelens-seven.vercel.app

---

## What it does

1. **Draft the RFx with a co-pilot.** Describe what you need in plain words, or paste a line sheet. The co-pilot fills in lines, terms, the questionnaire and the vendor list.
2. **Issue it to vendors.** A line-sheet .xlsx and a questionnaire PDF go out, with one email per vendor. Mail is mocked (Outbox/Inbox) and a Vendor Portal Simulator is included.
3. **Accept replies in any format.** Each reply goes through a staged pipeline: *classify → extract → map → normalise → questionnaire → flags*. Every stage is a separate request whose output is saved, so any stage can be retried on its own.
4. **Compare side by side.** 30 lines × 5 vendors, converted to ₹ per 1000 pcs, with unit or landed cost. Every cell has a state: `confirmed`, `inferred`, `ambiguous`, `low confidence`, `not quoted`, `references prior pricing` or `reviewed`.
5. **Show where every number came from.** Click any cell to see the source (spreadsheet row, PDF page, photo crop, email line), the mapping options with their probabilities, the full conversion chain and the assumptions it used.
6. **Review queue.** Anything uncertain lands here. The buyer confirms, overrides, excludes or remaps it, or asks the vendor. Clarification replies update only the cells they affect.
7. **Ask in plain language.** Questions are turned into SQL that is checked before it runs read-only. Every answer is computed from data, and the query is shown with it, along with the exclusions and any unresolved cells. Answers can be exported to CSV or XLSX.
8. **Award.** Save scenarios (cheapest per line, grouped) and compare them. Then generate the award memo PDF with the assumptions ledger. The approver signs off and the RFx locks.

## The rule it follows

> Stub the plumbing, but the AI loops must be real.

Extraction, mapping and reasoning run live on the uploaded files every time. Nothing is cached by file content, no seed file gets special treatment, and no demo answer is hardcoded. Every model output is validated with Zod before it is written, and every model call is logged (Settings → Activity).

## Demo data

The seeded company is Meridian Foods. It is buying corrugated boxes from five vendors, each of which breaks the tidy path in its own way:

| Vendor | Format | The ugly edge |
|---|---|---|
| Sri Balaji Packaging | .xlsx | Generic descriptions; a conditional total discount |
| Kohinoor Corrugators | PDF | Quotes 27 of 30 lines; short validity; payment footnote |
| Westline Packaging | .docx prose | "Per bundle" with no bundle size on 4 lines; fails the BRC question |
| OrientPack | Photo of a printed rate card | Priced in USD, FOB; one price hidden under a thumb shadow |
| Anand Packaging | Plain email | Two ₹/kg rates plus "rest same as last year" |

RFx in the demo account:
- **MER-0417**: completed and approved (realistic, messier replies)
- **MER-0418**: draft, for a live run
- **MER-0419**: issued. Click *Load seeded responses* to run the pipeline live.

Sign in as **Sujit** (buyer) or **Priya** (approver). The sign-in page has a button for each.

**Eval:** on MER-0419, the extracted cells are scored against a hand-made answer key (`supabase/seed/gold/`). Latest result: 150/150 cells and 50/50 questionnaire answers. Settings → Eval shows the result cell by cell.

## Stack

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres + Storage) · Gemini via `@google/genai` · Google ADK agents · Zod · exceljs · @react-pdf/renderer · Vitest · Vercel.

## Run locally

Requires Node 22+, a Supabase project and a Gemini API key.

```bash
npm install
cp .env.example .env.local     # fill in Supabase, Gemini, SESSION_SECRET, SEED_ADMIN_PASSWORD
npm run db:migrate             # apply supabase/migrations/*.sql
npm run seed                   # users, vendors, RFx, dataset → storage
npm run dev                    # http://localhost:3000
```

Other scripts:

| Script | What it does |
|---|---|
| `npm test` | Unit tests (normalisation, SQL guard, preprocessors, …) |
| `npm run pipeline:seed` | Loads the seed replies into MER-0419, runs every stage, prints the eval (`--set realistic` for the messy set) |
| `npm run eval` | Re-scores MER-0419 against the answer key |
| `npm run check:models` | Checks that the configured Gemini models answer with valid JSON |

## Repo map

```
src/app/            pages and thin API route handlers
src/lib/pipeline/   classify, extract, map, normalise, questionnaire, flags
src/lib/preprocess/ xlsx / docx / pdf / image / email → model-ready text
src/lib/normalise/  units, FX, discounts, freight
src/lib/ai/         Gemini client + decision layer (all model calls go here)
src/lib/query/      natural-language → guarded read-only SQL
supabase/           migrations and the seed dataset (+ answer key)
design/             DESIGN.md spec and the HTML prototype
docs/               PRD, FSD/TRD, dataset pack, build handoffs
```

## Further reading

- [docs/01_PRD_Kill_the_Quote_Spreadsheet.md](docs/01_PRD_Kill_the_Quote_Spreadsheet.md): what we built and why
- [docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md](docs/02_FSD_TRD_Kill_the_Quote_Spreadsheet.md): how it's built
- [docs/03_Dataset_Pack_README.md](docs/03_Dataset_Pack_README.md): the test data and its traps
- [PROGRESS.md](PROGRESS.md): build log, task by task
- [DECISIONS.md](DECISIONS.md): every change from the spec and the reason for it
