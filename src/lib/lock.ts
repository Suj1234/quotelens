import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

// PRD #33 / TRD §14.3: once the award is approved the RFx is read-only. Every mutating route calls this with what it has.
type Ref = { rfx: string } | { response: string } | { reviewItems: string[] } | { scenario: string };

export const LOCKED_MESSAGE = "This RFx is awarded and locked — the grid, the queue and the scenarios are read-only.";

export async function assertOpen(ref: Ref): Promise<void> {
  const q = "rfx" in ref ? db().from("rfx").select("status").eq("id", ref.rfx)
    : "response" in ref ? db().from("responses").select("rfx(status)").eq("id", ref.response)
    : "scenario" in ref ? db().from("scenarios").select("rfx(status)").eq("id", ref.scenario)
    : db().from("review_items").select("rfx(status)").in("id", ref.reviewItems);
  const { data, error } = await q;
  if (error) throw error;
  const statuses = (data ?? []).map((r) => ("status" in r ? r.status : (r.rfx as unknown as { status: string } | null)?.status));
  if (statuses.includes("awarded")) throw new AppError("LOCKED", LOCKED_MESSAGE, undefined, 409);
}

/** For pages: hide actions once the RFx is awarded (the API refuses them anyway). */
export async function isLocked(rfxId: string): Promise<boolean> {
  const { data } = await db().from("rfx").select("status").eq("id", rfxId).maybeSingle();
  return data?.status === "awarded";
}
