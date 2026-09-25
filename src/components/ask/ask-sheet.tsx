"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { AskAnswer } from "@/lib/query/ask";
import { inrShort, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AskCard } from "./ask-card";

// DESIGN §3.7: the buyer opens Ask from the RFx header, the approver from the Comparison toolbar — the same 400px sheet.
const AskCtx = createContext<{ open: () => void; locked: boolean } | null>(null);
export const useAsk = () => useContext(AskCtx);

const SUGGESTIONS = [
  "Cheapest vendor per line, only among vendors who cleared the questionnaire",
  "What does that save versus awarding everything to the cheapest single vendor?",
  "Which lines have only one qualified quote?",
  "Which cells are you not sure about, and how much money rides on them?",
];

export function AskProvider({ rfxId, locked = false, children }: { rfxId: string; locked?: boolean; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  return (
    <AskCtx.Provider value={{ open, locked }}>
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

type Action = { tool: string; text: string; data?: unknown };
/** One exchange: the user's message and the analyst's reply with what its tools did; or an earlier answer reopened. */
export type Exchange = { key: string; q: string; reply?: string; actions?: Action[]; context?: string; error?: string; earlier?: AskAnswer };

/** One Ask session with the analyst agent (P9 C13): this session's exchanges, the RFx's earlier answers, the message in flight. */
export function useAskRunner(rfxId: string) {
  // The conversation survives a reload and opens in the full-page Ask (new tab): kept in this browser, per RFx.
  // ponytail: per browser, not per user; move to a table if two people share one browser.
  const key = `ql-ask-${rfxId}`;
  const [turns, setTurns] = useState<Exchange[]>([]);
  const loaded = useRef(false); // read after mount (server render has no storage); never save before it's read
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage exists only after mount; reading it in render would mismatch the server HTML
    try { setTurns((JSON.parse(localStorage.getItem(key) ?? "[]") as Exchange[]).filter((t) => !t.earlier)); } catch { /* blocked: start empty */ }
  }, [key]);
  useEffect(() => {
    if (!loaded.current) { loaded.current = true; return; } // first run is the empty initial state, before the stored chat arrives
    try { localStorage.setItem(key, JSON.stringify(turns.slice(-20))); } catch { /* storage full or blocked: the chat still works */ }
  }, [key, turns]);
  // Another tab (sheet ↔ full page) added a turn: show it here too.
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === key && e.newValue) try { setTurns(JSON.parse(e.newValue)); } catch { /* ignore */ } };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [key]);
  const [history, setHistory] = useState<AskAnswer[] | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ q: string; steps: string[] } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    fetch(`/api/ask/history?rfx=${rfxId}`).then((r) => r.json()).then((b) => setHistory(b.items ?? [])).catch(() => setHistory([]));
  }, [rfxId]);
  useEffect(() => {
    if (!pending) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(t);
  }, [!!pending]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(q: string) {
    const message = q.trim();
    if (!message || pending) return;
    setText("");
    setPending({ q: message, steps: [] });
    setElapsed(0);
    // What the agent remembers: each message and its reply with the ids its tools returned ("save that", "export it").
    const past = turns.flatMap((t) => t.earlier
      ? [{ role: "user" as const, text: t.q }, { role: "model" as const, text: `${t.earlier.answer_text}\n[query_data: answer_id ${t.earlier.query_id}]` }]
      : t.context ? [{ role: "user" as const, text: t.q }, { role: "model" as const, text: t.context }] : []);
    try {
      const res = await fetch(`/api/rfx/${rfxId}/analyst`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, history: past }) });
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})); throw new Error(`${b.error ?? "The question didn't go through"} (${b.code ?? res.status})`); }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "", done: Exchange | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += value;
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const l of lines.filter(Boolean)) {
          const ev = JSON.parse(l);
          if (ev.type === "step") setPending((p) => (p ? { ...p, steps: [...p.steps, ev.text] } : p));
          else if (ev.type === "done") done = { key: crypto.randomUUID(), q: message, reply: ev.reply, actions: ev.actions, context: ev.context };
          else if (ev.type === "error") throw new Error(`${ev.error} (${ev.code})`);
        }
      }
      if (!done) throw new Error("The answer was cut off — ask again (STREAM)");
      setTurns((t) => [...t, done!]);
    } catch (e) {
      toast.error((e as Error).message === "Failed to fetch" ? "Couldn't reach the server — check the connection and ask again (NETWORK)" : (e as Error).message);
      setText(message);
    } finally {
      setPending(null);
    }
  }
  const shown = new Set(turns.flatMap((t) => [t.earlier?.query_id, ...(t.actions ?? []).map((a) => (a.data as AskAnswer | undefined)?.query_id)]));
  const earlier = (history ?? []).filter((h) => !shown.has(h.query_id));
  const clear = () => setTurns([]);
  return { turns, earlier, text, setText, pending, elapsed, ask, clear };
}

