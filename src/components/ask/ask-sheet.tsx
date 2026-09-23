"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { AskAnswer } from "@/lib/query/ask";
import { shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AskCard } from "./ask-card";

// DESIGN §3.7: the buyer opens Ask from the RFx header, the approver from the Comparison toolbar — the same 400px sheet.
const AskCtx = createContext<{ open: () => void } | null>(null);
export const useAsk = () => useContext(AskCtx);

const SUGGESTIONS = [
  "Cheapest vendor per line, only among vendors who cleared the questionnaire",
  "What does that save versus awarding everything to the cheapest single vendor?",
  "Which lines have only one qualified quote?",
  "Which cells are you not sure about, and how much money rides on them?",
];

export function AskProvider({ rfxId, children }: { rfxId: string; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  return (
    <AskCtx.Provider value={{ open }}>
      {children}
      {isOpen && <AskSheet rfxId={rfxId} onClose={() => setOpen(false)} />}
    </AskCtx.Provider>
  );
}

export function AskButton() {
  const ask = useAsk();
  if (!ask) return null;
  return <Button onClick={ask.open}><MessageSquare strokeWidth={1.7} /> Ask</Button>;
}

function AskSheet({ rfxId, onClose }: { rfxId: string; onClose: () => void }) {
  const [cards, setCards] = useState<AskAnswer[]>([]);
  const [history, setHistory] = useState<AskAnswer[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/ask/history?rfx=${rfxId}`).then((r) => r.json()).then((b) => setHistory(b.items ?? [])).catch(() => setHistory([]));
  }, [rfxId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    if (!pending) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(t);
  }, [pending]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [cards.length, pending]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setText("");
    setPending(question);
    setElapsed(0);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx_id: rfxId, question }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.error ?? "The question didn't go through"} (${body.code ?? res.status})`);
      setCards((c) => [...c, body]);
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server — check the connection and ask again (NETWORK)" : (e as Error).message);
      setText(question);
    } finally {
      setPending(null);
    }
  }

  const asked = new Set(cards.map((c) => c.question));
  const earlier = (history ?? []).filter((h) => !cards.some((c) => c.query_id === h.query_id));
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-label="Ask">
        <div className="hd"><b>Ask</b><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
        <div className="bd" ref={log}>
          {earlier.length > 0 && (
            <div>
              <button className="eyebrow" onClick={() => setShowHistory(!showHistory)} style={{ cursor: "pointer" }}>
                {showHistory ? "▾" : "▸"} Earlier questions · {earlier.length}
              </button>
              {showHistory && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column" }}>
                  {earlier.map((h) => (
                    <button key={h.query_id} onClick={() => setCards((c) => [...c, h])} style={{ textAlign: "left", padding: "6px 0", borderBottom: "1px solid var(--hair2)", fontSize: 12.5 }}>
                      {h.question}
                      <div className="hint">{h.asked_by ?? ""} · {shortDate(h.created_at)}{h.ok ? "" : " · no answer"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!cards.length && !pending && <div className="text-muted-foreground" style={{ fontSize: 12 }}>Ask in plain language. Every number comes from a query over the grid, and the query is shown with the answer.</div>}
          {cards.map((a) => <AskCard key={a.query_id} a={a} rfxId={rfxId} />)}
          {pending && (
            <div className="qa">
              <div className="q">{pending}</div>
              <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>Writing the query and running it… <span className="mono">{(elapsed / 1000).toFixed(1)} s</span></div>
            </div>
          )}
        </div>
        <div className="ft">
          <div className="sugg">
            {SUGGESTIONS.filter((s) => !asked.has(s)).slice(0, 3).map((s) => <button key={s} disabled={!!pending} onClick={() => ask(s)}>{s}</button>)}
          </div>
          <textarea className="ta" style={{ minHeight: 52, resize: "none" }} placeholder="Ask about prices, coverage, assumptions…" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" variant="default" disabled={!text.trim() || !!pending} onClick={() => ask(text)}>{pending ? "Asking…" : "Ask"}</Button>
          </div>
        </div>
      </aside>
    </>
  );
}
