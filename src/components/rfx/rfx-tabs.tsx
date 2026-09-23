"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function RfxTabs({ id, tabs }: { id: string; tabs: { slug: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="rfxtabs">
      {tabs.map((t) => {
        const href = `/rfx/${id}/${t.slug}`;
        return (
          <Link key={t.slug} href={href} className={path.startsWith(href) ? "active" : undefined}>
            {t.label}{t.count ? <span className="cnt">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
