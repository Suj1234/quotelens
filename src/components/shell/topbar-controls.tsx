"use client";

import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import s from "./shell.module.css";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function effectiveDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

// Icon choice is pure CSS (shell.module.css) so there is no theme state to hydrate.
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const next = effectiveDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ql-theme", next); } catch {}
  }
  return (
    <button type="button" className={className} onClick={toggle} title="Switch theme" aria-label="Switch theme">
      <Sun strokeWidth={1.8} className={s.sun} />
      <Moon strokeWidth={1.8} className={s.moon} />
    </button>
  );
}

export function UserMenu({ label }: { label: string }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
