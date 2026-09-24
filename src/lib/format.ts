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
