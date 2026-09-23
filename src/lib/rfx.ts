import "server-only";
import { db } from "@/lib/db";
import type { RfxStatus } from "@/types/db";

export type RfxListRow = {
  id: string; code: string; title: string; status: RfxStatus; updated: string;
  lines: number; invited: number; responded: number;
};

export async function listRfx(): Promise<RfxListRow[]> {
  const { data, error } = await db()
    .from("rfx")
    .select("id, code, title, status, created_at, updated_at, rfx_lines(count), rfx_vendors(count), responses(vendor_id, is_clarification)")
    .order("code", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({
    id: r.id, code: r.code, title: r.title, status: r.status as RfxStatus,
    updated: r.updated_at ?? r.created_at,
    lines: r.rfx_lines[0]?.count ?? 0,
    invited: r.rfx_vendors[0]?.count ?? 0,
    responded: new Set(r.responses.filter((x) => x.vendor_id && !x.is_clarification).map((x) => x.vendor_id)).size,
  }));
}
