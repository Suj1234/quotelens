"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// P9: "View" on an attached file opens it here, in a side sheet, instead of downloading it. Sheets render as a table
// (SheetJS, loaded only when needed), PDFs and images natively, text as text; anything else offers a download.

export type ViewFile = { name: string; blob?: Blob; url?: string };
type Content =
  | { kind: "sheet"; sheets: { name: string; rows: string[][] }[] }
  | { kind: "frame" | "image"; src: string }
  | { kind: "text"; text: string }
  | { kind: "other"; src: string };

const ext = (n: string) => n.split(".").pop()?.toLowerCase() ?? "";

export function FileViewer({ file, onClose }: { file: ViewFile; onClose: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let url: string | null = null, live = true;
    (async () => {
      const blob: Blob = file.blob ?? await fetch(file.url!).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Couldn't open ${file.name} (${r.status})`);
        return r.blob();
      });
      const e = ext(file.name);
      let c: Content;
      if (["xlsx", "xls", "csv"].includes(e)) {
        const XLSX = await import("xlsx");
        const wb = e === "csv" ? XLSX.read(await blob.text(), { type: "string" }) : XLSX.read(await blob.arrayBuffer(), { type: "array" });
        c = { kind: "sheet", sheets: wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1, raw: false, defval: "" }) })) };
      } else if (e === "txt") c = { kind: "text", text: await blob.text() };
      else {
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: e === "pdf" ? "application/pdf" : "" }));
        c = e === "pdf" ? { kind: "frame", src: url } : ["png", "jpg", "jpeg", "webp"].includes(e) ? { kind: "image", src: url } : { kind: "other", src: url };
      }
      if (live) setContent(c);
    })().catch((e) => live && setError((e as Error).message));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const sheet = content?.kind === "sheet" ? content.sheets[tab] : null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-label={file.name} style={{ width: "min(1100px, 100vw)" }}>
        <div className="hd"><b className="mono" style={{ fontSize: 13 }}>{file.name}</b><Button size="xs" variant="ghost" onClick={onClose}>Close</Button></div>
        {content?.kind === "sheet" && content.sheets.length > 1 && (
          <div className="tabs" style={{ padding: "0 12px" }}>{content.sheets.map((s, i) => <button key={s.name} className={i === tab ? "active" : ""} onClick={() => setTab(i)}>{s.name}</button>)}</div>
        )}
        <div className="bd" style={{ padding: content?.kind === "frame" ? 0 : 16 }}>
          {error && <div className="note warn">{error}</div>}
          {!content && !error && <div className="hint">Opening {file.name}…</div>}
          {sheet && (sheet.rows.length ? (
            <div style={{ overflow: "auto" }}>
              <table className="t" style={{ fontSize: 12 }}>
                <tbody>{sheet.rows.map((row, i) => (
                  <tr key={i}><td className="mono text-muted-foreground" style={{ width: 1 }}>{i + 1}</td>{row.map((cell, j) => <td key={j} style={{ whiteSpace: "nowrap", fontWeight: i === 0 ? 500 : undefined }}>{cell}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="empty">This sheet is empty.</div>)}
          {content?.kind === "frame" && <iframe src={content.src} title={file.name} style={{ width: "100%", height: "100%", border: 0, minHeight: "70vh" }} />}
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise */}
          {content?.kind === "image" && <img src={content.src} alt={file.name} style={{ maxWidth: "100%", height: "auto" }} />}
          {content?.kind === "text" && <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12 }}>{content.text}</pre>}
          {content?.kind === "other" && <div className="empty">This file type can&apos;t be shown here. <a href={content.src} download={file.name}>Download {file.name}</a></div>}
        </div>
      </aside>
    </>
  );
}
