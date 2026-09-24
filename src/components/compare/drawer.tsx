"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CellDetail } from "@/lib/provenance";
import { longDate, money } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { EvidenceBlock } from "./evidence";

const STATE_LABEL: Record<string, [string, string]> = {
  confirmed: ["Confirmed", "grey"], inferred: ["Inferred", "indigo"], reviewed: ["Reviewed", "green"], low_confidence: ["Low-confidence", "amber"],
  ambiguous: ["Ambiguous", "amber"], not_quoted: ["Not quoted", "grey"], references_prior: ["References prior pricing", "grey"], excluded: ["Excluded", "grey"], conflict: ["Conflict", "red"],
};

/** DESIGN §2.9 provenance drawer: source · as written · mapping · conversion chain · review. */
export function ProvenanceDrawer({ rfxId, cellKey, basis, canReview, locked = false, onClose }: { rfxId: string; cellKey: string; basis: "unit" | "landed"; canReview: boolean; locked?: boolean; onClose: () => void }) {
  const [line, vendor] = cellKey.split(":");
  const [d, setD] = useState<CellDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true; // remounted per cell (key), so state starts empty
    fetch(`/api/rfx/${rfxId}/cell/${line}/${vendor}`).then(async (r) => {
      const j = await r.json();
      if (!live) return;
      if (r.ok) setD(j); else setErr(j.error ?? "Couldn't load this cell.");
    }).catch(() => live && setErr("Couldn't load this cell — check the connection and try again."));
    return () => { live = false; };
  }, [rfxId, line, vendor]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const value = d ? (basis === "landed" ? d.landed : d.unit) : null;
  const [label, tone] = d ? STATE_LABEL[d.state] ?? [d.state, "grey"] : ["", "grey"];
  const open = d?.reviews.find((r) => r.status === "open");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Where this number came from">
        <div className="hd">
          <div>
            <div className="eyebrow">Line {line} · {d?.vendor.name ?? vendor}</div>
            <div className="big">
              {value !== null ? money(value, "INR", 0) : d?.best_guess != null ? `${money(d.best_guess, "INR", 0)}?` : d?.state === "low_confidence" ? "?" : "—"}{" "}
              <span className="text-muted-foreground" style={{ fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: 12 }}>per 1000 pcs{basis === "landed" ? " landed" : ""}</span>
            </div>
            {d && <div style={{ marginTop: 5, fontSize: 12 }}><span className={`chip ${tone}`}>{label}</span> <span className="text-muted-foreground">{d.line.description}</span></div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="bd">
          {err && <p className="empty"><b>Couldn&apos;t load this cell.</b> {err}</p>}
          {!d && !err && <p className="hint">Loading the source…</p>}
          {d && <>
            <section><h3>Source</h3>{d.evidence || !["not_quoted", "references_prior"].includes(d.state)
              ? <EvidenceBlock ev={d.evidence} />
              : <p className="text-muted-foreground" style={{ fontSize: 12.5 }}>{d.state === "not_quoted" ? `Not in ${d.vendor.name}'s reply, so there is no price to show.` : "The vendor points to earlier pricing that isn't on file."}</p>}{d.note && <p className="hint" style={{ marginTop: 6 }}>{d.note}</p>}</section>
            {d.original?.value != null && (
              <section><h3>As written</h3><div style={{ fontSize: 12.5 }}><span className="mono">{money(d.original.value, /\$|usd/i.test(d.original.currency ?? "") ? "USD" : "INR")}</span> <span className="text-muted-foreground">{d.original.unit}</span></div></section>
            )}
            <section>
              <h3>Mapping</h3>
              <div className="text-muted-foreground" style={{ fontSize: 12, marginBottom: 4 }}>Which RFx line does this item belong to?{d.mapping ? ` · ${d.mapping.provider_label}` : ""}</div>
              {d.mapping
                ? d.mapping.options.map((o) => <div className="alt" key={o.line_no}><span>L{o.line_no} {o.description}</span><span className="p">p {o.p.toFixed(2)}</span></div>)
                : <div className="text-muted-foreground" style={{ fontSize: 12 }}>No item mapped for this vendor.</div>}
            </section>
            <section>
              <h3>Conversion chain</h3>
              {d.chain.length ? (
                <div className="chain">
                  {d.chain.map((s, i) => (
                    <div className="step" key={i}>
                      <span className="n">{i + 1}</span>
                      <span>{s.href ? <Link href={s.href}>{s.text}</Link> : s.text}{s.assumption && <div className="hint" style={{ marginTop: 2 }}>{s.assumption} · <Link href={`/rfx/${rfxId}/comparison?tab=ledger`} style={{ color: "inherit" }}>in the ledger</Link></div>}</span>
                      <span className="basis">{s.basis}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-muted-foreground" style={{ fontSize: 12 }}>{d.unit !== null ? "Used as written — already ₹ per 1000 pcs." : "No conversion: nothing to convert."}</div>}
            </section>
            <section>
              <h3>Review</h3>
              {d.reviewed
                ? <div style={{ fontSize: 12.5 }}><span className="chip green">Reviewed</span> <span className="text-muted-foreground">by {d.reviewed.by} · {longDate(d.reviewed.at)}{d.reviewed.note ? ` · ${d.reviewed.note}` : ""}</span></div>
                : open
                  ? canReview
                    ? <Link className={buttonVariants({ size: "sm" })} href={`/rfx/${rfxId}/review?item=${open.id}`}>Open in queue</Link>
                    : <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>{locked ? "Read-only — the RFx is awarded." : "Waiting for Sujit."}</div>
                  : <div className="text-muted-foreground" style={{ fontSize: 12.5 }}>Nothing pending.</div>}
              {d.reviews.filter((r) => r.status !== "open").map((r) => <div key={r.id} className="hint" style={{ marginTop: 4 }}>{r.title} — {r.status.replaceAll("_", " ")}{r.note ? ` · ${r.note}` : ""}</div>)}
            </section>
          </>}
        </div>
      </aside>
    </>
  );
}
