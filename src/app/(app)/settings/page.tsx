import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { evalEligible, latestEval } from "@/lib/eval/run";
import { listModelCalls, recentSettingChanges } from "@/lib/model-calls";
import { getAllSettings } from "@/lib/settings";
import { describeChange } from "@/lib/settings-schema";
import { SettingsCards } from "@/components/settings/settings-cards";
import { EvalSection } from "@/components/settings/eval-section";
import { ModelCalls } from "@/components/settings/model-calls";

// DESIGN §3.10: one page behind the rail's gear — settings cards, then Eval (TRD §17.14) and Model calls (TRD §17.15).
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireUser(["buyer", "admin"]); // approver → /rfx (DESIGN §4)
  const want = (await searchParams).eval;
  const [settings, changes, eligible, calls, rfx, vendors] = await Promise.all([
    getAllSettings(), recentSettingChanges(), evalEligible(), listModelCalls(),
    db().from("rfx").select("id, code").order("code"), db().from("vendors").select("short_code, name"),
  ]);
  const selected = eligible.find((e) => e.id === want) ?? eligible.find((e) => e.code === "MER-0419") ?? eligible[0] ?? null;
  const last = selected ? await latestEval(selected.id) : null;
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="text-muted-foreground" style={{ marginTop: 4 }}>Transport, decision layer, rates and the two pages that check the system on itself.</p>
      <SettingsCards settings={settings} jevKey={!!process.env.OPENROUTER_API_KEY}
        changes={changes.map((c) => ({ id: c.id, created_at: c.created_at, actor_name: c.actor_name, text: describeChange(c.payload.key, c.payload.before, c.payload.after) }))} />
      <EvalSection eligible={eligible} selected={selected} last={last} vendors={Object.fromEntries((vendors.data ?? []).map((v) => [v.short_code, v.name]))} />
      <ModelCalls initial={calls} rfx={rfx.data ?? []} />
    </div>
  );
}
