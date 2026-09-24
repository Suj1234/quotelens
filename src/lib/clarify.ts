import "server-only";
import { db } from "@/lib/db";

// TRD §8.7 / §9.6 / §12.3 — the clarification loop.

/** The vendor's main reply: the non-clarification response that supplied most of its cells (as the grid header uses). */
export async function mainResponse(rfxId: string, vendorId: string): Promise<string | null> {
  const [{ data: resp }, { data: cells }] = await Promise.all([
    db().from("responses").select("id, received_at").eq("rfx_id", rfxId).eq("vendor_id", vendorId).eq("is_clarification", false).order("received_at", { ascending: false }),
    db().from("line_quotes").select("response_id").eq("rfx_id", rfxId).eq("vendor_id", vendorId),
  ]);
  const count = (id: string) => (cells ?? []).filter((c) => c.response_id === id).length;
  return [...(resp ?? [])].sort((a, b) => count(b.id) - count(a.id))[0]?.id ?? null;
}

/** Which clarification email a reply answers (`-clar-n`, else the latest), and the reply it corrects. */
export async function clarificationContext(rfxId: string, vendorId: string, n: number | null) {
  const { data: reqs } = await db().from("communications").select("id, reply_to").eq("rfx_id", rfxId).eq("vendor_id", vendorId)
    .eq("direction", "outbound").eq("kind", "clarification").eq("status", "sent").order("created_at");
  const req = (n ? (reqs ?? []).find((r) => r.reply_to?.includes(`-clar-${n}@`)) : undefined) ?? (reqs ?? []).at(-1) ?? null;
  const num = n ?? (req ? Number(req.reply_to?.match(/-clar-(\d+)@/)?.[1] ?? 0) || null : null);
  return { request_id: req?.id ?? null, n: num, supersedes: await mainResponse(rfxId, vendorId) };
}
