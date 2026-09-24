"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STAGES, type Stage, type StageState } from "@/types/db";

type Props = {
  responseId: string; canRun: boolean; autoRun?: boolean;
  status: Partial<Record<Stage, StageState>>; errors: Partial<Record<Stage, string>>; timings: Partial<Record<Stage, number>>;
};
type Ev = { stage: Stage; status: "done" | "error" | "skipped"; ms: number; error?: string };

const secs = (ms?: number) => (ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`);

/** DESIGN §2.12. Run all streams NDJSON stage events from the server chain (TRD §16 run-all). */
export function PipelineStrip({ responseId, canRun, autoRun, ...initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initial.status);
  const [errors, setErrors] = useState(initial.errors);
  const [timings, setTimings] = useState(initial.timings);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Date.now() - started.current), 500);
    return () => clearInterval(t);
  }, [busy]);

  function apply(ev: Ev) {
    const state: StageState = ev.status === "done" ? "done" : ev.status === "error" ? "error" : "pending";
    setStatus((s) => {
      const next = { ...s, [ev.stage]: state };
      const after = STAGES[STAGES.indexOf(ev.stage) + 1];
      if (ev.status === "done" && after) next[after] = "running";
      return next;
    });
    if (ev.status === "done") setTimings((t) => ({ ...t, [ev.stage]: ev.ms }));
    if (ev.error && ev.status === "error") setErrors((e) => ({ ...e, [ev.stage]: ev.error }));
  }

  async function run(from?: Stage, only?: boolean) {
    setBusy(true);
    started.current = Date.now();
    setElapsed(0);
    const first = from ?? "classify";
    setStatus((s) => ({ ...s, [first]: "running" }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== first)));
    try {
      const url = only ? `/api/responses/${responseId}/stage/${first}` : `/api/responses/${responseId}/run-all${from ? `?from=${from}` : ""}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${body.error ?? "Request failed"} (${body.code ?? res.status})`);
      }
      if (only) {
        apply(await res.json());
      } else {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const l of lines) if (l.trim()) apply(JSON.parse(l));
        }
      }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setStatus((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === "running" ? "pending" : v])));
    } finally {
      setBusy(false);
    }
  }

  const auto = useRef(false);
  useEffect(() => { // once, and only for a fresh reply (nothing run yet); the URL loses ?run so a reload doesn't re-run
    if (!autoRun || auto.current || STAGES.some((s) => initial.status[s] && initial.status[s] !== "pending")) return;
    auto.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void run();
  });

  const failed = STAGES.find((s) => status[s] === "error");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12 }}>
        <span className="eyebrow">Pipeline {busy && <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>· {secs(elapsed)}</span>}</span>
        {canRun && <Button size="sm" disabled={busy} onClick={() => run()}>{busy ? "Running…" : STAGES.some((s) => status[s] === "done") ? "Re-run all stages" : "Run all stages"}</Button>}
      </div>
      <div className="pipe">
        {STAGES.map((s) => {
          const st = status[s] ?? "pending";
          return (
            <div key={s} className={`stage ${st}`} title={errors[s]}>
              <div className="nm">{s}{st === "done" && <span className="hint">{secs(timings[s])}</span>}</div>
              <div className="st">{st === "running" ? "running…" : st}</div>
              {st === "error" && canRun && (
                <Button size="xs" variant="outline" style={{ marginTop: 6 }} disabled={busy} onClick={() => run(s)}>Retry</Button>
              )}
            </div>
          );
        })}
      </div>
      {failed && errors[failed] && (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }} role="alert">
          {failed[0].toUpperCase() + failed.slice(1)} failed — {errors[failed]} Retry, or open the file to check it is a quotation.
        </p>
      )}
    </div>
  );
}
