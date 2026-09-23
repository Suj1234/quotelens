"use client";

import { useRouter } from "next/navigation";

/** Whole table row is clickable (DESIGN.md §3.2); the code cell keeps a real link for keyboard users. */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return <tr style={{ cursor: "pointer" }} onClick={() => router.push(href)}>{children}</tr>;
}
