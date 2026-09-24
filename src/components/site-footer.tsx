import Link from "next/link";

/** Public-page footer: sign-in, Privacy, Terms, Help. */
export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`site-footer ${className}`}>
      <span>© 2026 Meridian Foods Pvt Ltd · Sourcing</span>
      <nav aria-label="Legal and help">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/help">Help</Link>
      </nav>
      <span>Private to Meridian Foods. Vendors never sign in here.</span>
    </footer>
  );
}
