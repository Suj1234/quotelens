import "server-only";
import { db } from "@/lib/db";
import { getComparison } from "@/lib/comparison";
import { listComms } from "@/lib/comms";
import { getRfx, listVendorResponses } from "@/lib/rfx-detail";
import { getSetting } from "@/lib/settings";
import { getUnmatchedResponses } from "@/lib/unmatched";
import { formatLabel } from "@/lib/file-labels";
import { STAGES, type Stage } from "@/types/db";
import { loadInputs, withDiscounts } from "@/lib/scenarios";
import { allocate, totals } from "@/lib/scenarios/allocate";

// DESIGN §3.4 / TRD §17.4 RFx overview. Every number in the lead sentence is computed here.

export type NeedsRow = { vendor: string; text: string; count: number };
export type OverviewVendor = {
  id: string; name: string; city: string | null; sentAs: string | null; received: string | null; priced: number; lines: number;
  validUntil: string | null; validityDays: number | null; validityShort: boolean; cleared: boolean | null; clearedNote: string;
  needs: number; responseId: string | null; status: string;
  /** P10 D5: the vendor's conditions (chips + hover), from the comparison. */
  conditions: import("@/lib/conditions").Condition[];
  /** Has the reply been through the six stages? null when there is no reply. */
  reading: Reading | null;
};

// "queued" = not started yet, but new enough that the tab that loaded it is still working through the batch (2 at a time).
export type Reading = { state: "read" | "unread" | "reading" | "queued" | "failed"; stage?: Stage; error?: string };

// A reply untouched this long died with its tab or function; offer to process it again.
const STALLED_MS = 5 * 60_000;
const QUEUE_MS = 15 * 60_000;

/** Where a reply is in the six stages (responses.pipeline_status). */
export function readingOf(ps: Partial<Record<Stage, string>>, errors: Partial<Record<Stage, string>>, updatedAt: string | null): Reading {
  const failed = STAGES.find((s) => ps[s] === "error");
  if (failed) return { state: "failed", stage: failed, error: errors[failed] };
  if (STAGES.every((s) => ps[s] === "done")) return { state: "read" };
  const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity;
  const started = STAGES.some((s) => ps[s] === "running" || ps[s] === "done");
  if (started) return { state: age <= STALLED_MS ? "reading" : "unread" };
  return { state: age <= QUEUE_MS ? "queued" : "unread" };
}

// P10 B4–B5: "Numbers we filled in" = figures the vendor didn't give that WE used; only the weak ones (grade D: a default or
// the AI's inference) are grouped here. Vendor conditions (GST, validity, freight extra) and FX (grade B) are ordinary rows.
const WEAK: Record<string, string> = { discount_treatment: "rates grossed up for a discount we won't earn" };
const shortName = (n: string) => n.replace(/\s+(pvt\.?\s*)?(ltd|limited)\.?$/i, "");

/** "Item 5: price per bundle, bundle size not stated" ×4 → "4 × price per bundle, bundle size not stated (items 5, 9, 15, 19)". */
export function groupNeeds(all: { vendor: string; type: string; title: string; line_no: number | null; weak?: boolean }[]): NeedsRow[] {
  const ack = all.filter((i) => i.weak && WEAK[i.type]);
  const items = all.filter((i) => !(i.weak && WEAK[i.type]));
  const ackRow: NeedsRow[] = ack.length ? [{
    vendor: "Numbers we filled in", count: ack.length,
    text: `${ack.length} to check — ${Object.entries(WEAK).map(([t, label]) => { const vs = [...new Set(ack.filter((a) => a.type === t).map((a) => shortName(a.vendor)))]; return vs.length ? `${label} (${vs.join(", ")})` : ""; }).filter(Boolean).join(", ")}`,
  }] : [];
  const groups = new Map<string, typeof items>();
  for (const it of items) groups.set(`${it.vendor}|${it.type}`, [...(groups.get(`${it.vendor}|${it.type}`) ?? []), it]);
  return [...groups.values()].map((g) => {
    if (g.length === 1) return { vendor: g[0].vendor, text: g[0].title, count: 1 };
    const rest = g.map((x) => x.title.replace(/^(item|line)s?\s+[\d–-]+:\s*/i, ""));
    const lines = g.map((x) => x.line_no).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const same = rest.every((r) => r === rest[0]);
    const where = lines.length ? ` (${/^item/i.test(g[0].title) ? "items" : "lines"} ${lines.slice(0, -1).join(", ")}${lines.length > 1 ? " and " : ""}${lines.at(-1)})` : "";
    return { vendor: g[0].vendor, text: same ? `${g.length} × ${rest[0]}${where}` : `${g.length} points: ${rest.slice(0, 2).join("; ")}${g.length > 2 ? "; …" : ""}`, count: g.length };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor)).concat(ackRow);
}

