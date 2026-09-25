"use client";

import { useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** An export link that shows it's working: the server builds the file before the first byte, so a plain
 *  <a download> looks dead for seconds. Fetch it, show "Exporting…", then hand the blob to the browser. */
export function DownloadButton({ href, children, ...props }: { href: string } & Omit<ComponentProps<typeof Button>, "onClick" | "asChild">) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Export failed (${res.status})`);
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "export";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server — check the connection and try again (NETWORK)" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <Button {...props} onClick={run} disabled={busy || props.disabled} aria-busy={busy}>{busy ? "Exporting…" : children}</Button>;
}
