// Re-read every reply of an RFx from the extract stage on, so stored prices and cards follow the current rules (P10 T0:
// Balaji's cells were stored 3% off under the old "net" setting; freight carried the removed ₹180 default).
// Buyer decisions survive: decided cards are never re-opened, reviewed / excluded cells are never overwritten.
// Awarded RFx are skipped (the approved memo is on file). Two replies at a time.
// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/reprocess.ts MER-0419 MER-0422
import { db } from "@/lib/db";
import { runAll } from "@/lib/pipeline/run";

const codes = process.argv.slice(2);
if (!codes.length) { console.error("Name the RFx codes, e.g. MER-0419 MER-0422"); process.exit(1); }
for (const code of codes) {
  const { data: rfx } = await db().from("rfx").select("id, status").eq("code", code).maybeSingle();
  if (!rfx) { console.log(`${code}: not found`); continue; }
  if (rfx.status === "awarded") { console.log(`${code}: awarded — left as approved`); continue; }
  const { data: resps } = await db().from("responses").select("id, vendor_id, is_clarification, vendors(name)").eq("rfx_id", rfx.id).order("received_at");
  // Main replies first, clarification replies after (they answer questions about the main reply's lines).
  const queue = [...(resps ?? [])].sort((a, b) => Number(a.is_clarification) - Number(b.is_clarification));
  console.log(`${code}: ${queue.length} replies`);
  const run = async (r: (typeof queue)[number]) => {
    const errs: string[] = [];
    for await (const ev of runAll(r.id, "system", "extract")) if (ev.status === "error") errs.push(`${ev.stage}: ${ev.error?.slice(0, 90)}`);
    console.log(`  ${(r.vendors as unknown as { name: string } | null)?.name ?? "unassigned"}${r.is_clarification ? " (clarification)" : ""}: ${errs.length ? `stopped — ${errs.join("; ")}` : "ok"}`);
  };
  const mains = queue.filter((r) => !r.is_clarification);
  for (let i = 0; i < mains.length; i += 2) await Promise.all(mains.slice(i, i + 2).map(run));
  for (const r of queue.filter((x) => x.is_clarification)) await run(r);
}
