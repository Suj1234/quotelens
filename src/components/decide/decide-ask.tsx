"use client";

import { useAskRunner, EarlierQuestions, ExchangeView, PendingView } from "@/components/ask/ask-sheet";
import { Button } from "@/components/ui/button";

// DESIGN §2.14 Ask box + §3.8: exchanges newest first, then the Cost / Risk / Vendors suggestion groups (asked ones drop out).
// P9 C13–C14: the same analyst agent as the Ask sheet; a suggestion fills the box instead of sending.
export function DecideAsk({ rfxId, groups }: { rfxId: string; groups: [string, string[]][] }) {
  const { turns, earlier, text, setText, pending, elapsed, ask } = useAskRunner(rfxId);
  const asked = new Set(turns.map((t) => t.q));
  return (
    <>
      <div className="askbox" style={{ marginTop: 22 }}>
        <textarea placeholder="Ask about this event — cost, risk, a vendor, a line…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask a question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
        <div className="row">
          <span className="hint">Answers are computed from the comparison; the query is shown with every answer.</span>
          <Button variant="default" disabled={!text.trim() || !!pending} onClick={() => ask(text)}>{pending ? "Working…" : "Ask"}</Button>
        </div>
      </div>
      {(turns.length > 0 || pending) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {pending && <PendingView p={pending} elapsed={elapsed} />}
          {[...turns].reverse().map((t) => <ExchangeView key={t.key} t={t} rfxId={rfxId} />)}
        </div>
      )}
      <div className="qgroups" style={{ marginTop: 22 }}>
        {groups.map(([g, qs]) => (
          <div className="qgroup" key={g}>
            <div className="eyebrow">{g}</div>
            {qs.filter((q) => !asked.has(q)).map((q) => <button key={q} disabled={!!pending} onClick={() => setText(q)}>{q}</button>)}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}><EarlierQuestions earlier={earlier} rfxId={rfxId} /></div>
    </>
  );
}
