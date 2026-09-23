# DESIGN.md — QuoteLens design specification
## Document 7 — tokens, components, screens, copy. Reference rendering: `design/prototype.html`

| Field | Value |
|---|---|
| Version | 1.0 — 23 September 2026 |
| Source of truth | This file for rules; `design/prototype.html` for the exact rendering. Where they differ, the HTML's CSS wins on values and this file wins on intent |
| Consumed by | Claude Code (CLAUDE.md rule: "match DESIGN.md") · the TRD §17 screen list |
| Stack assumptions | Next.js + Tailwind + shadcn/ui. Tokens go in `globals.css` as CSS variables and in `tailwind.config` as theme extensions; shadcn components are restyled to these tokens, never used with defaults |

---

## 0. Principles (the rules everything below derives from)

1. **Two front doors, one product.** The buyer (Sujit) works in a dense workspace; the approver (Priya) works in a calm decision page. Neither sees the other's chrome.
2. **Navigation is two levels.** A 56px icon rail holds only global items; everything about one RFx is tabs across the top of that RFx.
3. **One focal object per screen.** Every screen has one thing the eye lands on first; everything else is quieter (smaller, greyer, further away).
4. **Density where hands work, air where eyes decide.** Grid and queue: 36px rows, 12.5–13.5px type. Overview, Decide, Award, Sign-in: 15px lead text, 22–30px headlines, generous spacing.
5. **Colour is state, and only state.** One accent (teal) for actions and "lowest price". Amber = needs you. Green = you decided. Indigo dot = converted. Grey hatch = absent. Red = disqualified/conflict. Nothing decorative is coloured.
6. **Provenance, not badges.** No "AI" badge, no sparkle icon anywhere. Hover shows the source in one line; click shows the chain. "LLM-estimated / measured" appears only inside the drawer.
7. **Words carry weight.** Every screen opens with one plain sentence. Buttons are verbs. Uncertainty is a fact with a number ("4 cells, ₹38 lakh at stake"), never hidden, never dramatised.
8. **Patterns to avoid** (they read as generated): centred hero text on app screens; rows of equal stat tiles; cards inside cards; gradients; glass; purple/indigo as a brand colour; emoji; `rounded-lg` on everything; a chat bubble as the primary surface; buttons that duplicate tabs; a lone paragraph with empty space beside it.

---

## 1. Tokens

### 1.1 Colour — light (default)

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F6F5F1` | App background (page ground) |
| `--surface` | `#FFFFFF` | Cards, tables, top bar, rail, drawer, sheet |
| `--ink` | `#1C1E22` | Primary text, active tab underline, primary chips |
| `--ink2` | `#3F434A` | Secondary text (lead paragraphs, quiet buttons) |
| `--muted` | `#6E727A` | Labels, table headers, meta lines, captions |
| `--faint` | `#9EA2A9` | Tertiary text (SKU line, hints, line numbers) |
| `--hair` | `#DEDCD5` | Borders on cards, inputs, table outer edges |
| `--hair2` | `#ECEAE4` | Row dividers, inner table lines |
| `--tint` | `#F1F0EB` | Hover rows, table head fill, code/SQL blocks, pipeline strip background |
| `--tint2` | `#E9E8E2` | Avatar fill, progress-bar track |
| `--accent` | `#0F6663` | Primary button fill, per-line minimum edge, links on hover, chart bars |
| `--accent-ink` | `#0B4E4B` | Link text, primary button hover, teal chip text |
| `--accent-tint` | `#E2EEEC` | Active rail item, teal chip fill, step icon fill |
| `--amber` | `#955A0A` | Needs-you text: ambiguous cells, low-confidence, pending questionnaire |
| `--amber-bg` | `#FAF0DB` | Ambiguous cell fill, amber chip fill, highlighted snippet |
| `--green` | `#2B7A4B` | Reviewed cells, cleared chip, done pipeline stage |
| `--green-bg` | `#E5F1E9` | Green chip fill |
| `--indigo` | `#4757A6` | Inferred dot, probability bar fill, issued/receiving status dot |
| `--indigo-bg` | `#E7EAF6` | Indigo chip fill |
| `--red` | `#A93A2E` | Disqualified chip, conflict outline, eval "wrong" |
| `--red-bg` | `#F7E6E3` | Red chip fill |
| `--shadow` | `0 12px 32px rgba(20,22,26,.10)` | Drawer and sheet only |

