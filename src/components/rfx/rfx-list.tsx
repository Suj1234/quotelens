"use client";

import { useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Eye, Search } from "lucide-react";
import { dateTime, inrShort, longDate } from "@/lib/format";
import { DEFAULTS, STATUS_TABS, UNTITLED, applyFilters, deadlineText, inTab, nextStep, type Filters, type ListRow } from "@/lib/rfx-list";
import { RowLink } from "./row-link";
import { DateRange } from "./date-range";

const LABEL = { draft: "Draft", issued: "Issued", receiving: "Receiving", reviewing: "Reviewing", awarded: "Awarded", closed: "Closed" };

/** Filters live in the URL (?q=&status=…) so Back and shared links keep them; history.replaceState updates it without a server round trip. */
export function RfxList({ rows, buyer }: { rows: ListRow[]; buyer: boolean }) {
  const params = useSearchParams();
  const f: Filters = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) { const v = params.get(k); if (v) (f as Record<string, string>)[k] = v; }
  const search = useRef<HTMLInputElement>(null);

  function set(patch: Partial<Filters>) {
    const next = { ...f, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && v !== DEFAULTS[k as keyof Filters]) sp.set(k, v);
    window.history.replaceState(null, "", sp.size ? `?${sp}` : window.location.pathname);
  }
  function clear() { set({ ...DEFAULTS }); if (search.current) search.current.value = ""; }
  function sortBy(key: string) {
    set({ sort: key, dir: f.sort === key && f.dir === "desc" ? "asc" : "desc" });
  }

  const shown = applyFilters(rows, f);
  const filtered = f.q || f.cfrom || f.cto || f.ufrom || f.uto || f.status !== "all";
  const tabs = STATUS_TABS.filter((t) => t.key !== "closed" || rows.some((r) => r.status === "closed"));

  const th = (key: string, label: string, num = false) => (
    <th className={num ? "ra" : undefined} aria-sort={f.sort === key ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className={`sortbtn ${f.sort === key ? "on" : ""}`} onClick={() => sortBy(key)}>
        {label}<span aria-hidden>{f.sort === key ? (f.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <div className="card listcard">
      <div className="tabs listtabs" role="tablist" aria-label="Status">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={f.status === t.key} className={f.status === t.key ? "active" : undefined} onClick={() => set({ status: t.key })}>
            {t.label}<span className="cnt">{rows.filter((r) => inTab(r, t.key)).length}</span>
          </button>
        ))}
      </div>
      <div className="listfilters">
        <label className="searchbox">
          <Search strokeWidth={1.8} aria-hidden />
          <input ref={search} type="search" className="inp" placeholder="Search code or title" aria-label="Search events"
            defaultValue={f.q} onChange={(e) => set({ q: e.target.value })} />
        </label>
        <DateRange label="Created" from={f.cfrom} to={f.cto} onChange={(cfrom, cto) => set({ cfrom, cto })} />
        <DateRange label="Updated" from={f.ufrom} to={f.uto} onChange={(ufrom, uto) => set({ ufrom, uto })} />
        <span className="grow" />
        <span className="hint" aria-live="polite">
          Showing {shown.length} of {rows.length}
          {filtered && <> · <button type="button" className="linkbtn" onClick={clear}>Clear filters</button></>}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="listempty"><b>No events match.</b> Try another search, or <button type="button" className="linkbtn" onClick={clear}>clear filters</button> to see all {rows.length}.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="t rfxlist">
            <thead>
              <tr>
                {/* What it is → progress → money → dates → where it stands → open */}
                {th("code", "Code")}<th>Title</th><th className="num">Lines</th>{th("responses", "Responses")}{th("deadline", "Deadline")}
                {th("value", "Awarded value", true)}{th("created", "Created")}{th("updated", "Updated")}<th>Next step</th><th>Status</th>
                <th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const href = r.status === "draft" && buyer ? `/rfx/new?id=${r.id}` : `/rfx/${r.id}`;
                const step = nextStep(r);
                const due = deadlineText(r);
                const untitled = r.status === "draft" && r.title === UNTITLED;
                return (
                  <RowLink key={r.id} href={href}>
                    <td className="mono"><Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{r.code}</Link></td>
                    <td className={`ttl ${untitled ? "muted" : ""}`}>{untitled ? "Untitled draft" : r.title}</td>
                    <td className="num mono">{r.lines}</td>
                    <td className="mono">{r.responded} of {r.invited}</td>
                    <td><span className={`tone ${due.tone}`}>{due.text}</span></td>
                    <td className="ra">{r.annual_value !== null ? <span className="mono">{inrShort(r.annual_value)}</span> : <span className="muted">Not awarded</span>}</td>
                    <td className="muted nowrap" title={dateTime(r.created)}>{longDate(r.created)}</td>
                    <td className="muted nowrap" title={dateTime(r.updated)}>{longDate(r.updated)}</td>
                    <td><span className={`tone ${step.tone}`}>{step.text}</span></td>
                    <td className="nowrap"><span className={`status ${r.status}`}>{LABEL[r.status]}</span></td>
                    <td className="act"><Link href={href} className="viewbtn" title={`Open ${r.code}`} aria-label={`Open ${r.code}`}><Eye strokeWidth={1.8} /></Link></td>
                  </RowLink>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
