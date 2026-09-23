// npm run eval [-- --rfx MER-0419]  — TRD §18 against the current state of the RFx; writes eval_runs.
import { db } from "@/lib/db";
import { formatEval, runEval } from "@/lib/eval/run";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const code = arg("rfx") ?? "MER-0419";
const { data: rfx, error } = await db().from("rfx").select("id").eq("code", code).single();
if (error || !rfx) throw new Error(`RFx ${code} not found`);
console.log(`Eval ${code}\n`);
console.log(formatEval(await runEval(rfx.id)));