### 1.2 Colour — dark (toggle in the top bar; also follows OS preference when no choice is stored)

| Token | Hex |
|---|---|
| `--paper` `#16181B` · `--surface` `#1D2024` · `--ink` `#EAE9E4` · `--ink2` `#C8C7C1` · `--muted` `#9A9DA5` · `--faint` `#6F727A` · `--hair` `#31343A` · `--hair2` `#282A2F` · `--tint` `#24272C` · `--tint2` `#2C2F35` |
| `--accent` `#57B3AE` · `--accent-ink` `#86CFCA` · `--accent-tint` `#1F3231` · `--amber` `#E2A650` · `--amber-bg` `#3A2E18` · `--green` `#72C08C` · `--green-bg` `#1D3326` · `--indigo` `#9DA8EA` · `--indigo-bg` `#272C47` · `--red` `#E48D81` · `--red-bg` `#3F2420` · `--shadow` `0 12px 32px rgba(0,0,0,.45)` |

Rules: components reference tokens only, never hex. The theme is stored per browser (`localStorage["ql-theme"]`), default **light**. `color-scheme: dark` is set on the root in dark mode so native controls follow.

### 1.3 Typography

| Role | Face | Size / line | Weight | Notes |
|---|---|---|---|---|
| Body | IBM Plex Sans | 13.5px / 1.5 | 400 | App default |
| Table body | IBM Plex Sans | 12.5px | 400 | Grid, queue, lists |
| Lead paragraph | IBM Plex Sans | 15px / 1.5 | 400, key figures 600 | Max width 64ch, colour `--ink2`, bold figures in `--ink` |
| Page title (h1) | IBM Plex Sans | 22px / 1.2 | 600 | Letter-spacing −0.005em; `text-wrap: balance` |
| Sign-in headline | IBM Plex Sans | 30px | 600 | Max width 20ch |
| Section title (h2) | IBM Plex Sans | 15px | 600 | |
| Card title / row title | IBM Plex Sans | 13–14px | 600 | |
| Eyebrow | IBM Plex Sans | 10.5px | 500 | Uppercase, letter-spacing .07em, `--muted` |
| Table header | IBM Plex Sans | 11px | 500 | Letter-spacing .03em, `--muted` |
| Small / meta | IBM Plex Sans | 12px | 400 | `--muted` |
| Hint | IBM Plex Sans | 11.5px | 400 | `--faint` |
| Numbers, codes, SQL, refs | IBM Plex Mono | same size as surrounding text | 400 (500 for big figures) | `font-variant-numeric: tabular-nums`; right-aligned in tables |
| Big figure (drawer, delta) | IBM Plex Mono | 26–30px | 500 | |
| Keyboard key | IBM Plex Mono | 10.5px | 400 | 1px border, 2px bottom border, radius 3 |

Fonts: Google Fonts `IBM+Plex+Sans:400;500;600` and `IBM+Plex+Mono:400;500`, `display=swap`. Fallback stacks: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` and `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. In the build, self-host the woff2 files in `/public/fonts` so nothing falls back on a slow network.

Number format: Indian grouping (`1,04,280`), `₹` prefix with no space in tables, `₹4.53 cr` / `₹38.2 L` for large sums in prose. Dates `29 Oct 2026`; in tight cells `29 Oct`.

### 1.4 Spacing, radius, borders

| Token | Value |
|---|---|
| Base unit | 4px; common steps 6, 8, 10, 12, 14, 16, 18, 22, 28, 44 |
| Page padding | 22px top, 28px sides, 48px bottom (16px sides ≤ 900px) |
| Page max width | 1180px for reading pages; none for the comparison grid |
| Card padding | header 10px 14px; body 14px |
| Table cell padding | 8px 10px (`table.t`); grid cells 0 12px at 36px height |
| Radius | 5px buttons/inputs/chips-3px; 6px cards/drawer/table; never larger |
| Borders | 1px `--hair` outer, 1px `--hair2` inner; no shadows except drawer/sheet |
| Top bar | 48px; rail 56px; RFx header padding 18px 28px 0 |
| Ask side sheet | 400px; provenance drawer 480px |
| Gaps | grid2 16px; grid3 14px; button rows 8px; chip rows 6px |

### 1.5 Motion

120–180ms ease for drawer/sheet slide and toast fade; pipeline stage shows a 2px teal bar sweeping left→right while running (1s linear, infinite); nothing bounces or scales. `prefers-reduced-motion` disables the sweep and transitions.

