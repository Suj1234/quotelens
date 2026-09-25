"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// DECISIONS 2026-09-25 "Settings in four tabs": General · Masters · Evaluation · Activity, each with sub-tabs (?tab=).
const TOP = [["/settings", "General"], ["/settings/masters", "Masters"], ["/settings/eval", "Evaluation"], ["/settings/activity", "Activity"]] as const;

export function SettingsNav({ approver }: { approver: boolean }) {
  const path = usePathname();
  if (approver) return null; // the approver sees Activity → Audit log only, so there is nothing to switch between
  return (
    <nav className="tabs" style={{ margin: "14px 0 0" }} aria-label="Settings">
      {TOP.map(([href, label]) => <Link key={href} href={href} className={path === href ? "active" : undefined}>{label}</Link>)}
    </nav>
  );
}
