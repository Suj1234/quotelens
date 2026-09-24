import "server-only";
import { db } from "@/lib/db";
import type { RfxStatus } from "@/types/db";

export type RfxListRow = {
  id: string; code: string; title: string; status: RfxStatus; updated: string;
  lines: number; invited: number; responded: number;
  annual_value: number | null; // the approved award's scenario total (DECISIONS P0-T4: "—" until then)
};

export async function listRfx(): Promise<RfxListRow[]> {
  const { data, error } = await db()
    .from("rfx")
    .select("id, code, title, status, created_at, updated_at, rfx_lines(count), rfx_vendors(count), responses(vendor_id, is_clarification), awards(status, scenarios(total_inr))")
    .order("code", { ascending: false });
  if (error) throw error;
  return data.map((r) => {
    // awards.rfx_id is unique (0010), so PostgREST may embed one object rather than an array.
    const award = [r.awards].flat()[0] as unknown as { status: string; scenarios: { total_inr: number | null } | null } | undefined;
    return {
    id: r.id, code: r.code, title: r.title, status: r.status as RfxStatus,
    updated: r.updated_at ?? r.created_at,
    lines: r.rfx_lines[0]?.count ?? 0,
    invited: r.rfx_vendors[0]?.count ?? 0,
    responded: new Set(r.responses.filter((x) => x.vendor_id && !x.is_clarification).map((x) => x.vendor_id)).size,
    annual_value: award?.status === "approved" && award.scenarios?.total_inr != null ? Number(award.scenarios.total_inr) : null,
    };
  });
}
