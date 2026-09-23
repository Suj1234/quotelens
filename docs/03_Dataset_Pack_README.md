# Dataset Pack — "Kill the Quote Spreadsheet" (QuoteLens)
## Document 3 of 6 — seed data, five vendor responses, gold answer key

| Field | Value |
|---|---|
| Version | 1.0 — 23 September 2026 |
| Depends on | 01 PRD §6–7 (personas, vendors, category) · 02 FSD/TRD §18 (eval), §20 (seeding) |
| Package | `quotelens_dataset_pack.zip` — everything below plus the generator scripts |
| Regenerate | `python3 gen_core.py && python3 gen_files.py` (needs openpyxl, python-docx, reportlab, Pillow, numpy, poppler-utils) |

---

## 0. What this pack is for (read first)

Three jobs, in order of importance:

1. **Build-time test inputs.** Claude Code runs the five vendor files through the pipeline every time extraction, mapping or normalisation changes. Nothing in the app may special-case these files; they enter through the same upload/email path as any live document.
2. **Accuracy measurement.** `gold/gold.json` is the answer key for all 150 price cells (30 lines × 5 vendors), 50 questionnaire answers and vendor-level terms. The Eval page (TRD §18) compares the app's output to it.
3. **Demo seed.** The seed script (TRD §20) creates the RFx from `00_rfx/`, and "Load seeded responses" pushes the five response folders through the pipeline so a completed RFx exists before the interview. During the demo the same files can also be dragged into the Inbox by hand — the result is identical because there is no shortcut path.

Everything is fictional: company names, GSTINs, certificate numbers, people, phone numbers. Prices are generated from a single internal cost model (weight per piece × ₹52/kg) with per-vendor multipliers and ±3.5% noise, so they are internally consistent and a packaging buyer will find them plausible (a 5-ply 600×400×400 export carton lands around ₹66–72 each).

**Scale:** annual contract value ≈ ₹4.4–4.8 crore depending on vendor — the brief's "₹4 crore on the line".

---

## 1. Folder map

```
pack/
  00_rfx/
    rfx_meta.json          RFx header: code MER-0417, terms, buyer, cover note
    rfx_lines.csv          30 lines — the exact fields of TRD table rfx_lines
    rfx_lines.xlsx         Same 30 lines as "last year's line sheet" (what Sujit uploads to the co-pilot)
    questions.json         10 questionnaire questions with answer_type / mandatory / disqualify_if
  01_balaji/
    SBP_Price_Offer_MER-0417.xlsx      QUOTE (V1) — own layout, sheet "Price Offer" + sheet "Supplier Questionnaire"
    SBP_ISO9001_Certificate.pdf        SUPPORTING — certificate, no prices
  02_kohinoor/
    Kohinoor_Quotation_KC-2026-1187.pdf   QUOTE (V2) — 2-page letterhead PDF; page 1 table + footnote; page 2 terms + questionnaire
    Kohinoor_Company_Profile.pdf          SUPPORTING
  03_westline/
    Westline_Offer_MER-0417.docx       QUOTE (V3) — prose commercials + small table + questionnaire list
    Westline_Company_Profile.pdf       SUPPORTING
    westline_clarification_reply.txt   CLARIFICATION REPLY — used in Stage 5b demo (bundle sizes for items 5, 9, 15, 19)
  04_orientpack/
    OrientPack_Rate_Card_PRINT_ME.pdf              PRINT THIS, photograph it with your phone at an angle (see §6)
    OrientPack_Rate_Card_PHOTO_synthetic.jpg       QUOTE (V4) — a synthetic angled photo with a thumb shadow over line 14; use until your real photo exists
    OrientPack_Supplier_Questionnaire_Response.pdf QUESTIONNAIRE — filled form, no prices
  05_anand/
    anand_email_body.txt   QUOTE (V5) — email text only (paste into Inbox in mock mode)
    anand_reply.eml        Same as a raw email file (for eml ingestion tests and gmail-mode fixtures)
  gold/
    gold.json              Answer key (machine)
    gold_cells.csv         Answer key (human-readable, 150 rows)
  gen_core.py, gen_files.py, core.json   Generators and the intermediate numbers
```