### 1.6 Iconography

Lucide-style 1.6–1.8 stroke, 16–18px, `currentColor`. Used only in: rail (list, plus, gear), top bar (sun/moon, chat), sign-in steps (mail, file, table, check). No icons inside tables or cells; state is conveyed by colour/typography per §2.6.

---

## 2. Components

### 2.1 Top bar (48px, `--surface`, bottom hairline)
Left → right: brand mark (18px square, 2px `--ink` border, 7px `--accent` square inset top-left) + "QuoteLens" 14px 600; org name in `--muted` small; spacer; `⌘K` key hint (`--faint`); theme toggle icon button (30px, hover `--tint`); avatar (26px round, `--tint2`, initials 10.5px 600) + quiet button with "Name · Role". Buyer: "Sujit Menon · Buyer". Approver: "Priya Raghavan · VP Procurement".

### 2.2 Rail (56px, `--surface`, right hairline)
Icon buttons 40×40, radius 6, centred vertically in the column with 4px gaps, tooltip to the right on hover (`--ink` fill, `--paper` text, 11px). Buyer: RFx list, New RFx, spacer, gear (Settings/eval/model calls). Approver: RFx list only. Active = `--accent-tint` fill, `--accent-ink` icon. **Never** shows an RFx code or per-RFx items.

### 2.3 RFx header (inside an RFx; `--surface`, bottom hairline)
Line 1: code as a small bordered mono button ("MER-0419 ▾", opens the RFx list) + category/period in `--muted` mono 12px. Right side (buyer only): "Sync inbox" button, "Ask" button with chat icon. 
Line 2: h1 22px — the RFx title.
Line 3: meta row 12.5px `--muted`: status dot+label · "30 lines" · "v1 frozen 24 Sep" · "Deadline 07 Oct 2026", separated by "·".
Line 4: tabs — 8px 12px padding, 500 weight, `--muted`; active `--ink` with 2px `--ink` underline; count pill mono 11px `--tint`. Buyer tabs: Overview · Responses · Review [n] · Comparison · Award. Approver tabs: Decide · Comparison · Award.

### 2.4 Buttons
- Primary: `--accent` fill, white text, 30px, 500, radius 5; hover `--accent-ink`.
- Default: `--surface`, 1px `--hair`, `--ink`; hover border `--muted`.
- Quiet: no border, `--ink2`; hover `--tint`.
- Small: 25px, 12px text, 8px sides.
- Disabled: 45% opacity, default cursor.
Labels are verbs: Continue, Issue to 5 vendors, Work the queue, Confirm ₹27,960, Override…, Exclude, Ask vendor, Acknowledge, Save as scenario, Generate memo, Approve, Send back, Export.

### 2.5 Chips (19px, 11px 500, radius 3)
Default (bordered `--hair`), teal, green, amber, red, indigo, grey (`--tint`). Meanings are fixed: green=cleared/done/reviewed; amber=pending/needs a look/valid 30d; red=disqualified; teal=quotation file; grey=type labels (supporting, ambiguous unit); indigo=inferred.

### 2.6 Comparison cell (36px tall, right-aligned mono, hover `--tint`, pointer cursor)

| State | Rendering |
|---|---|
| confirmed | plain `--ink` number |
| inferred | number + 5px `--indigo` dot at left (7px in) |
| reviewed | number in `--green` |
| low-confidence | `--amber` text, 1px dotted `--amber` border inset 2px; shows "best guess?" with a small sans "read" flag |
| ambiguous | `--amber-bg` fill, `--amber` text; "best guess?" + flag "unit" |
| not quoted | 135° hatch (`--hair2` on transparent, 6px pitch); text "not quoted" sans 11px `--faint` |
| references prior | horizontal stripes; text "prior pricing" sans 11px `--muted` |
| excluded | strikethrough, `--faint` |
| conflict | 1px `--red` outline |
| lowest eligible on the line | 3px `--accent` inset left edge (in addition to state) |
| selected (drawer open) | 2px `--ink` outline |
Hover tooltip: one line from the conversion chain, `--ink` fill, 11px, below the cell, right-aligned.

