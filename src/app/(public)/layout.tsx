import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import s from "./doc.module.css";

// Public pages (no session): Privacy, Terms, Help.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link href="/" className="brand" style={{ fontSize: 15, color: "var(--ink)", textDecoration: "none" }}><span className="brand-mark" />QuoteLens</Link>
        <nav className={s.topnav}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/help">Help</Link>
          <Link href="/" className={s.signin}>Sign in</Link>
        </nav>
      </header>
      <main className={s.main}>{children}</main>
      <SiteFooter />
    </div>
  );
}