---

## 2. The RFx (00_rfx)

### 2.1 Header (`rfx_meta.json`)
| Field | Value |
|---|---|
| code | MER-0417 |
| title | Corrugated packaging — FY26-27 annual contract (Hosur & Nelamangala) |
| category | Corrugated packaging |
| currency / quote unit | INR / per 1000 pieces |
| incoterm / freight | delivered to plant / freight included requested |
| payment / validity / contract | 45 days / 60 days / 12 months |
| response deadline | 2026-10-07 (issued 2026-09-24) |
| delivery locations | Hosur, Nelamangala |
| buyer / approver | Sujit Menon (Category Buyer — Packaging) / Priya Raghavan (VP Procurement) |

### 2.2 Line items (`rfx_lines.csv`) — 30 lines
| Lines | Type | Ply | Notes |
|---|---|---|---|
| 1–12 | Boxes (export RSC, shipper, bulk, tray, heavy duty) | 5 | BF 28/32 |
| 13–22 | Boxes (inner, retail, display) | 3 | BF 22/25; high volumes |
| 23–27 | Sheets and layer pads | 5 and 3 | H = 0 |
| 28–30 | Partition sets (12/6/24-cell) | 3 | Kohinoor does not make these |

Every line carries `weight_per_piece_g` (derived from blank area × total GSM × 1.12 adhesive allowance). This is the field that makes Anand's per-kg quote convertible; it is **buyer data**, so a conversion using it has basis `rfx_spec` (TRD §11.2).

Monthly quantities range 1,200–30,000; annual = monthly × 12.

### 2.3 Questionnaire (`questions.json`)
| Q | Question (short) | Type | Mandatory | Disqualify if |
|---|---|---|---|---|
| 1 | BIS / ISO 9001 certification | yes_no | yes | no |
| 2 | In-house corrugation | yes_no | yes | — |
| 3 | Monthly capacity (tonnes) | number | yes | lt:200 |
| 4 | Sample lead time (days) | number | yes | — |
| 5 | FMCG/food clients last 2 years | text | yes | — |
| 6 | BRC / food-grade compliant | yes_no | yes | no |
| 7 | MOQ per SKU per delivery (pcs) | number | no | — |
| 8 | Regular order lead time (days) | number | yes | — |
| 9 | Can supply both plants | yes_no | yes | — |
| 10 | Accepts 45-day payment | yes_no | yes | — |

---

## 3. The five vendor responses — what each file contains and why

### V1 — Sri Balaji Packaging (Hosur) — `01_balaji/SBP_Price_Offer_MER-0417.xlsx`
- **Format:** Excel in the vendor's own layout. Title rows, merged group headers ("Item details / Specification / Commercials"), their own reference codes (SBP-1001…1030), generic descriptions ("Shipper carton") with the size in a separate column, GST column, remarks column. Column order has nothing to do with our template.
- **Prices:** INR per 1000 nos, delivered (freight included), all 30 lines. Multiplier ≈ 1.00 × base.
- **Terms block at the bottom:** GST extra; payment 45 days; validity 60 days; **"Special discount of 3% on total invoice value if all 30 items are awarded to us for the full year"**; MOQ 5,000.
- **Questionnaire:** second sheet "Supplier Questionnaire", all 10 answered; clears everything.
- **Edges exercised:** template ignored; description must be matched by size + ply + type, not text; total-level conditional discount → `discount_treatment` ledger entry, not applied by default.
- **Expected cells:** 30 × `confirmed`, value = as written.

### V2 — Kohinoor Corrugators (Pune) — `02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf`
- **Format:** two-page letterhead PDF. Page 1: cover lines, table of **27 lines** (items 28–30 "not in our manufacturing range"), and a footnote marked with `*`. Page 2: commercial terms and the questionnaire responses as a table.
- **Footnote (the trap):** "Rates are net of our 2.5% early-payment discount, applicable only if payment is received within 10 days of invoice. For payment beyond 10 days, rates are to be read as quoted ÷ 0.975."
- **Validity:** 30 days (shorter than the 60 requested) → `validity_short` flag.
- **Payment:** asks 30 days, accepts 45.
- **Questionnaire:** clears everything (Q10 answer is a "yes with condition").
- **Expected cells:** 27 × `inferred` with value = printed ÷ 0.975 (Meridian pays at 45 days, so the printed net rate is not what it would pay) and a `discount_treatment` assumption; 3 × `not_quoted`. The eval also accepts the printed value with state `confirmed` (`alt_expected_*` in gold) **only** if a `discount_treatment` review item exists — that is the "honest" alternative.

