import "server-only";
import { db } from "@/lib/db";
import type { RfxStatus } from "@/types/db";
import type { ListRow } from "@/lib/rfx-list";

// annual_value: the approved award's scenario total (DECISIONS P0-T4: shown only once approved)
export type RfxListRow = ListRow;

export async function listRfx(): Promise<RfxListRow[]> {
  const { data, error } = await db()
    .from("rfx")
    .select("id, code, title, status, response_deadline, created_at, updated_at, rfx_lines(count), rfx_vendors(count), review_items(count), responses(vendor_id, is_clarification), awards(status, approved_at, scenarios(total_inr))")
    .eq("review_items.status", "open")
    .order("code", { ascending: false });
  if (error) throw error;
  return data.map((r) => {
    // awards.rfx_id is unique (0010), so PostgREST may embed one object rather than an array.
    const award = [r.awards].flat()[0] as unknown as { status: string; approved_at: string | null; scenarios: { total_inr: number | null } | null } | undefined;
    return {
    id: r.id, code: r.code, title: r.title, status: r.status as RfxStatus,
    created: r.created_at, updated: r.updated_at ?? r.created_at, deadline: r.response_deadline,
    open_reviews: r.review_items[0]?.count ?? 0,
    approved_at: award?.status === "approved" ? award.approved_at : null,
    lines: r.rfx_lines[0]?.count ?? 0,
    invited: r.rfx_vendors[0]?.count ?? 0,
    responded: new Set(r.responses.filter((x) => x.vendor_id && !x.is_clarification).map((x) => x.vendor_id)).size,
    annual_value: award?.status === "approved" && award.scenarios?.total_inr != null ? Number(award.scenarios.total_inr) : null,
    };
  });
}
