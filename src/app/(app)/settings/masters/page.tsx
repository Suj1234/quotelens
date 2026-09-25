import { requireUser } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { getAuditLog } from "@/lib/rfx-tabs";
import { listVendors } from "@/lib/vendors";
import { CATEGORY } from "@/lib/rfx-draft";
import { TemplateEditor } from "@/components/settings/template-editor";
import { VendorDirectory } from "@/components/settings/vendor-directory";
import { ChangeList } from "@/components/settings/change-list";
import { SubTabs, pickTab } from "@/components/settings/subtabs";

const TABS = [["terms", "Naming & terms"], ["lines", "Line fields"], ["questions", "Question library"], ["vendors", "Vendors"]] as const;

// Settings → Masters: the company standards the co-pilot proposes from and Issue checks against. The first three are per
// category (this workspace sources one, CATEGORY); Vendors is the shared directory with a per-category Approved tick.
export default async function MastersPage({ searchParams }: PageProps<"/settings/masters">) {
  await requireUser(["buyer", "admin"]);
  const tab = pickTab(TABS, (await searchParams).tab);
  const [settings, vendors, log] = await Promise.all([getAllSettings(), listVendors(), getAuditLog({ rfx: "workspace" })]);
  return (
    <>
      <SubTabs base="/settings/masters" tabs={TABS} tab={tab} />
      {tab === "vendors" ? (
        <VendorDirectory vendors={vendors} category={CATEGORY} templates={settings.category_templates} fxCurrencies={Object.keys(settings.fx_rates)} />
      ) : (
        <>
          <p className="hint" style={{ margin: "-6px 0 10px" }}>Category <b>{CATEGORY}</b> — this workspace sources one category, so its masters are the ones every new RFx uses.</p>
          <TemplateEditor key={tab} part={tab} category={CATEGORY} templates={settings.category_templates} />
        </>
      )}
      <ChangeList rows={log.filter((r) => r.area === tab || (tab === "vendors" && r.area === "approved"))} empty={tab === "vendors" ? "No vendor has been added or changed here yet." : "No changes yet — these are the values seeded from MER-0417."} />
    </>
  );
}
