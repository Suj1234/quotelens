"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import s from "@/app/signin.module.css";

const DEMO = [
  { initials: "SM", name: "Sujit Menon", role: "Category Buyer — runs the event", email: "sujit.menon@meridianfoods.example" },
  { initials: "PR", name: "Priya Raghavan", role: "VP Procurement — asks and approves", email: "priya.raghavan@meridianfoods.example" },
];

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pw = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (res?.ok) return router.replace("/rfx");
    setError((await res?.json().catch(() => null))?.error ?? "Couldn't reach the server. Try again.");
    setBusy(false);
  }

  return (
    <form className={s.fwrap} onSubmit={submit}>
      <h2 style={{ fontSize: 20 }}>Sign in</h2>
      <p className="text-xs text-muted-foreground" style={{ marginTop: 4, fontSize: 12 }}>Use your Meridian Foods work email.</p>
      <div style={{ marginTop: 22 }}>
        <label htmlFor="em">Work email</label>
        <Input id="em" type="email" placeholder="you@meridianfoods.in" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="pw">Password</label>
        <Input id="pw" ref={pw} type="password" placeholder="••••••••" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" variant="default" size="lg" className="w-full" style={{ marginTop: 16 }} disabled={busy}>Continue</Button>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.demo}>
        <div className="eyebrow">Demo accounts</div>
        {DEMO.map((u) => (
          <button key={u.email} type="button" onClick={() => { setEmail(u.email); pw.current?.focus(); }}>
            <span className="avatar">{u.initials}</span>
            <span><b>{u.name}</b><br /><span className="text-muted-foreground" style={{ fontSize: 12 }}>{u.role}</span></span>
          </button>
        ))}
      </div>
    </form>
  );
}
