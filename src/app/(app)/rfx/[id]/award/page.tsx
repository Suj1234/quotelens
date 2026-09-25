import { requireUser } from "@/lib/auth";
import { getRfx } from "@/lib/rfx-detail";
import { getAward } from "@/lib/award";
import { listScenarios, loadInputs, overrideOptions } from "@/lib/scenarios";
import { AwardScreen } from "@/components/award/award-screen";

// DESIGN §3.9 Award (both roles); scenarios live here too (DECISIONS P7 — DESIGN has no Scenarios tab).
export default async function AwardPage({ params }: PageProps<"/rfx/[id]/award">) {
  const user = await requireUser();
  const { id } = await params;
  const [rfx, scenarios, award, inp] = await Promise.all([getRfx(id), listScenarios(id), getAward(id), loadInputs(id)]);
  const uniq = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))].sort();
  return (
    <AwardScreen rfxId={id} code={rfx.code} buyer={user.role !== "approver"} me={user.id} locked={rfx.status === "awarded"} scenarios={scenarios} award={award}
      options={Object.fromEntries(scenarios.map((s) => [s.id, overrideOptions(inp, s)]))}
      groupValues={{ ply: uniq(inp.lines.map((l) => l.ply)).sort((a, b) => a - b), item_type: uniq(inp.lines.map((l) => l.item_type)), delivery_location: uniq(inp.lines.map((l) => l.delivery_location)) }} />
  );
}