### V3 — Westline Packaging (Ahmedabad) — `03_westline/Westline_Offer_MER-0417.docx`
- **Format:** Word letter. Commercials for boxes are in **two long paragraphs**; sheets/partitions in a small table. Prices are **per bundle**.
- **Bundle sizes:** stated inline ("Rs. 1,709 per bundle of 25") for 22 of 26 box lines; **not stated** for items 5, 9, 15, 19 ("For items 5 and 9 our price is Rs. 699 and Rs. 1,374 per bundle respectively"). Sheets 100/bundle, partitions 20/bundle, stated in the table.
- **Terms in prose:** INR, GST extra, validity 60 days, payment 45 days OK, freight to both plants included.
- **Questionnaire:** numbered list inside the letter. **Q6 BRC = "No – BRC audit planned for Q1 2027" → disqualified.**
- **Hidden truth for the clarification loop:** the real bundle sizes are 5→25, 9→**20**, 15→50, 19→**40**. The system's pattern-based best guess (25 for 5-ply, 50 for 3-ply) is therefore wrong for items 9 and 19 — the demo point is that guessing silently would have mis-priced two lines; asking the vendor fixes it. `westline_clarification_reply.txt` is the vendor's reply to paste/send in Stage 5b.
- **Expected cells:** 26 × `confirmed` (bundle size vendor-stated, so no assumption); 4 × `ambiguous` with `best_guess` from the pattern; after the clarification reply is ingested, those 4 become `reviewed` with the values in `after_clarification`.

