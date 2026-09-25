"use client";

import { useState } from "react";
import type { Comm } from "@/lib/comms";
import { dateTime, cap } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmailBlock } from "./email-block";


export function OutboxList({ comms }: { comms: Comm[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card">
      {comms.map((c) => (
        <div key={c.id} style={{ borderBottom: "1px solid var(--hair2)" }}>
          <div className="vrow" style={{ gridTemplateColumns: "1.2fr 1.6fr .9fr .9fr auto", borderBottom: 0 }}>
            <div><div className="nm">{c.vendor ?? c.to}</div><div className="sub mono">{c.to}</div></div>
            <div className="sub" style={{ color: "var(--ink2)" }}>{c.subject}<div className="sub">{c.attachments.map((a) => a.name).join(" · ")}</div></div>
            <div className="sub mono">{dateTime(c.at)}</div>
            <div className="sub">{c.status === "sent" ? <span className="chip green">Sent ({c.mode})</span> : c.status === "failed" ? <span className="chip red" title={c.error ?? ""}>Failed</span> : <span className="chip amber">{cap(c.status)}</span>}</div>
            <div><Button size="sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Close" : "Open"}</Button></div>
          </div>
          {open === c.id && <div style={{ padding: "0 14px 14px" }}><EmailBlock c={c} />{c.message_id && <div className="hint" style={{ marginTop: 6 }}>Message id <span className="mono">{c.message_id}</span>{c.eml_url && <> · <a href={c.eml_url} download>Download .eml</a></>}</div>}</div>}
        </div>
      ))}
    </div>
  );
}