### 2.7 Comparison grid
`border-collapse: separate`, hairlines, min-width 960px inside a scrolling box (radius 6, `--surface`). First column sticky (330px): line number mono `--faint` + description 500 (ellipsis), second line mono 10.5px `--faint` "SKU · annual qty/yr · plant". Column headers sticky: vendor name 600 + status chip (✓ green / ✗ red / ? amber), line 2 meta 11px: "27/30 priced · freight extra · USD · valid 30d", line 3 mono 11px "₹4.39 cr a year". Disqualified vendors' columns hidden unless "show disqualified vendors" is on.

### 2.8 Toolbar above the grid
Row 1 (tabs): Prices · Questionnaire · Documents · Ledger · Timeline.
Row 2 (prices only): segmented control [Unit price | Landed cost | As written] (`--ink` fill on selected); checkbox "show disqualified vendors"; spacer; (approver) "Ask" button; "Export".
Below the grid: one legend line — 12px swatches of the eight states with counts, then `--faint` "· hover a cell for its source, click for the chain · teal edge = lowest eligible on the line".

### 2.9 Provenance drawer (480px, slides from right, scrim 22% ink)
Header: eyebrow "LINE 14 · ORIENTPACK LTD"; big mono figure "₹7,510?" + "per 1000 pcs"; state chip + line description; Close (quiet).
Body sections, each with an uppercase 10.5px `--muted` heading: **Source** (evidence block, §2.10) · **As written** (mono value + unit) · **Mapping** ("Which RFx line does this item belong to? · LLM-estimated"; three alternatives with `p 0.91` mono right) · **Conversion chain** (numbered steps: mono index `--faint`, sentence, basis label right in 10.5px `--muted`: "vendor stated", "assumption · fx_rate", "RFx spec", "buyer entered") · **Review** (green chip + "by Sujit Menon · today", or "Open in queue" button, or "Nothing pending.").

### 2.10 Evidence block
Bordered box radius 5, `--tint` ground. Image crops (photo/PDF) at full width with a caption bar (11px `--muted`, top hairline): "IMG_20261001_114532.jpg · rows 12–17 · price under thumb". Text snippets in mono 11.5px on `--surface`, the matched phrase in `<mark>` `--amber-bg`/`--amber`. Spreadsheet cells shown as the row text with the cell ref in the caption.

### 2.11 Review queue card
Two columns: evidence (240–340px) | decision. Decision side: title 14px 600; chips row (vendor, type); note 12px `--muted` max 60ch; proposal row: probability bar (110×4px, `--indigo` fill on `--tint2`) + "p 0.60" mono 11px + "proposed ₹27,960 per 1000" (18px mono); actions row (small buttons). Resolved cards at 50% opacity with a green status chip. Override inline: two inputs (value mono, reason) + Save. Ask vendor inline: an email block (header grid To / Reply-To / Subject; body pre-wrapped) + Send / Cancel.

### 2.12 Pipeline strip
Six equal boxes (radius 5): stage name 500 (capitalised) + elapsed time on the right when done; second line mono 11px: pending / running… / done. Done = `--green` border and text; running = `--accent` border with the sweeping bar; error = `--red` border with a Retry button.

### 2.13 Ask answer card (`.qa`)
Bordered card, 14px 16px padding. Question 14px 600; answer 13.5px max 70ch; exclusions line in `--amber` 12px; "How I computed this" 12px `--muted` with "Show query" link (accent-ink 500) revealing a `<pre>` on `--tint` (mono 11px); optional bar chart (§2.15); result table in a 260px max-height scroll box; actions: Save as scenario, Export, Include best guesses.

### 2.14 Ask box (approver Decide page)
Bordered card, borderless textarea 14px, one row: hint "Answers are computed from the comparison; the query is shown with every answer." + primary "Ask". Below: three groups (Cost · Risk · Vendors) of full-width bordered suggestion buttons 12.5px, eyebrow headings.

### 2.15 Bar chart (inline, no library)
Rows: label 120px `--muted` (ellipsis) · track 10px `--tint2` with `--accent` fill · value mono 80px right. Title 11px `--muted` above. One colour only.

### 2.16 Email block, memo, tables, toasts, empty states
- Email: header grid (64px label column, `--muted` labels, 500 values), body pre-wrapped sans.
- Memo: `--surface`, 36px 40px padding, max 800px; h1 19px; section headings 11px uppercase `--muted`; allocation table `table.t`; signature grid with top rule.
- `table.t`: header 11px 500 `--muted` with bottom hairline; rows 8px 10px with `--hair2` dividers; hover `--tint`; numeric columns right-aligned mono.
- Toast: `--ink` fill, `--paper` text, 12.5px, bottom centre, 1.9s.
- Empty state: dashed `--hair` border, radius 6, centred text `--muted`, with one action button when there is one.
- Status dot+label: 7px dot; draft `--faint`, issued/receiving `--indigo`, reviewing `--amber`, awarded `--green`.

