import type { Evidence } from "@/lib/evidence";
import { OpenFile } from "./open-file";

/** DESIGN §2.10: photo crop / PDF page / row or paragraph text with the matched phrase marked, and a caption bar. */
export function EvidenceBlock({ ev }: { ev: Evidence | null }) {
  if (!ev) return <p className="hint">No source location recorded.</p>;
  return (
    <div className="evidence">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL, nothing to optimise */}
      {ev.kind === "image" && ev.url && <img src={ev.url} alt={ev.caption} />}
      {ev.kind === "pdf" && ev.url && <iframe src={ev.url} title={ev.caption} style={{ width: "100%", height: 300, border: 0, display: "block", background: "var(--surface)" }} />}
      {ev.text && <div className="snip"><Marked text={ev.text} mark={ev.mark} /></div>}
      <div className="cap" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{ev.caption}</span>
        {ev.open_url && <OpenFile url={ev.open_url} name={ev.open_name ?? ev.caption.split(" · ")[0]} style={{ color: "inherit" }} />}
      </div>
    </div>
  );
}

export function Marked({ text, mark }: { text: string; mark?: string }) {
  const i = mark ? text.indexOf(mark) : -1;
  if (!mark || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{mark}</mark>{text.slice(i + mark.length)}</>;
}
