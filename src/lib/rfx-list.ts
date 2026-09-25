// Pure helpers for the RFx list (no server-only: the filter/sort runs in the browser).
import type { RfxStatus } from "@/types/db";
import { shortDate } from "@/lib/format";

export const UNTITLED = "Untitled RFx"; // default title of a new draft (rfx-draft.ts)

export type ListRow = {
  id: string; code: string; title: string; status: RfxStatus; created: string; updated: string;
  deadline: string | null; lines: number; invited: number; responded: number;
  open_reviews: number; approved_at: string | null; annual_value: number | null;
  /** Vendor replies received but not yet through the six stages. */
  unread: number;
};

export const STATUS_TABS: { key: string; label: string; statuses: RfxStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "draft", label: "Draft", statuses: ["draft"] },
  { key: "out", label: "Out for quotes", statuses: ["issued", "receiving"] },
  { key: "reviewing", label: "Reviewing", statuses: ["reviewing"] },
  { key: "awarded", label: "Awarded", statuses: ["awarded"] },
  { key: "closed", label: "Closed", statuses: ["closed"] },
];

export type Tone = "amber" | "green" | "muted" | "";

const unreadStep = (n: number): { text: string; tone: Tone } => ({ text: `${n} ${n === 1 ? "reply" : "replies"} not processed yet`, tone: "amber" });

/** What the buyer does next with this event. */
export function nextStep(r: ListRow): { text: string; tone: Tone } {
  const waiting = r.invited - r.responded;
  switch (r.status) {
    case "draft": return r.lines === 0 ? { text: "Finish lines", tone: "muted" } : { text: "Ready to issue", tone: "" };
    case "issued":
    case "receiving":
      if (r.unread > 0) return unreadStep(r.unread);
      if (r.open_reviews > 0) return { text: `${r.open_reviews} to review`, tone: "amber" };
      return waiting > 0 ? { text: `Waiting on ${waiting} of ${r.invited}`, tone: "muted" } : { text: "Ready to award", tone: "" };
    case "reviewing": return r.unread > 0 ? unreadStep(r.unread) : r.open_reviews > 0 ? { text: `${r.open_reviews} to review`, tone: "amber" } : { text: "Ready to award", tone: "" };
    case "awarded": return { text: r.approved_at ? `Approved ${shortDate(r.approved_at)}` : "Awarded", tone: "green" };
    default: return { text: "Closed", tone: "muted" };
  }
}

/** "YYYY-MM-DD" of a timestamp in IST (the buyer is in India; date filters and columns use it). */
export const istDate = (iso: string | Date) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const istToday = (now: Date) => istDate(now);

/** Days from today (IST) to a date-only deadline; negative once it has passed. */
export const daysLeft = (deadline: string, now = new Date()) => Math.round((Date.parse(deadline) - Date.parse(istToday(now))) / 86_400_000);

export function deadlineText(r: Pick<ListRow, "deadline" | "status">, now = new Date()): { text: string; tone: Tone } {
  if (!r.deadline) return { text: "—", tone: "muted" };
  const d = daysLeft(r.deadline, now);
  if (d < 0 || r.status === "awarded" || r.status === "closed") return { text: "Closed", tone: "muted" };
  const live = r.status === "issued" || r.status === "receiving";
  const tone: Tone = live && d <= 3 ? "amber" : "";
  return { text: d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d} days`, tone };
}

/** cfrom/cto = created, ufrom/uto = updated; inclusive "YYYY-MM-DD" bounds, empty = open. */
export type Filters = { q: string; status: string; cfrom: string; cto: string; ufrom: string; uto: string; sort: string; dir: "asc" | "desc" };
export const DEFAULTS: Filters = { q: "", status: "all", cfrom: "", cto: "", ufrom: "", uto: "", sort: "code", dir: "desc" };

const SORT: Record<string, (r: ListRow) => string | number | null> = {
  code: (r) => r.code, responses: (r) => r.responded, deadline: (r) => r.deadline, value: (r) => r.annual_value,
  created: (r) => r.created, updated: (r) => r.updated,
};

export function inTab(r: ListRow, key: string) {
  const tab = STATUS_TABS.find((t) => t.key === key);
  return !tab?.statuses || tab.statuses.includes(r.status);
}

const inRange = (iso: string, from: string, to: string) => { const d = istDate(iso); return (!from || d >= from) && (!to || d <= to); };

export function applyFilters(rows: ListRow[], f: Filters): ListRow[] {
  const q = f.q.trim().toLowerCase();
  const key = SORT[f.sort] ?? SORT.code;
  const out = rows.filter((r) =>
    inTab(r, f.status)
    && (!q || `${r.code} ${r.title}`.toLowerCase().includes(q))
    && inRange(r.created, f.cfrom, f.cto)
    && inRange(r.updated, f.ufrom, f.uto));
  // Empty values always sort last, whichever direction.
  return out.sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * (f.dir === "asc" ? 1 : -1);
  });
}

/** Preset ranges for the date filters, ending today (IST). */
export function presetRange(key: "7" | "30" | "month", now = new Date()): [string, string] {
  const to = istDate(now);
  if (key === "month") return [`${to.slice(0, 8)}01`, to];
  return [istDate(new Date(Date.parse(to) - (Number(key) - 1) * 86_400_000)), to];
}