const ASKED = new Set(["save_scenario", "compare_scenarios", "override_scenario_line", "draft_award_memo"]);

/** The analyst's reply and what its tools did: answer cards, scenario / memo links, downloads, a clarification draft. */
export function ExchangeView({ t, rfxId }: { t: Exchange; rfxId: string }) {
  if (t.earlier) return <AskCard a={t.earlier} rfxId={rfxId} />;
  const acts = t.actions ?? [];
  return (
    <div className="ask-ex">
      <div className="msg me">{t.q}</div>
      {t.reply && (() => {
        // The summary's first line is the headline (bold); the rest explains. The card below holds the detail.
        const [head, ...rest] = t.reply.split(/\n+/);
        return <div className="msg cp">{rest.length ? <><b>{head}</b>{"\n"}{rest.join("\n")}</> : head}</div>;
      })()}
      {acts.map((a, i) => {
        const d = (a.data ?? {}) as Record<string, string>;
        if (a.tool === "query_data") return <AskCard key={i} a={a.data as AskAnswer} rfxId={rfxId} />;
        if (a.tool === "export") return <div key={i} className="ask-act"><Button asChild size="sm"><a href={d.url} download>Download · {d.label}</a></Button></div>;
        if (a.tool === "draft_clarification") return <ClarDraft key={i} rfxId={rfxId} d={a.data as ClarData} />;
        if (a.tool === "compare_scenarios") return <CompareView key={i} d={a.data as CompareData} />;
        if (ASKED.has(a.tool)) return (
          <div key={i} className="ask-act">
            <span>✓ {a.text.replace(/ \(answer_id [^)]*\)/, "")}</span>
            {d.pdf && <a href={d.pdf} target="_blank" rel="noreferrer">Memo PDF</a>}
            {d.url && <a href={d.url}>Award tab</a>}
          </div>
        );
        return null;
      })}
    </div>
  );
}

type CompareData = { url: string; scenarios: { id: string; name: string; total: number; vendors: number; savings: number | null }[] };
function CompareView({ d }: { d: CompareData }) {
  const low = Math.min(...d.scenarios.map((s) => s.total));
  return (
    <div className="rows">
      <table className="t">
        <thead><tr><th>Scenario</th><th className="num">Total</th><th className="num">Vendors</th><th className="num">Saves vs one vendor</th></tr></thead>
        <tbody>{d.scenarios.map((s) => (
          <tr key={s.id}><td>{s.name}{s.total === low && d.scenarios.length > 1 ? <span className="hint"> · lowest</span> : null}</td>
            <td className="num mono">{inrShort(s.total)}</td><td className="num mono">{s.vendors}</td><td className="num mono">{s.savings === null ? "—" : inrShort(s.savings)}</td></tr>
        ))}</tbody>
      </table>
      <div className="ask-act" style={{ paddingLeft: 0, marginTop: 6 }}><a href={d.url}>Open the Award tab</a></div>
    </div>
  );
}

