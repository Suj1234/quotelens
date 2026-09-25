import { requireUser } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { getAuditLog } from "@/lib/rfx-tabs";
import { GeneralCards } from "@/components/settings/settings-cards";
import { ChangeList } from "@/components/settings/change-list";
import { SubTabs, pickTab } from "@/components/settings/subtabs";

const TABS = [["communication", "Communication"], ["decision", "Decision engine"], ["currency", "Currency"]] as const;

// Settings → General (DECISIONS 2026-09-25 "Settings in four tabs"): how the system behaves on every RFx.
export default async function GeneralPage({ searchParams }: PageProps<"/settings">) {
  await requireUser(["buyer", "admin"]); // approver → /rfx (DESIGN §4)
  const tab = pickTab(TABS, (await searchParams).tab);
  const [settings, log] = await Promise.all([getAllSettings(), getAuditLog({ rfx: "workspace" })]);
  return (
    <>
      <SubTabs base="/settings" tabs={TABS} tab={tab} />
      <GeneralCards key={tab} tab={tab} settings={settings} jevKey={!!process.env.OPENROUTER_API_KEY} />
      <ChangeList rows={log.filter((r) => r.area === tab)} empty="No changes yet — every value here is the seeded default." />
    </>
  );
}
