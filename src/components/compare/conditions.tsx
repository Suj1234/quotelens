"use client";

import { useState, type CSSProperties } from "react";
import type { Condition } from "@/lib/conditions";

const POP_W = 420; // = .conds .pop width in globals.css

/** P10 D5: the vendor's conditions as chips (what changes the price's meaning), and all of them on hover or keyboard focus.
 *  The pop is position:fixed, placed from the trigger's rect and kept inside the viewport, so a scrolling table
 *  (overflow:auto) neither clips it nor grows a scrollbar for it. */
export function Conditions({ list }: { list: Condition[] }) {
  const [pos, setPos] = useState<CSSProperties>();
  if (!list.length) return null;
  const chips = list.filter((c) => c.chip);
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - POP_W - 8));
    const below = vh - r.bottom - 12, above = r.top - 12;
    // open below unless it's cramped there and roomier above; scroll inside if still too tall
    setPos(below >= 220 || below >= above
      ? { left, top: r.bottom, maxHeight: below }
      : { left, bottom: vh - r.top, maxHeight: above });
  };
  return (
    <div className="conds" tabIndex={0} aria-label={`Vendor conditions: ${list.map((c) => `${c.label}: ${c.text}`).join("; ")}`}
      onMouseEnter={(e) => place(e.currentTarget)} onFocus={(e) => place(e.currentTarget)}>
      {chips.map((c, i) => <span key={`${c.label}-${i}`} className="chip amber" style={{ height: 15 }}>{c.chip}</span>)}
      <span className="chip" style={{ height: 15 }}>{chips.length ? `+ ${list.length} terms` : `${list.length} terms`}</span>
      <div className="pop" role="tooltip" style={pos}>
        {list.map((c, i) => <div key={`${c.label}-${i}`} className="row"><b>{c.label}</b><span className={c.tone === "amber" ? "amb" : undefined}>{c.text}</span></div>)}
      </div>
    </div>
  );
}
