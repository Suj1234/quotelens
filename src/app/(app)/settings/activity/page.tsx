import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listModelCalls } from "@/lib/model-calls";
import { getAuditLog } from "@/lib/rfx-tabs";
import { ModelCalls } from "@/components/settings/model-calls";
import { AuditLog } from "@/components/settings/audit-log";
import { SubTabs, pickTab } from "@/components/settings/subtabs";

const TABS = [["calls", "Model calls"], ["audit", "Audit log"]] as const;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

// Settings → Activity: what the system (model calls, TRD §17.15) and the people (audit log) did. The approver sees the
// audit log only, read-only (DECISIONS 2026-09-25).
export default async function ActivityPage({ searchParams }: PageProps<"/settings/activity">) {
  const user = await requireUser();
  const approver = user.role === "approver";
  const sp = await searchParams;
  const tab = approver ? "audit" : pickTab(TABS, sp.tab);
  const rfx = (await db().from("rfx").select("id, code").order("code")).data ?? [];
  if (tab === "calls") return <><SubTabs base="/settings/activity" tabs={TABS} tab={tab} /><ModelCalls initial={await listModelCalls()} rfx={rfx} /></>;
  const f = { rfx: one(sp.rfx), who: one(sp.who) };
  const [rows, users] = await Promise.all([getAuditLog({ rfx: f.rfx || null, who: f.who || null }), db().from("users").select("id, name").order("name")]);
  return (
    <>
      {approver ? <div style={{ height: 14 }} /> : <SubTabs base="/settings/activity" tabs={TABS} tab={tab} />}
      <AuditLog rows={rows} rfx={rfx} users={users.data ?? []} f={f} />
    </>
  );
}
