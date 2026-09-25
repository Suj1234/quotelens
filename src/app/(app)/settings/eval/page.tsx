import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { evalEligible, evalHistory, latestEval } from "@/lib/eval/run";
import { listDeep, signedUrls } from "@/lib/storage";
import { dateTime } from "@/lib/format";
import { EvalSection } from "@/components/settings/eval-section";
import { SubTabs, pickTab } from "@/components/settings/subtabs";

const TABS = [["latest", "Latest run"], ["history", "Run history"], ["seed", "Seed data"]] as const;
// What each folder of the dataset pack is (docs/03_Dataset_Pack_README.md).
const FOLDER: Record<string, string> = {
  "00_rfx": "The RFx the vendors answered — line sheet and questionnaire",
  "01_balaji": "Balaji — clean reply", "02_kohinoor": "Kohinoor — clean reply", "03_westline": "Westline — clean reply",
  "04_orientpack": "OrientPack — clean reply", "05_anand": "Anand — clean reply",
  realistic: "The same five replies, messier (hand edits, quoted threads, photos) — loaded on MER-0417",
  gold: "The answer key the eval judges against",
};

// Settings → Evaluation: how well the pipeline reads the seed set (TRD §17.14 / §18).
export default async function EvalPage({ searchParams }: PageProps<"/settings/eval">) {
  await requireUser(["buyer", "admin"]);
  const sp = await searchParams;
  const tab = pickTab(TABS, sp.tab);
  const eligible = await evalEligible();
  const selected = eligible.find((e) => e.id === sp.rfx) ?? eligible.find((e) => e.code === "MER-0419") ?? eligible[0] ?? null;
  const picker = eligible.length > 1 && tab === "history" && (
    <p className="hint" style={{ margin: "0 0 10px", display: "flex", gap: 8 }}>
      {eligible.map((e) => <Link key={e.id} href={`/settings/eval?tab=history&rfx=${e.id}`} className={e.id === selected?.id ? "chip teal" : "chip grey"}>{e.code} · {e.set}</Link>)}
    </p>
  );

  let body: React.ReactNode;
  if (tab === "latest") {
    const [last, vendors] = await Promise.all([selected ? latestEval(selected.id) : null, db().from("vendors").select("short_code, name")]);
    body = <EvalSection eligible={eligible} selected={selected} last={last} vendors={Object.fromEntries((vendors.data ?? []).map((v) => [v.short_code, v.name]))} />;
  } else if (tab === "history") {
    const runs = selected ? await evalHistory(selected.id) : [];
    body = (
      <>
        {picker}
        <div className="card">
          <div className="hd"><b>Run history{selected ? ` · ${selected.code}` : ""}</b><span className="hint">every stored run, newest first — a drop after a prompt change means it made reading worse</span></div>
          {runs.length ? (
            <table className="t">
              <thead><tr><th>Ran</th><th className="num">Correct or flagged</th><th className="num">Correct</th><th className="num">Flagged OK</th><th className="num">Wrong</th><th className="num">Missing</th><th className="num">Questionnaire</th><th className="num">Change</th></tr></thead>
              <tbody>{runs.map((r, i) => {
                const score = r.totals.correct + r.totals.flagged_ok, prev = runs[i + 1] ? runs[i + 1].totals.correct + runs[i + 1].totals.flagged_ok : null;
                const d = prev == null ? null : score - prev;
                return (
                  <tr key={r.id}>
                    <td className="mono xs">{dateTime(r.ran_at)}</td>
                    <td className="num"><b style={{ fontWeight: 500 }}>{score}</b>/{r.totals.cells}</td>
                    <td className="num">{r.totals.correct}</td><td className="num">{r.totals.flagged_ok}</td><td className="num">{r.totals.wrong}</td><td className="num">{r.totals.missing}</td>
                    <td className="num">{r.totals.questionnaire_total ? `${r.totals.questionnaire_correct}/${r.totals.questionnaire_total}` : "—"}</td>
                    <td className="num">{d == null ? <span className="muted">first</span> : d === 0 ? <span className="muted">same</span> : <span className={`chip ${d > 0 ? "green" : "red"}`}>{d > 0 ? `+${d}` : d}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <div className="bd"><div className="empty"><b>No runs stored{selected ? ` for ${selected.code}` : ""}.</b> Run eval under Latest run.</div></div>}
        </div>
      </>
    );
  } else {
    const [files, loads, runs] = await Promise.all([
      listDeep("seed", "seed").catch(() => []),
      db().from("audit_events").select("rfx_id, actor, payload, created_at").eq("event", "seed.responses_loaded").order("created_at", { ascending: false }),
      db().from("eval_runs").select("rfx_id, ran_at, totals").order("ran_at", { ascending: false }).limit(200),
    ]);
    const urls = await signedUrls("seed", files.map((f) => f.path)).catch(() => new Map<string, string>());
    const users = new Map(((await db().from("users").select("id, name")).data ?? []).map((u) => [u.id, u.name]));
    const groups = new Map<string, typeof files>();
    for (const f of files) {
      const rest = f.path.slice("seed/".length), top = rest.includes("/") ? rest.split("/")[0] : "(pack root)";
      groups.set(top, [...(groups.get(top) ?? []), f]);
    }
    body = (
      <>
        <div className="card">
          <div className="hd"><b>Seed RFx</b><span className="hint">the RFx whose replies come from the dataset pack, so the answer key can judge them</span></div>
          {eligible.length ? (
            <table className="t">
              <thead><tr><th>RFx</th><th>Set</th><th>Last loaded</th><th>Latest eval</th><th /></tr></thead>
              <tbody>{eligible.map((e) => {
                const l = (loads.data ?? []).find((x) => x.rfx_id === e.id), r = (runs.data ?? []).find((x) => x.rfx_id === e.id);
                const t = r?.totals as { correct: number; flagged_ok: number; cells: number } | undefined;
                return (
                  <tr key={e.id}>
                    <td><span className="mono">{e.code}</span> <span className="muted">{e.title}</span></td>
                    <td><span className="chip grey">{e.set}</span></td>
                    <td>{l ? <>{dateTime(l.created_at)} <span className="hint">· {users.get(l.actor) ?? "QuoteLens"} · {String((l.payload as { responses?: unknown }).responses ?? "")} replies</span></> : <span className="muted">—</span>}</td>
                    <td>{t ? <><b style={{ fontWeight: 500 }}>{t.correct + t.flagged_ok}</b>/{t.cells} <span className="hint">· {dateTime(r!.ran_at)}</span></> : <span className="muted">never run</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}><Link href={`/rfx/${e.id}/responses`} style={{ fontSize: 12 }}>Responses</Link> · <Link href={`/settings/eval?rfx=${e.id}`} style={{ fontSize: 12 }}>Eval</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <div className="bd hint">No RFx has seeded replies yet. Open an RFx&apos;s Responses tab and use Load seeded responses.</div>}
          <div className="bd hint" style={{ borderTop: "1px solid var(--hair2)" }}>Reloading replaces that RFx&apos;s seeded replies and everything read from them, so it lives on the RFx&apos;s Responses tab, not here.</div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="hd"><b>Dataset pack</b><span className="hint">{files.length} files in storage bucket <span className="mono">seed</span> — download any to see exactly what a vendor sent</span></div>
          {files.length ? [...groups].map(([g, fs]) => (
            <div key={g} className="bd" style={{ borderBottom: "1px solid var(--hair2)" }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{g} {FOLDER[g] && <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>— {FOLDER[g]}</span>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
                {fs.map((f) => {
                  const name = f.path.slice(`seed/${g}/`.length) || f.path.slice(5), url = urls.get(f.path);
                  return <span key={f.path} className="mono xs">{url ? <a href={url}>{name}</a> : name} <span className="muted">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ""}</span></span>;
                })}
              </div>
            </div>
          )) : <div className="bd hint">The bucket is empty — run <span className="mono">npm run seed</span> to upload the pack.</div>}
        </div>
      </>
    );
  }
  return (
    <>
      <SubTabs base="/settings/eval" tabs={TABS} tab={tab} />
      {body}
    </>
  );
}