export async function getOverview(rfxId: string) {
  const [rfx, rows, grid, reviewQ, comms, strays, mode] = await Promise.all([
    getRfx(rfxId), listVendorResponses(rfxId), getComparison(rfxId),
    db().from("review_items").select("type, title, evidence, vendors(name), rfx_lines(line_no)").eq("rfx_id", rfxId).eq("status", "open"),
    listComms(rfxId), getUnmatchedResponses(rfxId), getSetting("email_mode"),
  ]);
  if (reviewQ.error) throw reviewQ.error;
  const open = (reviewQ.data ?? []).map((r) => ({
    vendor: (r.vendors as unknown as { name: string } | null)?.name ?? "Unassigned reply", type: r.type as string, title: r.title as string,
    line_no: (r.rfx_lines as unknown as { line_no: number } | null)?.line_no ?? null,
    weak: r.type === "discount_treatment" && ((r.evidence as { gross_up?: boolean } | null)?.gross_up === true || /net of/i.test(r.title as string)), // a gross-up the AI inferred (grade D)
  }));

  const vendors: OverviewVendor[] = rows.map((r) => {
    const g = grid.vendors.find((v) => v.id === r.vendor_id);
    const validityDays = g?.validity_days ?? null;
    const received = r.response?.received_at ?? null;
    return {
      id: r.vendor_id, name: r.name, city: r.city, status: r.status,
      sentAs: r.response ? formatLabel(r.response.files, !!r.response.email_text) : null, received,
      priced: g?.priced ?? 0, lines: grid.lines.length,
      validUntil: validityDays && received ? new Date(new Date(received).getTime() + validityDays * 86_400_000).toISOString() : null,
      validityDays, validityShort: !!g?.validity_short, cleared: g?.cleared ?? null, clearedNote: g?.cleared_note ?? "",
      needs: open.filter((o) => o.vendor === r.name).length, responseId: r.response?.id ?? null, conditions: g?.conditions ?? [],
      reading: r.response ? readingOf(r.response.pipeline_status, r.response.stage_errors, r.response.updated_at) : null,
    };
  });

  // Cheapest qualified vendor per line — the same engine as Decide, Award and Ask Q1 — less the discounts that split earns (P10 D3).
  const cleared = new Set(grid.vendors.filter((v) => v.cleared === true).map((v) => v.code));
  const inp = await loadInputs(rfxId);
  const q1 = totals(allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" }));
  const q1d = withDiscounts(inp, q1.share, q1.total);
  const cheapest = q1d.total_after, cheapestQuoted = q1.total, covered = q1.allocated, discounts = q1d.discounts;
  const replied = vendors.filter((v) => v.received);
  const lastReply = replied.map((v) => v.received!).sort().at(-1) ?? null;
  return {
    rfx, vendors, needs: groupNeeds(open), openItems: open.length, comms, strays, mode,
    cheapest, cheapestQuoted, discounts, covered, clearedCount: cleared.size, replied: replied.length, lastReply,
  };
}