---

## 3. Screens — placement and copy

Screen order follows the two personas. "Copy" gives the exact strings; numbers in copy are computed, never typed.

### 3.1 Sign-in (`/`)
Split screen. **Left (≈54%, `--surface`)**: brand (top-left) → headline 30px "Compare vendor quotes without retyping a single number." → lead "Send an RFx, receive quotes in any format, and get one comparison where every price shows where it came from." → four steps in a 2×2 grid (30px teal icon squares): **Send** "Draft the RFx with a co-pilot and email it to your vendors." · **Receive** "Excel, PDF, Word, a photo or a plain email — nothing is retyped." · **Compare** "Same units, same currency, side by side. Unsure cells are marked, not hidden." · **Award** "Ask questions in plain language and approve a memo you can defend." → sample mini-grid (3 lines × Vendor A/B/C) showing lowest-price edges, one "needs a look" amber cell, one hatched "not quoted"; caption "Lowest price marked on every line · missing and uncertain quotes stay visible" → footer hint "Meridian Foods Pvt Ltd · Sourcing". 
**Right (360–460px, `--paper`)**: "Sign in" 20px; "Use your Meridian Foods work email."; Work email; Password; full-width primary "Continue"; rule; eyebrow "DEMO ACCOUNTS"; two rows (avatar, name 600, role in `--muted`); footer hint "Private to Meridian Foods. Vendors never sign in here." Both columns start 44px from the top; footers share a baseline. No account data appears on this page.

### 3.2 RFx list (`/rfx`)
h1 "RFx"; sub-line (buyer) "Four events. One needs review, one is ready to issue." / (approver) "Events waiting for your questions or approval."; primary "New RFx" (buyer only). Table: Code (mono) · Title · Status (dot) · Responses (mono "5 of 5") · Lines · Annual value · Updated. Rows are clickable; a draft opens New RFx for the buyer.

### 3.3 New RFx (`/rfx/new`, buyer)
Eyebrow "DRAFT · MER-0418"; h1 "New RFx"; sub "Describe the need; the co-pilot asks what a good buyer would ask and fills the right-hand side. It never invents line items."; buttons "Save draft", primary "Issue to 5 vendors" (disabled until lines, terms and questionnaire exist).
Split 340–460px | rest. **Co-pilot card**: header "Co-pilot" + status "terms pending · questionnaire pending"; log of messages with eyebrow FROM labels ("SUJIT", "CO-PILOT"), 2px left rule (`--ink` for buyer, `--accent` for co-pilot); a co-pilot message may carry a patch box (`--tint`) summarising what it wrote to the right side; composer with suggestion chips "Attach last year's sheet" · "Standard terms" · "Attach questionnaire" · "Add vendors", textarea "Tell the co-pilot what you need, or paste a line sheet…", hint "Attach xlsx / csv", primary "Send".
**Editor card**: tabs "Lines [n]" · "Terms" · "Questionnaire [n]" · "Vendors [5]". Lines empty state: **"No lines yet."** "Attach last year's sheet (xlsx/csv) or paste rows in the co-pilot. Lines are never invented — you confirm every one." + button. After parsing: table # · SKU (mono) · Description · Ply · Wt g · Monthly · Deliver to; footer hint "Parsed from rfx_lines.xlsx · edit inline · weight per piece converts per-kg quotes later".

### 3.4 Overview (buyer, default tab)
Two columns 1.25fr | 1fr. **Left**: eyebrow "WHERE THIS STANDS"; lead: "All five vendors replied within nine days. Three cleared the questionnaire. **13 items** need your call before the grid is complete; awarding each line to the cheapest qualified vendor currently comes to **₹4.48 cr** a year."; card "Needs you" (link "Open the queue"): two-column table vendor → issue, e.g. "Westline — 4 bundle sizes not stated (items 5, 9, 15, 19)". **Right**: card "The event": Issued · Deadline · Scope · Terms · Plants · Questionnaire · Transport (with "change" link).
Below, full width: card "Vendors" (hint "click a row for the response"): Vendor (name 600, city small) · Sent as · Received (mono) · Priced (mono n/30) · Valid to (mono, amber "30d" chip if short) · Questionnaire (chip) · Needs you (count). Then card "Vendor communications": timeline rows (mono timestamp 104px · direction arrow · text + meta).
No buttons duplicate the tabs.

