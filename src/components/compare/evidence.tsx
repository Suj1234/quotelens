import type { Evidence } from "@/lib/evidence";

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
        {ev.open_url && <a href={ev.open_url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Open file</a>}
      </div>
    </div>
  );
}

function Marked({ text, mark }: { text: string; mark?: string }) {
  const i = mark ? text.indexOf(mark) : -1;
  if (!mark || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{mark}</mark>{text.slice(i + mark.length)}</>;
}
