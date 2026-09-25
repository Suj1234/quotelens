"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { VendorRow } from "@/lib/vendors";
import type { Settings } from "@/lib/settings-schema";
import { longDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { send } from "./api";

// Settings → Masters → Vendors: the address book the co-pilot invites from and RFx emails go to, with the per-category
// Approved tick (it saves the category template's approved_vendor_ids — the list the co-pilot reads).
type Form = { name: string; email: string; contact_name: string; city: string; state: string; country: string; default_currency: string; notes: string };
const EMPTY: Form = { name: "", email: "", contact_name: "", city: "", state: "", country: "IN", default_currency: "INR", notes: "" };
const ORIGIN: Record<string, string> = { seed: "Seed", user: "Added by a buyer", auto: "From an unmatched reply" };

export function VendorDirectory({ vendors, category, templates, fxCurrencies }: { vendors: VendorRow[]; category: string; templates: Settings["category_templates"]; fxCurrencies: string[] }) {
  const router = useRouter();
  const template = templates[category];
  const approved = template?.approved_vendor_ids ?? [];
  const [ticking, setTicking] = useState<string | null>(null);
  /** The approved list lives in the category template; one tick saves it (audit: "Approved vendors: added …"). */
  async function approve(v: VendorRow, on: boolean) {
    if (!template) return;
    setTicking(v.id);
    const ids = on ? [...approved, v.id] : approved.filter((x) => x !== v.id);
    const r = await send("/api/settings", "PUT", { key: "category_templates", value: { ...templates, [category]: { ...template, approved_vendor_ids: ids } } }, "Couldn't change the approved list");
    setTicking(null);
    if (r) { toast(on ? `${v.name} approved for ${category} — the co-pilot suggests it from the next message.` : `${v.name} is no longer approved — the co-pilot marks it “not on the approved list”.`); router.refresh(); }
  }
  const [edit, setEdit] = useState<{ id: string | null; f: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? vendors.filter((v) => [v.name, v.email, v.city, v.contact_name, v.short_code].some((x) => x?.toLowerCase().includes(s))) : vendors;
  }, [vendors, q]);

  async function commit() {
    if (!edit) return;
    setBusy(true);
    const r = await send<{ changed?: string[] }>(edit.id ? `/api/vendors/${edit.id}` : "/api/vendors", edit.id ? "PATCH" : "POST", edit.f, edit.id ? "Couldn't save the vendor" : "Couldn't add the vendor");
    setBusy(false);
    if (!r) return;
    toast(edit.id ? (r.changed?.length ? `Saved — ${edit.f.name}. The next RFx email uses these details.` : "Nothing changed.") : `Added — ${edit.f.name}. Tick Approved for the co-pilot to suggest it.`);
    setEdit(null);
    router.refresh();
  }
  const open = (v: VendorRow) => setEdit({ id: v.id, f: { name: v.name, email: v.email, contact_name: v.contact_name ?? "", city: v.city ?? "", state: v.state ?? "", country: v.country ?? "IN", default_currency: v.default_currency ?? "INR", notes: v.notes ?? "" } });

  const form = edit && (() => {
    const f = edit.f, set = (p: Partial<Form>) => setEdit({ ...edit, f: { ...f, ...p } });
    const cur = f.default_currency.trim().toUpperCase();
    const input = (k: keyof Form, label: string, o: { w?: number; ph?: string; upper?: number } = {}) => (
      <label className="vd-f"><span>{label}</span>
        <input className={`inp${o.upper ? " mono" : ""}`} style={o.w ? { width: o.w } : undefined} value={f[k]} placeholder={o.ph} maxLength={o.upper}
          onChange={(e) => set({ [k]: o.upper ? e.target.value.toUpperCase() : e.target.value })} aria-label={label} />
      </label>
    );
    return (
      <div className="vd-form">
        {input("name", "Name", { ph: "Sunrise Packers Pvt Ltd" })}
        {input("email", "Email", { ph: "sales@example.in" })}
        {input("contact_name", "Contact person", { ph: "optional" })}
        {input("city", "City")}
        {input("state", "State")}
        {input("country", "Country", { w: 60, upper: 2 })}
        {input("default_currency", "Currency", { w: 70, upper: 3 })}
        <label className="vd-f vd-notes"><span>Notes</span><textarea className="inp" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" /></label>
        <div className="vd-actions">
          <span className="hint">{cur !== "INR" && /^[A-Z]{3}$/.test(cur) && !fxCurrencies.includes(cur) ? `No ${cur} rate in General → Currency: quotes in ${cur} stay unsure until one is added.` : "Currency is what the vendor usually quotes in; each quote's own currency is still read from the quote."}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button size="sm" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={commit}>{busy ? "Saving…" : edit.id ? "Save vendor" : "Add vendor"}</Button>
          </span>
        </div>
      </div>
    );
  })();

  return (
    <div className="card">
      <div className="hd">
        <div><b>Vendors</b><div className="hint" style={{ marginTop: 2 }}>Every supplier QuoteLens knows; RFx emails go to the email here. Ticked = approved for {category}: the co-pilot suggests only those, and marks any other invite &ldquo;not on the approved list&rdquo;.</div></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="inp" placeholder="Search name, email, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" style={{ width: 200 }} />
          {!edit?.id && !edit && <Button size="sm" onClick={() => setEdit({ id: null, f: EMPTY })}>Add vendor</Button>}
        </div>
      </div>
      {edit && !edit.id && <div className="bd" style={{ borderBottom: "1px solid var(--hair2)" }}>{form}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>Vendor</th><th>Code</th><th>Contact</th><th>Email</th><th>Location</th><th>Currency</th><th className="num">RFx</th><th>Approved</th><th /></tr></thead>
          <tbody>
            {rows.map((v) => (
              <Fragment key={v.id}>
                <tr>
                  <td><b style={{ fontWeight: 500 }}>{v.name}</b><div className="hint">{ORIGIN[v.created_by] ?? v.created_by} · {longDate(v.created_at.slice(0, 10))}</div></td>
                  <td className="mono xs">{v.short_code}</td>
                  <td>{v.contact_name ?? <span className="muted">—</span>}</td>
                  <td className="mono xs">{v.email}</td>
                  <td>{[v.city, v.state, v.country].filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                  <td className="mono xs">{v.default_currency ?? "INR"}</td>
                  <td className="num">{v.rfx_count}</td>
                  <td>{template
                    ? <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={approved.includes(v.id)} disabled={ticking !== null} aria-label={`Approved for ${category}: ${v.name}`} onChange={(e) => approve(v, e.target.checked)} />{ticking === v.id ? "Saving…" : approved.includes(v.id) ? "Approved" : ""}</label>
                    : <span className="hint">no masters yet</span>}</td>
                  <td><Button size="sm" variant="ghost" disabled={!!edit} onClick={() => open(v)}>Edit</Button></td>
                </tr>
                {edit?.id === v.id && <tr><td colSpan={9} style={{ background: "var(--tint)" }}>{form}</td></tr>}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">{vendors.length ? "No vendor matches that search." : "No vendors yet — add the first one."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bd hint" style={{ borderTop: "1px solid var(--hair2)" }}>The code is fixed once a vendor is made: reply tags and past RFx use it. Vendors on an RFx stay in the directory so its history keeps their name.</div>
    </div>
  );
}
