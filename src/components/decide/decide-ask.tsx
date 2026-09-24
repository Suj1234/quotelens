"use client";

import { useAskRunner, EarlierQuestions } from "@/components/ask/ask-sheet";
import { AskCard } from "@/components/ask/ask-card";
import { Button } from "@/components/ui/button";

// DESIGN §2.14 Ask box + §3.8: answer cards newest first, then the Cost / Risk / Vendors suggestion groups (asked ones drop out).
export function DecideAsk({ rfxId, groups }: { rfxId: string; groups: [string, string[]][] }) {
  const { cards, setCards, earlier, text, setText, pending, elapsed, ask } = useAskRunner(rfxId);
  const asked = new Set(cards.map((c) => c.question));
  return (
    <>
      <div className="askbox" style={{ marginTop: 22 }}>
        <textarea placeholder="Ask about this event — cost, risk, a vendor, a line…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask a question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
        <div className="row">
          <span className="hint">Answers are computed from the comparison; the query is shown with every answer.</span>
          <Button variant="default" disabled={!text.trim() || !!pending} onClick={() => ask(text)}>{pending ? "Asking…" : "Ask"}</Button>
        </div>
      </div>
      {(cards.length > 0 || pending) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {pending && <div className="qa"><div className="q">{pending}</div><div className="text-muted-foreground" style={{ fontSize: 12.5 }}>Writing the query and running it… <span className="mono">{(elapsed / 1000).toFixed(1)} s</span></div></div>}
          {[...cards].reverse().map((a) => <AskCard key={a.query_id} a={a} rfxId={rfxId} />)}
        </div>
      )}
      <div className="qgroups" style={{ marginTop: 22 }}>
        {groups.map(([g, qs]) => (
          <div className="qgroup" key={g}>
            <div className="eyebrow">{g}</div>
            {qs.filter((q) => !asked.has(q)).map((q) => <button key={q} disabled={!!pending} onClick={() => ask(q)}>{q}</button>)}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}><EarlierQuestions earlier={earlier} onOpen={(h) => setCards((c) => [...c, h])} /></div>
    </>
  );
}
