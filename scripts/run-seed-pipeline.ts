// npm run pipeline:seed [-- --set clean|realistic] [--rfx CODE] [--from STAGE]
// Loads the seeded responses (clean → MER-0419, realistic → MER-0417 by default), runs every stage, then the eval.
// --from map|normalise|… keeps the loaded responses and re-runs from that stage (for mapping/normalise iterations).
import { db } from "@/lib/db";
import { formatEval, runEval } from "@/lib/eval/run";
import { runAll } from "@/lib/pipeline/run";
import { loadSeedResponses } from "@/lib/responses";
import { STAGES, type Stage } from "@/types/db";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const set = (arg("set") ?? "clean") as "clean" | "realistic";
if (set !== "clean" && set !== "realistic") throw new Error("--set must be clean or realistic");
const code = arg("rfx") ?? (set === "clean" ? "MER-0419" : "MER-0417");
const from = (arg("from") ?? "classify") as Stage;
if (!STAGES.includes(from)) throw new Error(`--from must be one of ${STAGES.join(", ")}`);

const { data: rfx, error } = await db().from("rfx").select("id").eq("code", code).single();
if (error || !rfx) throw new Error(`RFx ${code} not found`);
const t0 = Date.now();

let ids: string[];
if (from === "classify") {
  console.log(`[seed-pipeline] loading ${set} seed responses into ${code}…`);
  ids = await loadSeedResponses(rfx.id, set, "system");
} else {
  const { data } = await db().from("responses").select("id").eq("rfx_id", rfx.id).eq("source", "seed");
  ids = (data ?? []).map((r) => r.id);
}
const { data: names } = await db().from("responses").select("id, vendors(short_code)").in("id", ids);
const nameOf = (id: string) => (names?.find((n) => n.id === id)?.vendors as unknown as { short_code: string } | null)?.short_code ?? id.slice(0, 8);

let failed = false;
await Promise.all(ids.map(async (id) => {
  const parts: string[] = [];
  for await (const ev of runAll(id, "system", from)) {
    parts.push(`${ev.stage} ${ev.status === "done" ? `${(ev.ms / 1000).toFixed(1)}s` : ev.status}`);
    if (ev.status === "error") { failed = true; parts.push(`ERROR: ${ev.error}`); }
  }
  console.log(`[seed-pipeline] ${nameOf(id).padEnd(11)} ${parts.join(" · ")}`);
}));
console.log(`[seed-pipeline] ${ids.length} responses in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

console.log(`Eval ${code} (${set} set)\n`);
console.log(formatEval(await runEval(rfx.id)));
if (failed) process.exitCode = 1;