### 3.5 Responses (buyer)
Lead: "Five responses in, all processed. Open one to see what was read and where, or add a response by hand — it runs through the same six stages as a Gmail reply."
Card with one row per vendor (5-column grid): name 600 + "city · format" · status ("received 29 Sep · 27/30 priced" or teal chip "processing…") · file chips (XLSX/PDF, teal for quotation, grey otherwise) · questionnaire chip · buttons "Open" and quiet "Add response".
Expanded row (`--tint` ground): eyebrow "PIPELINE" + "Re-run all stages"; pipeline strip; two cards "Files" (file rows with kind chip + probability) and "Terms read" (kv list: Currency, Validity, Freight, Payment, plus Footnote / Discount / Prior pricing when present); card "Extracted items [n]" (hint "as the vendor wrote it"): # · Vendor description · Price as written · Unit as written · Where (mono) · Read (probability bar) · Mapped (mono "L14" + amber/grey chips for unit? / low read / prior).
Add response = side sheet (400px): drop zone "Drop files or click / xlsx · pdf · docx · jpg · eml — any layout, any format"; eyebrow "OR PASTE THE EMAIL BODY"; textarea; "Use seed file" · primary "Submit and run"; hint "Runs classify → extract → map → normalise → questionnaire → flags. Same path as a Gmail reply."
Card "Unmatched" for replies not tied to a vendor, with "Assign or create vendor".

### 3.6 Review (buyer)
Lead: "**13 items** need a decision. Nothing here counts in totals until you decide. Evidence on the left, your call on the right."; row: "Acknowledge all assumptions", (when a clarification is out) primary "Sync inbox — Westline replied"; hint "J K move · C confirm". Note when waiting: "Clarification sent to Westline Packaging for items 5, 9, 15 and 19. Waiting for their reply."
Queue cards (§2.11), order: ambiguous units, low-confidence read, prior pricing, discount treatments, FX, freight, questionnaire ambiguity, validity. Titles are specific: "Item 9: price per bundle, bundle size not stated"; "Line 14: price partly hidden in photo"; "Items 23–30: “rest same as last year” — prior pricing not on file"; "Footnote: printed rates are net of 2.5% early-payment discount"; "USD → INR at 83.15 (23 Sep 2026)"; "FOB Chennai — freight excluded"; "Q6 BRC/food-grade: “audit is in process, expecting by Dec”"; "Validity 30 days (RFx asked 60)".
Actions by type: ambiguous/low → Confirm ₹x · Override… · Exclude · (ambiguous) Ask vendor; prior pricing → Ask vendor (primary) · Treat as not quoted; questionnaire ambiguous → Accept as Yes · Treat as No · Ask vendor; assumptions → Acknowledge · Change in settings.

### 3.7 Comparison (both roles)
§2.7–2.8. Questionnaire tab: 10 rows × vendors, ◆ marks disqualifying questions, red chip for "No", amber for conditional/"in process"/"—"; footer "◆ disqualifying · * answered with a condition". Documents tab: Vendor · File (mono) · Kind chip · Pages · Used for. Ledger tab: Kind (mono) · Vendor · Lines · Assumption · Basis · By. Timeline tab: audit rows. When awarded, a lock bar above the grid: "Awarded — read-only. Memo approved by Priya Raghavan."
Buyer opens Ask from the RFx header as a 400px side sheet (answer cards stacked, three suggestion chips, textarea, "Ask"). Approver has "Ask" in the toolbar which opens the same sheet.

### 3.8 Decide (approver, default tab)
Two columns 1.4fr | 1fr. **Left**: lead "Five vendors quoted the 30 lines. Three cleared the questionnaire. Awarding each line to the **cheapest qualified vendor** comes to **₹4.53 cr** a year. 13 cells are still unresolved on Sujit's side; totals exclude them and say so."; buttons "See the grid" · "Award"/"Read the memo". **Right**: card, eyebrow "AGAINST THE BEST SINGLE VENDOR"; delta 30px mono "1.1%" + small "lower · ₹5.0 L a year"; small `--muted` "Best single vendor: Kohinoor at ₹4.58 cr — with the three partition lines they don't make filled from the next cheapest."
Then the Ask box (§2.14); answer cards newest first; suggestion groups — **Cost**: cheapest qualified per line · savings vs single vendor · landed cost · split by ply; **Risk**: single qualified quote lines · unsure cells and money at stake · FX assumption ±3% · shortest validity; **Vendors**: why is Anand's 5-ply so cheap · who didn't quote line 22 · export the first answer.

