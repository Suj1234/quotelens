"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Unmatched sender → existing vendor or a new one; the pipeline then prices the reply (TRD §16 assign-vendor). */
export function AssignVendor({ responseId, vendors }: { responseId: string; vendors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState(""); const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = pick === "new";
  const submit = async () => {
    setBusy(true);
    const r = await fetch(`/api/responses/${responseId}/assign-vendor`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(isNew ? { new_vendor: { name, email } } : { vendor_id: pick }),
    }).catch(() => null);
    setBusy(false);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) return toast.error(`${j?.error ?? "Couldn't assign the vendor."}${j?.code ? ` (${j.code})` : ""}`);
    toast.success("Assigned — the reply is priced and in the grid");
    router.refresh();
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select className="sel" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Vendor">
        <option value="">Assign to…</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        <option value="new">New vendor…</option>
      </select>
      {isNew && <><input className="inp" placeholder="Vendor name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Vendor name" /><input className="inp" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Vendor email" /></>}
      <Button size="sm" variant="default" disabled={busy || !pick || (isNew && (!name.trim() || !email.trim()))} onClick={submit}>{busy ? "Pricing…" : "Assign"}</Button>
    </span>
  );
}
