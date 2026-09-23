"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { List, Plus, Settings } from "lucide-react";
import s from "./shell.module.css";

export function Rail({ buyer }: { buyer: boolean }) {
  const path = usePathname();
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link href={href} aria-label={label} className={active ? s.active : undefined}>
      {icon}
      <span className={s.tip}>{label}</span>
    </Link>
  );
  const onNew = path === "/rfx/new";
  return (
    <nav className={s.rail}>
      {item("/rfx", "RFx", <List strokeWidth={1.8} />, path.startsWith("/rfx") && !onNew)}
      {buyer && item("/rfx/new", "New RFx", <Plus strokeWidth={1.8} />, onNew)}
      <span className={s.grow} />
      {buyer && item("/settings", "Settings, eval, model calls", <Settings strokeWidth={1.8} />,
        ["/settings", "/eval", "/logs"].some((p) => path.startsWith(p)))}
    </nav>
  );
}
