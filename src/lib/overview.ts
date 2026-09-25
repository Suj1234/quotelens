import "server-only";
import { db } from "@/lib/db";
import { COUNTED, getComparison } from "@/lib/comparison";
import { listComms } from "@/lib/comms";
import { getRfx, listVendorResponses } from "@/lib/rfx-detail";
import { getSetting } from "@/lib/settings";
import { getUnmatchedResponses } from "@/lib/unmatched";
import { formatLabel } from "@/lib/file-labels";
import { STAGES, type Stage } from "@/types/db";

// DESIGN §3.4 / TRD §17.4 RFx overview. Every number in the lead sentence is computed here.

export type NeedsRow = { vendor: string; text: string; count: number };
export type OverviewVendor = {
  id: string; name: string; city: string | null; sentAs: string | null; received: string | null; priced: number; lines: number;
  validUntil: string | null; validityDays: number | null; validityShort: boolean; cleared: boolean | null; clearedNote: string;
  needs: number; responseId: string | null; status: string;
};

export type Reading = { state: "read" | "unread" | "reading" | "failed"; stage?: Stage; error?: string };

// A stage left "running" this long ago died with its tab or function; offer to read the reply again.
const STALLED_MS = 5 * 60_000;

/** Where a reply is in the six stages (responses.pipeline_status). */
export function readingOf(ps: Partial<Record<Stage, string>>, errors: Partial<Record<Stage, string>>, updatedAt: string | null): Reading {
  const failed = STAGES.find((s) => ps[s] === "error");
  if (failed) return { state: "failed", stage: failed, error: errors[failed] };
  if (STAGES.every((s) => ps[s] === "done")) return { state: "read" };
  const stalled = !updatedAt || Date.now() - new Date(updatedAt).getTime() > STALLED_MS;
  return { state: STAGES.some((s) => ps[s] === "running") && !stalled ? "reading" : "unread" };
}

const ACK: Record<string, string> = { freight_treatment: "freight", fx_assumption: "FX", discount_treatment: "discount", tax_basis: "GST basis" }; // DESIGN §3.6: Acknowledge

/** "Item 5: price per bundle, bundle size not stated" ×4 → "4 × price per bundle, bundle size not stated (items 5, 9, 15, 19)". */
export function groupNeeds(all: { vendor: string; type: string; title: string; line_no: number | null }[]): NeedsRow[] {
  // Assumption cards only need an acknowledgement: one closing row instead of one row each (the prototype lists decisions only).
  const ack = all.filter((i) => ACK[i.type]);
  const items = all.filter((i) => !ACK[i.type]);
  const ackRow: NeedsRow[] = ack.length ? [{
    vendor: "Assumptions", count: ack.length,
    text: `${ack.length} to acknowledge — ${Object.entries(ACK).map(([t, label]) => { const vs = [...new Set(ack.filter((a) => a.type === t).map((a) => a.vendor.split(" ")[0]))]; return vs.length ? `${label} (${vs.join(", ")})` : ""; }).filter(Boolean).join(", ")}`,
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
  const [rfx, rows, grid, reviewQ, questionsQ, comms, strays, mode] = await Promise.all([
    getRfx(rfxId), listVendorResponses(rfxId), getComparison(rfxId),
    db().from("review_items").select("type, title, vendors(name), rfx_lines(line_no)").eq("rfx_id", rfxId).eq("status", "open"),
    db().from("rfx_questions").select("q_no, disqualify_if").eq("rfx_id", rfxId).order("q_no"),
    listComms(rfxId), getUnmatchedResponses(rfxId), getSetting("email_mode"),
  ]);
  if (reviewQ.error) throw reviewQ.error;
  const open = (reviewQ.data ?? []).map((r) => ({
    vendor: (r.vendors as unknown as { name: string } | null)?.name ?? "Unassigned reply", type: r.type as string, title: r.title as string,
    line_no: (r.rfx_lines as unknown as { line_no: number } | null)?.line_no ?? null,
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
      needs: open.filter((o) => o.vendor === r.name).length, responseId: r.response?.id ?? null,
    };
  });

  // Cheapest qualified vendor per line (questionnaire cleared; confirmed / inferred / reviewed cells), as the grid marks it.
  const annual = new Map(grid.lines.map((l) => [l.line_no, l.annual_qty]));
  const cleared = new Set(grid.vendors.filter((v) => v.cleared === true).map((v) => v.code));
  let cheapest = 0, covered = 0;
  for (const l of grid.lines) {
    const prices = grid.cells.filter((c) => c.line_no === l.line_no && cleared.has(c.vendor) && COUNTED.includes(c.state) && c.unit !== null).map((c) => c.unit!);
    if (prices.length) { cheapest += Math.min(...prices) * (annual.get(l.line_no) ?? 0) / 1000; covered++; }
  }
  const replied = vendors.filter((v) => v.received);
  const lastReply = replied.map((v) => v.received!).sort().at(-1) ?? null;
  const fullish = grid.vendors.filter((v) => v.priced >= grid.lines.length * 0.9).map((v) => v.total_unit);
  const disq = (questionsQ.data ?? []).filter((q) => q.disqualify_if).map((q) => `Q${q.q_no}`);
  return {
    rfx, vendors, needs: groupNeeds(open), openItems: open.length, comms, strays, mode,
    cheapest, covered, clearedCount: cleared.size, replied: replied.length, lastReply,
    range: fullish.length ? [Math.min(...fullish), Math.max(...fullish)] as const : null,
    questions: (questionsQ.data ?? []).length, disqualifying: disq,
  };
}
