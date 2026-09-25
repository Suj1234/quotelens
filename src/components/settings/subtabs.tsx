import Link from "next/link";

/** Second row: the sub-tabs of one settings tab, kept in ?tab= so every view has its own link. */
export function SubTabs({ base, tabs, tab }: { base: string; tabs: readonly (readonly [string, string])[]; tab: string }) {
  return (
    <nav className="subtabs" aria-label="Section">
      {tabs.map(([key, label], i) => <Link key={key} href={i === 0 ? base : `${base}?tab=${key}`} className={key === tab ? "on" : undefined}>{label}</Link>)}
    </nav>
  );
}

/** ?tab= → one of the tab keys (the first when missing or unknown). */
export function pickTab<T extends string>(tabs: readonly (readonly [T, string])[], v: string | string[] | undefined): T {
  return tabs.find(([k]) => k === v)?.[0] ?? tabs[0][0];
}
