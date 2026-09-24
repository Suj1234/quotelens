import { Suspense } from "react";
import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ShellFrame } from "./shell-frame";

const ROLE_LABEL = { buyer: "Buyer", admin: "Buyer", approver: "VP Procurement" } as const;

export async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const initials = user.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const [jar, { data }] = await Promise.all([cookies(), db().from("rfx").select("status")]);
  const statuses = (data ?? []).map((r) => r.status);
  return (
    <Suspense>
      <ShellFrame
        buyer={user.role !== "approver"}
        user={{ name: user.name, role: ROLE_LABEL[user.role], initials }}
        counts={{ all: statuses.length, reviewing: statuses.filter((x) => x === "reviewing").length }}
        initialCollapsed={jar.get("ql-sidebar")?.value === "collapsed"}>
        {children}
      </ShellFrame>
    </Suspense>
  );
}