### V4 — OrientPack Ltd (Chennai) — `04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg` (and your own photo)
- **Format:** a printed rate card photographed at an angle. The synthetic JPG is a perspective-warped, slightly blurred, unevenly lit render of the PDF with a **thumb shadow over the line-14 price** so that only "?0.?2" is legible.
- **Prices:** **USD per 1,000 pieces, FOB Chennai** (freight and insurance to buyer's account), all 30 lines. Multiplier ≈ 1.05 × base ÷ 83.15.
- **Terms on the card:** validity 60 days, payment 45 days, MOQ 3,000, lead time 6 days ex-works, "FX exposure to buyer".
- **Questionnaire:** separate PDF (`OrientPack_Supplier_Questionnaire_Response.pdf`); clears everything.
- **Expected cells:** 29 × `inferred` (USD × 83.15 with an `fx_rate` assumption dated 2026-09-23); line 14 `low_confidence` with `best_guess` = the true value — any read with `raw_confidence` < 0.60 is correct behaviour. If a real, well-lit photo makes line 14 legible, `inferred` with the correct value is also accepted.
- **Freight:** excluded → landed-cost view adds the buyer's freight assumption (settings default ₹180 per 1000 pcs, editable per vendor).

### V5 — Anand Box Works (Bengaluru) — `05_anand/anand_email_body.txt` / `anand_reply.eml`
- **Format:** plain email text, no attachment.
- **Prices:** "Rs 42/kg for the 5-ply boxes (items 1 to 12)", "Rs 38/kg for the 3-ply boxes (items 13 to 22)", "Sheets, layer pads and partitions (items 23 to 30) — rest same as last year, no change."
- **Terms:** freight extra at actuals; GST extra; payment 45 days OK; validity 60 days.
- **Questionnaire:** answered inline, numbered; **Q6 "BRC audit is in process, expected by December" → ambiguous**; **Q7 not answered → missing** (Q7 is non-mandatory); Q9 "Only Nelamangala regularly; Hosur on request" → yes with caveat.
- **Expected cells:** 22 × `inferred` (₹/kg × weight_per_piece_g, basis `rfx_spec`) — note these are ~30% below the market base, which is what makes "Why is Anand's 5-ply so cheap?" a good demo question (the answer must surface the per-kg conversion and the fact that weight came from *our* spec, not theirs); 8 × `references_prior` (no value; "Ask vendor" pre-drafted).

---

## 4. Ugly-edge coverage map

| Ugly edge (PRD §9) | File | Where exactly |
|---|---|---|
| Template ignored | V1 xlsx | Whole sheet layout; generic descriptions + separate size column |
| Total-level conditional discount | V1 xlsx | Terms line 5 |
| Discount in footnote | V2 pdf | Page 1, `*` footnote below the table |
| 27 of 30 lines | V2 pdf | Items 28–30 absent; sentence "not in our manufacturing range" |
| Validity shorter than requested | V2 pdf | Page 2, "Validity: 30 days" |
| Commercials in prose | V3 docx | Two paragraphs for boxes |
| Per bundle vs per 1000 | V3 docx | All box prices |
| Pack size missing | V3 docx | Items 5, 9, 15, 19 |
| Disqualified vendor | V3 docx | Q6 = No |
| Angled photo / obscured cell | V4 jpg | Line 14 price under thumb shadow |
| Quoted in USD | V4 | Header line "US Dollars per 1,000 pieces" |
| FOB / freight excluded | V4, V5 | "FOB Chennai"; "Freight extra at actuals" |
| Per-kg pricing | V5 | Both rate lines |
| "Rest same as last year" | V5 | Items 23–30 sentence |
| Ambiguous questionnaire answer | V5 | Q6 |
| Missing questionnaire answer | V5 | Q7 |
| Supporting doc that is not a quote | all | certificate / profile PDFs, questionnaire PDF |
| Vendor SKU/description differs from ours | V1 (SBP-1001…), V3 (item numbers only), V4 (own wording) | — |

---

## 5. Gold answer key (`gold/gold.json`)

```jsonc
{
  "fx": {"USD": {"rate": 83.15, "date": "2026-09-23"}},
  "tolerance_pct": 1.0,
  "cells": [ { "line_no": 1, "vendor_code": "balaji", "expected_state": "confirmed",
               "expected_unit_price_inr_per_1000": 13710, "original": {...}, "note": "..." }, ... 150 entries ],
  "questionnaire": [ { "q_no": 1, "vendor_code": "balaji", "expected_state": "answered", "expected_bool": true }, ... 50 entries ],
  "vendor_terms": { "balaji": {...}, "kohinoor": {...}, ... }
}
```

Fields per cell:
- `expected_state` — one of `confirmed | inferred | ambiguous | low_confidence | not_quoted | references_prior`.
- `expected_unit_price_inr_per_1000` — the normalised value, or `null` when the state carries no value.
- `best_guess` — for `ambiguous` / `low_confidence`: the value the system should propose.
- `alt_expected_unit_price_inr_per_1000` + `alt_expected_state` — Kohinoor only; accepted as `flagged_ok` when a `discount_treatment` review item exists for the vendor.
- `after_clarification` — Westline items 5, 9, 15, 19: expected value and state once the clarification reply has been ingested.
- `original` — value / unit / currency / pack_size as written, for checking `extracted_items`.

Verdict rules (TRD §18, restated): `correct` = state matches and value within tolerance; `flagged_ok` = the system chose an honest uncertain state (`ambiguous`/`low_confidence`) whose `best_guess` is within tolerance of the gold value, or the `alt_expected` case above; `wrong` = anything else with a cell present; `missing` = no cell. Kohinoor's `not_quoted` and Anand's `references_prior` are `correct` only if the state matches exactly (a fabricated number there is `wrong`).

Expected distribution at first pass (before any review):
| Vendor | confirmed | inferred | ambiguous | low_confidence | not_quoted | references_prior |
|---|---|---|---|---|---|---|
| balaji | 30 | | | | | |
| kohinoor | | 27 | | | 3 | |
| westline | 26 | | 4 | | | |
| orientpack | | 29 | | 1 | | |
| anand | | 22 | | | | 8 |

Questionnaire expectations: all 50 entries have `expected_state` (`answered` / `ambiguous` / `missing`) and the typed value. Vendor-level expectations (`vendor_terms`) include `cleared_questionnaire` (balaji, kohinoor, orientpack = true; westline = false; anand = null pending Q6 review), `lines_priced`, `validity_short` (kohinoor), `freight_included` (false for orientpack, anand), `references_prior_pricing` (anand).

---

## 6. The photo — what you must do yourself

1. Print `04_orientpack/OrientPack_Rate_Card_PRINT_ME.pdf` on A4 (black-and-white is fine).
2. Put it on a desk under ordinary room light. Rest your thumb, a pen, or a coffee cup over the **line 14 price** (right-hand column, roughly mid-page) so it is partly hidden.
3. Photograph with your phone from about 40 cm, tilted 20–30° so the page is a trapezoid, slightly off-centre. Do not use the document-scanner mode; the point is that it is *not* clean.
4. Save it as `04_orientpack/OrientPack_Rate_Card_PHOTO.jpg` (≤ 4 MB; the app downscales anyway). Keep the synthetic JPG as the fallback fixture.
5. In gmail mode, this is the file you email from your phone during the live demo.

---

## 7. Using the pack in gmail mode (live email demo)

The five vendor "mailboxes" are plus-aliases on a second Gmail account you control, e.g. `you+balaji@gmail.com`, `you+kohinoor@…`, `you+westline@…`, `you+orientpack@…`, `you+anand@…` (configured in Settings → vendor demo addresses). When the RFx is issued, five emails land in that inbox. To reply as each vendor: open the email, hit Reply (the Reply-To carries the tag), attach the file(s) listed for that vendor in §1, and send. For Anand, paste the text of `anand_email_body.txt` as the body with no attachment. Reply to the clarification email with `westline_clarification_reply.txt`. Attach the supporting PDFs too — the classifier must sort them.

Suggested reply order for the recording: Balaji (clean) → Kohinoor (footnote) → Westline (prose) → Anand (email) → OrientPack (photo from the phone, live).

---

## 8. Using the pack in mock mode

- **Load seeded responses** (RFx overview) copies each vendor folder's files into a response and runs the pipeline. File-kind expectations: the classifier should tag the quote file `quotation`, certificates/profiles `supporting`, and OrientPack's questionnaire PDF `questionnaire`.
- **Inbox** (per vendor): drag the same files, or paste Anand's text.
- **Vendor Portal Simulator**: same, from the vendor's point of view.

---

## 9. How the numbers were built (so you can defend them)

- Weight per piece = blank area (m²) × total GSM × 1.12. Box blank area ≈ 2(L+W+40)(W+H+20) in mm² for an RSC; sheet = L×W; partition ≈ strip area scaled by cell count.
- Base price per 1000 pcs = weight_g × ₹52/kg, rounded to ₹10. This is a plausible delivered price for Indian kraft-liner corrugated in 2026.
- Vendor multipliers: Balaji 1.00, Kohinoor 0.97 (then printed net of 2.5%), Westline 1.03, OrientPack 1.05 (converted to USD at 83.15), Anand ₹42/₹38 per kg (≈ 0.73–0.81 × base — deliberately cheap).
- ±3.5% uniform noise per vendor per line, seeded (`random.seed(417)`), so regeneration reproduces the same numbers.
- FX: USD/INR 83.15 on 2026-09-23 — a **fixed fixture rate**; the app must store whatever rate it uses as an assumption, and the eval compares at the gold rate.

---

## 10. Known limitations of the fixtures (do not "fix" in the app)

- The Excel file has generic descriptions on purpose; mapping must lean on size + ply + type.
- The Word file has no SKU codes at all, only "item N" numbers — this is the easiest mapping and a good sanity check.
- The synthetic photo is a render, not a camera image; replace with a real photo for the demo (see §6).
- `anand_reply.eml` has fictional headers; it is for parser tests, not for sending.
- Dates in the documents (27 Sep–2 Oct 2026) are after the RFx issue date and before the deadline; if you change the RFx dates in `rfx_meta.json`, the vendor documents will still say these dates — harmless.

---

*End of Dataset Pack. Next: document 4 — Build Plan (CLAUDE.md + task list).*
