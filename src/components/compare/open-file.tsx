"use client";

import { useState } from "react";
import { FileViewer } from "@/components/rfx-new/file-viewer";

/** P10: "Open file" opens the vendor's file in the in-app viewer (side sheet) instead of downloading it. */
export function OpenFile({ url, text, name, label = "Open file", style }: { url?: string | null; text?: string; name: string; label?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="linkish" style={style} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{label}</button>
      {open && <FileViewer file={text !== undefined ? { name: `${name}.txt`, blob: new Blob([text]) } : { name, url: url ?? undefined }} onClose={() => setOpen(false)} />}
    </>
  );
}