type ClarData = { vendor_id: string; vendor: string; to: string; subject: string; body: string; item_ids: string[] };
/** P9 C8: the agent only drafts; the buyer edits and clicks Send (the same /api/clarify/send as the Review queue). */
function ClarDraft({ rfxId, d }: { rfxId: string; d: ClarData }) {
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  const [state, setState] = useState<"draft" | "sending" | "sent">("draft");
  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/clarify/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rfx_id: rfxId, vendor_id: d.vendor_id, subject, body, review_item_ids: d.item_ids }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${b.error ?? "Couldn't send"} (${b.code ?? res.status})`);
      setState("sent"); toast.success(`Sent to ${d.vendor}`);
    } catch (e) { setState("draft"); toast.error((e as Error).message); }
  }
  return (
    <div className="ask-draft">
      <div className="hint">Draft to {d.vendor} · {d.to} · not sent</div>
      <input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={state !== "draft"} aria-label="Subject" />
      <textarea className="ta" value={body} onChange={(e) => setBody(e.target.value)} disabled={state !== "draft"} rows={8} aria-label="Email body" />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {state === "sent" ? <span className="hint">Sent — the cards are marked asked</span>
          : <Button size="sm" variant="default" disabled={state === "sending" || !subject.trim() || !body.trim()} onClick={send}>{state === "sending" ? "Sending…" : "Send"}</Button>}
      </div>
    </div>
  );
}

/** The message in flight: what the agent is doing, step by step. */
export function PendingView({ p, elapsed }: { p: { q: string; steps: string[] }; elapsed: number }) {
  return (
    <div className="ask-ex">
      <div className="msg me">{p.q}</div>
      <div className="msg cp">
        {p.steps.map((s, i) => <div key={i} className="text-muted-foreground" style={{ fontSize: 12.5 }}>{i < p.steps.length - 1 ? `✓ ${s.replace(/…$/, "")}` : s}</div>)}
        <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>{p.steps.length ? "" : "Thinking… "}<span className="mono">{(elapsed / 1000).toFixed(1)} s</span></div>
      </div>
    </div>
  );
}

/** "Earlier questions · n": the RFx's last 20 answers (either user). Clicking a question opens its stored card right under it
 * (not re-run, not added to the chat); clicking it again closes it. */
export function EarlierQuestions({ earlier, rfxId }: { earlier: AskAnswer[]; rfxId: string }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!earlier.length) return null;
  return (
    <div>
      <button className="eyebrow" onClick={() => setShow(!show)} style={{ cursor: "pointer" }}>{show ? "▾" : "▸"} Earlier questions · {earlier.length}</button>
      {show && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column" }}>
          {earlier.map((h) => (
            <div key={h.query_id} style={{ borderBottom: "1px solid var(--hair2)" }}>
              <button onClick={() => setOpen(open === h.query_id ? null : h.query_id)} aria-expanded={open === h.query_id} style={{ textAlign: "left", padding: "6px 0", fontSize: 12.5, width: "100%" }}>
                {open === h.query_id ? "▾ " : "▸ "}{h.question}
                <div className="hint">{h.asked_by ?? ""} · {shortDate(h.created_at)}{h.ok ? "" : " · no answer"}</div>
              </button>
              {open === h.query_id && <div style={{ margin: "4px 0 10px" }}><AskCard a={h} rfxId={rfxId} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Ask conversation: the side sheet (with "Open in new tab") and the full page /rfx/{id}/ask share it. */
export function AskChat({ rfxId, page = false, onClose }: { rfxId: string; page?: boolean; onClose?: () => void }) {
  const { turns, earlier, text, setText, pending, elapsed, ask, clear } = useAskRunner(rfxId);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onClose) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns.length, pending?.steps.length]);
  const asked = new Set(turns.map((t) => t.q));
  return (
    <>
      <div className="hd">
        <b>Ask</b>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {turns.length > 0 && !pending && <Button variant="ghost" size="sm" onClick={clear}>New conversation</Button>}
          {!page && <Button variant="ghost" size="sm" asChild><a href={`/rfx/${rfxId}/ask`} target="_blank" rel="noreferrer">Open in new tab</a></Button>}
          {onClose && <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}
        </div>
      </div>
      <div className="bd" ref={log}>
        <EarlierQuestions earlier={earlier} rfxId={rfxId} />
        {!turns.length && !pending && <div className="text-muted-foreground" style={{ fontSize: 12 }}>Ask in plain language, or ask me to save a scenario, compare scenarios, export, or draft the memo or a clarification. Every number comes from a query, shown with the answer. Approving and sending stay with you.</div>}
        {turns.map((t) => <ExchangeView key={t.key} t={t} rfxId={rfxId} />)}
        {pending && <PendingView p={pending} elapsed={elapsed} />}
      </div>
      <div className="ft">
        <div className="sugg">
          {SUGGESTIONS.filter((s) => !asked.has(s)).slice(0, 3).map((s) => <button key={s} disabled={!!pending} onClick={() => setText(s)}>{s}</button>)}
        </div>
        <textarea className="ta" style={{ minHeight: 52, resize: "none" }} placeholder="Ask about prices, coverage, terms, documents… or say what to do" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="sm" variant="default" disabled={!text.trim() || !!pending} onClick={() => ask(text)}>{pending ? "Working…" : "Ask"}</Button>
        </div>
      </div>
    </>
  );
}

function AskSheet({ rfxId, onClose }: { rfxId: string; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet ask-sheet" role="dialog" aria-label="Ask"><AskChat rfxId={rfxId} onClose={onClose} /></aside>
    </>
  );
}
