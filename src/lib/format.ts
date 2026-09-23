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
