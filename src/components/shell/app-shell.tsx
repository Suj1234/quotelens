import type { SessionUser } from "@/lib/auth";
import { Rail } from "./rail";
import { ThemeToggle, UserMenu } from "./topbar-controls";
import s from "./shell.module.css";

const ROLE_LABEL = { buyer: "Buyer", admin: "Buyer", approver: "VP Procurement" } as const;

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const initials = user.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <div className="brand"><span className="brand-mark" />QuoteLens</div>
        <span className={s.org}>Meridian Foods Pvt Ltd</span>
        <div className={s.spacer} />
        <span className="hint"><span className="kbd">⌘K</span></span>
        <ThemeToggle className={s.iconbtn} />
        <div className={s.user}>
          <span className="avatar">{initials}</span>
          <UserMenu label={`${user.name} · ${ROLE_LABEL[user.role]}`} />
        </div>
      </header>
      <div className={s.body}>
        <Rail buyer={user.role !== "approver"} />
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}
