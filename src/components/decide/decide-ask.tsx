"use client";

import { useAskRunner, EarlierQuestions, ExchangeView, PendingView } from "@/components/ask/ask-sheet";
import { Button } from "@/components/ui/button";

// DESIGN §2.14 Ask box + §3.8 (reworked, DECISIONS 2026-09-25 "Decide for Priya"): the box, three suggestions (asked ones
// drop out), this visit's exchanges newest first, then the user's own past answers collapsed under "Earlier questions" (as in
// the Ask sheet); nothing from an earlier visit opens by default (DECISIONS 2026-09-25 "Ask chat per user").
// P9 C13–C14: the same analyst agent as the Ask sheet; a suggestion fills the box instead of sending.
export function DecideAsk({ rfxId, suggestions }: { rfxId: string; suggestions: string[] }) {
  const { turns, earlier, text, setText, pending, elapsed, ask } = useAskRunner(rfxId, { fresh: true });
  const asked = new Set(turns.map((t) => t.q));
  const left = suggestions.filter((q) => !asked.has(q));
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
      {left.length > 0 && (
        <div className="qgroups" style={{ marginTop: 10 }}>
          {left.map((q) => <div className="qgroup" key={q}><button disabled={!!pending} onClick={() => setText(q)}>{q}</button></div>)}
        </div>
      )}
      {(turns.length > 0 || pending) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {pending && <PendingView p={pending} elapsed={elapsed} />}
          {[...turns].reverse().map((t) => <ExchangeView key={t.key} t={t} rfxId={rfxId} />)}
        </div>
      )}
      <div style={{ marginTop: 16 }}><EarlierQuestions earlier={earlier} rfxId={rfxId} /></div>
    </>
  );
}