### 3.9 Award (both roles)
Lead varies: "Pick a scenario and generate the memo. Every number in it comes from the grid and the ledger." / "Memo drafted from **Cheapest qualified per line (unit)**. Read it and approve, or send it back." / "**Approved.** The grid is locked and the memo is on file." Right-side controls: buyer — scenario select + primary "Generate memo"; approver — "Download PDF" · "Send back" · primary "Approve"; buyer after generating — amber chip "awaiting Priya".
Scenario table: Scenario (600, "selected" green chip) · Rule · Annual total · Vendors · Lines · Single-source · vs first. Memo (§2.16) sections: Recommendation · Allocation · Exclusions · Assumptions applied · Open items · signatures "Prepared — Sujit Menon, Category Buyer" / "Approved — Priya Raghavan, VP Procurement".

### 3.10 Settings (buyer/admin, via the gear)
h1 "Settings"; sub "Transport, decision layer, rates and the two pages that check the system on itself." Cards in a 2-column grid: **Email transport** (radios Mock / Gmail with green "credentials found" / Resend disabled "not configured"; hint "All three raise the same “response received” event."), **Decision layer** (sentence; radios Auto with amber "no key · Gemini", Gemini only "LLM-estimated", Jev only "measured"; thresholds kv 0.85 / 0.60), **FX rates** (table + hint "Changing a rate writes a new ledger entry; old cells keep their chain."), **Landed cost & discounts** (kv). Then h2 "Eval — seed set" with three stat cards (143/150 · 131 · 12 · 5 · 2) and a per-cell diff table; then h2 "Model calls" table (Time · Purpose · Provider · Model · In · Out · Latency).

---

## 4. Roles and access

| | Sujit (buyer/admin) | Priya (approver) |
|---|---|---|
| Rail | RFx · New RFx · gear | RFx |
| RFx tabs | Overview · Responses · Review · Comparison · Award | Decide · Comparison · Award |
| Header buttons | Sync inbox · Ask | none (Ask lives in Comparison toolbar and Decide) |
| Create/edit/issue RFx, add responses, run pipeline | yes | no |
| Review queue actions, Ask vendor, overrides | yes | view only (drawer shows "Waiting for Sujit.") |
| Ask, save scenarios | yes | yes |
| Generate memo | yes | no |
| Approve / send back | no | yes |
| Settings, eval, model calls | yes | no |

---

## 5. Copy rules

- Every screen opens with one sentence stating where things stand, in the second person, with the key number bold.
- Never: "AI-powered", "smart", "magic", "seamless", "leverage", exclamation marks, emoji.
- Provenance language: "Read from photo, row 14", "Footnote *: rates net of 2.5%…", "Best guess 25/bundle from the vendor's other 5-ply items — not applied".
- Uncertainty: a state name plus a number ("4 cells unresolved · ₹38.2 L at stake").
- Empty states: one bold sentence, one plain sentence, at most one button.
- Errors: what happened and what to do ("Extraction failed on page 2 — Retry, or open the file to check it is a quotation.").
- Toasts confirm the verb: "Confirmed — cell now counts", "Sent — logged under vendor communications", "Approved — RFx locked".

---

## 6. Responsive

Desktop-first (demo is desktop). ≤ 900px: rail hidden, columns stack, drawer/sheet full width, tables scroll horizontally inside their box. Grid keeps its 960px min-width in a scrolling container; the page never scrolls sideways.

---

## 7. Implementation notes for Claude Code

- Put every token in `globals.css` under `:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, and `:root[data-theme="dark"]`; expose them to Tailwind as `colors.paper`, `colors.ink`, etc.
- Restyle shadcn: Button → §2.4; Badge → §2.5; Tabs → §2.3 underline style; Sheet → §2.9/§3.5 widths; Table → `table.t`; Tooltip → `--ink` fill.
- The comparison grid is a custom component (TanStack Table is fine for data, not for styling); cell renderer implements §2.6 exactly.
- `design/prototype.html` is the visual acceptance test: put the app and the prototype side by side at 1440px for each screen in §3 before marking a phase done.
