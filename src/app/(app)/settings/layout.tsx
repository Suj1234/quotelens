import { requireUser } from "@/lib/auth";
import { SettingsNav } from "@/components/settings/nav";

// Settings is four tabs (DECISIONS 2026-09-25). Each page checks its own role: the approver may open Activity → Audit log.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const approver = user.role === "approver";
  return (
    <div className="page">
      <h1>{approver ? "Audit log" : "Settings"}</h1>
      <p className="text-muted-foreground" style={{ marginTop: 4 }}>
        {approver ? "Every change to settings, masters and vendors, and everything that happened on each RFx — who did it and when." : "How QuoteLens behaves, the company standards the co-pilot works from, how well it reads the seed set, and a record of everything it did."}
      </p>
      <SettingsNav approver={approver} />
      {children}
    </div>
  );
}
