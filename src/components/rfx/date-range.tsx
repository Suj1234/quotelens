"use client";

import { Popover } from "radix-ui";
import { CalendarDays, ChevronDown } from "lucide-react";
import { longDate } from "@/lib/format";
import { presetRange } from "@/lib/rfx-list";

const fmt = (d: string) => longDate(`${d}T00:00:00+05:30`);

/** One filter control for a date range: presets plus From / To (native date inputs), inclusive, IST days. */
export function DateRange({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const value = from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `from ${fmt(from)}` : to ? `until ${fmt(to)}` : "any time";
  const preset = (k: "7" | "30" | "month") => onChange(...presetRange(k));
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={`sel drbtn ${from || to ? "on" : ""}`} aria-label={`${label}: ${value}`}>
          <CalendarDays strokeWidth={1.8} aria-hidden />
          <span>{label}: {value}</span>
          <ChevronDown strokeWidth={1.8} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="drpop" align="start" sideOffset={6}>
          <div className="presets">
            <button type="button" onClick={() => preset("7")}>Last 7 days</button>
            <button type="button" onClick={() => preset("30")}>Last 30 days</button>
            <button type="button" onClick={() => preset("month")}>This month</button>
          </div>
          <div className="fields">
            <label>From<input type="date" className="inp" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} /></label>
            <label>To<input type="date" className="inp" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} /></label>
          </div>
          <div className="foot">
            <button type="button" className="linkbtn" onClick={() => onChange("", "")} disabled={!from && !to}>Clear</button>
            <Popover.Close className="linkbtn">Done</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
