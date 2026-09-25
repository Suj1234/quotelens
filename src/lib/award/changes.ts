// Memo history: what changed between two drafted memos, line by line (pure; the Award tab shows it next to the approver's note).
import type { MemoData } from "./memo";

type Side = Pick<MemoData, "allocation" | "totals" | "scenario">;
export type MemoLineChange = { line_no: number; description: string; from: string | null; to: string | null; from_price: number | null; to_price: number | null; delta: number; reason: string | null };
export type MemoChanges = { option: { from: string; to: string } | null; lines: MemoLineChange[]; total_delta: number };

const cost = (m: Side) => m.totals.total_after ?? m.totals.total;

/** Lines whose vendor or price differs, the option switch (by id, so a rename isn't a switch) and the change in the year's cost. */
export function memoChanges(prev: Side, next: Side): MemoChanges {
  const before = new Map(prev.allocation.map((a) => [a.line_no, a]));
  const lines = next.allocation.flatMap((a): MemoLineChange[] => {
    const b = before.get(a.line_no);
    if (b && b.vendor === a.vendor && Math.abs((b.price ?? 0) - (a.price ?? 0)) < 0.005) return [];
    return [{ line_no: a.line_no, description: a.description, from: b?.vendor ?? null, to: a.vendor, from_price: b?.price ?? null, to_price: a.price,
      delta: (a.annual_value ?? 0) - (b?.annual_value ?? 0), reason: a.is_override ? a.reason.replace(/^manual override: /, "") : null }];
  });
  return { option: prev.scenario.id !== next.scenario.id ? { from: prev.scenario.name, to: next.scenario.name } : null, lines, total_delta: cost(next) - cost(prev) };
}
