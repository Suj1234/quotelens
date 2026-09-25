const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });

/** "today", "yesterday", "2 days ago", "6 weeks ago" */
export function relativeDay(iso: string, now = new Date()): string {
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (Math.abs(days) < 14) return rtf.format(days, "day");
  if (Math.abs(days) < 70) return rtf.format(Math.round(days / 7), "week");
  return rtf.format(Math.round(days / 30), "month");
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export const countWord = (n: number) => WORDS[n] ?? String(n);

/** Indian grouping (1,04,280) for INR, western grouping for other currencies (DESIGN.md §1.3). */
export function money(value: number | null | undefined, currency: string | null = "INR", decimals?: number): string {
  if (value === null || value === undefined) return "—";
  const code = currency ?? "INR";
  const d = decimals ?? (Number.isInteger(value) ? 0 : 2);
  const n = value.toLocaleString(code === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sym = ({ INR: "₹", USD: "$", EUR: "€" } as Record<string, string>)[code] ?? `${code} `;
  return `${sym}${n}`;
}

// DESIGN §1.3: "29 Oct 2026", "29 Oct" in tight cells (en-GB would print "Sept"). IST, since the buyer is in India.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ist = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000);
export const shortDate = (iso: string) => { const d = ist(iso); return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]}`; };
export const longDate = (iso: string) => `${shortDate(iso)} ${ist(iso).getUTCFullYear()}`;
/** "24 Sep 03:48" (IST) for timelines and outboxes. */
export const dateTime = (iso: string) => { const d = ist(iso); return `${shortDate(iso)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** Large sums in prose/headers (DESIGN §1.3): ₹4.39 cr, ₹38.2 L, else ₹ with Indian grouping. */
export function inrShort(v: number): string {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return money(Math.round(v));
}

/** Today as YYYY-MM-DD in India (the buyer's calendar), for "the deadline must be after today". */
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** YYYY-MM-DD plus n days. */
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** "clarification_sent" → "Clarification sent" — for status and kind values shown as labels. */
/** A vendor's questionnaire note in few words: "Q1 not answered · Q3 not answered · Q6: No" → "Q1, Q3 not answered · Q6: No". */
export function clearedReason(note: string): string {
  const groups = new Map<string, string[]>(); // "not answered" → ["Q1", "Q3"]
  const out: (string | { group: string })[] = [];
  for (const p of note.split(" · ").filter(Boolean)) {
    const m = p.match(/^(Q\d+) (not answered|unclear)$/);
    if (!m) { out.push(p); continue; }
    if (!groups.has(m[2])) { groups.set(m[2], []); out.push({ group: m[2] }); }
    groups.get(m[2])!.push(m[1]);
  }
  return out.map((p) => (typeof p === "string" ? p : `${groups.get(p.group)!.join(", ")} ${p.group}`)).join(" · ");
}
export const cap = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

// "gap_pct" is a percentage; "annual_value_deprec_3pct" is rupees under a 3 % scenario (the digit names the scenario).
export const isPctColumn = (c: string) => /pct|percent/i.test(c) && !/\d_?pct/i.test(c);
const COUNT_WORDS = new Set(["lines", "count", "qty", "quantity", "items", "vendors", "days", "n", "num"]);
/** A column of rupees, judged by its name (Ask answers: table, narrator, export). A count is never money even when its name
 *  says "priced" or "total" (priced_lines, total_lines); original_* is in the vendor's own currency. */
export const isMoneyColumn = (c: string) => /_inr$|price|value|total|spend|saving|impact|cost|amount/i.test(c) && !isPctColumn(c)
  && !/^original_|rank|probability/i.test(c) && !c.toLowerCase().split("_").some((w) => COUNT_WORDS.has(w));
