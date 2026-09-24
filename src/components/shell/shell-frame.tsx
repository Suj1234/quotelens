"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleCheck, FlaskConical, List, LogOut, Menu, Moon, Plus, ScrollText, Settings, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import s from "./shell.module.css";

type Props = {
  buyer: boolean;
  user: { name: string; role: string; initials: string };
  counts: { all: number; reviewing: number };
  initialCollapsed: boolean;
  children: React.ReactNode;
};

/** Top bar + labelled sidebar (DECISIONS: replaces DESIGN §2.1–2.2 rail). Collapsed state lives in a cookie so the server renders it without a flash. */
export function ShellFrame({ buyer, user, counts, initialCollapsed, children }: Props) {
  const path = usePathname();
  const status = useSearchParams().get("status");
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [open, setOpen] = useState(false); // phone drawer

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `ql-sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  const onList = path === "/rfx";
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean, count?: number) => (
    <Link href={href} className={active ? s.active : undefined} title={collapsed ? label : undefined}>
      {icon}<span className={s.label}>{label}</span>
      {count !== undefined && <span className={s.cnt}>{count}</span>}
    </Link>
  );

  return (
    <div className={`${s.app} ${collapsed ? s.collapsed : ""} ${open ? s.open : ""}`}>
      <header className={s.topbar}>
        <button type="button" className={`${s.iconbtn} ${s.menubtn}`} onClick={() => setOpen(true)} aria-label="Open navigation"><Menu strokeWidth={1.8} /></button>
        <Link href="/rfx" className="brand" style={{ color: "inherit", textDecoration: "none" }}><span className="brand-mark" />QuoteLens</Link>
        <span className={s.org}>Meridian Foods Pvt Ltd</span>
        <span className={s.grow} />
        <ThemeToggle />
      </header>
      <div className={s.body}>
        <div className={s.scrim} onClick={() => setOpen(false)} />
        <nav className={s.side} aria-label="Main" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
          <div className={s.group}>
            <div className={s.gh}>Sourcing</div>
            {item("/rfx", "All RFx", <List strokeWidth={1.8} />, path.startsWith("/rfx") && path !== "/rfx/new" && !(onList && status === "reviewing"), counts.all)}
            {buyer && item("/rfx/new", "New RFx", <Plus strokeWidth={1.8} />, path === "/rfx/new")}
            {item("/rfx?status=reviewing", "Needs review", <CircleCheck strokeWidth={1.8} />, onList && status === "reviewing", counts.reviewing)}
          </div>
          {buyer && (
            <div className={s.group}>
              <div className={s.gh}>Admin</div>
              {item("/settings", "Settings", <Settings strokeWidth={1.8} />, path === "/settings")}
              {item("/settings#eval", "Evaluation", <FlaskConical strokeWidth={1.8} />, false)}
              {item("/settings#model-calls", "Model calls", <ScrollText strokeWidth={1.8} />, false)}
            </div>
          )}
          <span className={s.grow} />
          <UserMenu user={user} />
        </nav>
        {/* Floating toggle on the sidebar's edge, near the top */}
        <button type="button" className={s.edge} onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronRight strokeWidth={2} /> : <ChevronLeft strokeWidth={2} />}
        </button>
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}

// Icon choice is pure CSS (shell.module.css), so there is no theme state to hydrate.
function ThemeToggle() {
  function toggle() {
    const el = document.documentElement;
    const dark = el.dataset.theme ? el.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    el.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("ql-theme", el.dataset.theme); } catch {}
  }
  return (
    <button type="button" className={s.iconbtn} onClick={toggle} title="Switch light / dark theme" aria-label="Switch light / dark theme">
      <Sun strokeWidth={1.8} className={s.sun} />
      <Moon strokeWidth={1.8} className={s.moon} />
    </button>
  );
}

function UserMenu({ user }: { user: Props["user"] }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={s.me} aria-label={`${user.name}, account menu`} title={user.name}>
          <span className="avatar">{user.initials}</span>
          <span className={s.label}><b>{user.name}</b><span>{user.role}</span></span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-48">
        <DropdownMenuItem onSelect={signOut}><LogOut strokeWidth={1.8} />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
