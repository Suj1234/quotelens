import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getComparison } from "@/lib/comparison";
import { allocate, baseline, totals } from "@/lib/scenarios/allocate";
import { loadInputs } from "@/lib/scenarios";
import { countWord, inrShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DecideAsk } from "@/components/decide/decide-ask";

const UNSURE = ["low_confidence", "ambiguous", "references_prior", "conflict"];

// DESIGN §3.8 Decide — the approver's default tab (built in P7 per the handoff; DECISIONS P7). Every number is computed:
// the headline is the cheapest-qualified-per-line allocation (same engine and total as Ask Q1 and a saved scenario),
// the card is TRD §13.5's best single vendor (same as Q2).
export default async function DecidePage({ params }: PageProps<"/rfx/[id]/decide">) {
  const user = await requireUser();
  const { id } = await params;
  if (user.role !== "approver") redirect(`/rfx/${id}/overview`);
  const [grid, inp, { data: award }] = await Promise.all([getComparison(id), loadInputs(id), db().from("awards").select("status").eq("rfx_id", id).maybeSingle()]);
  const q1 = totals(allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" }));
  const base = baseline(inp, "unit", true);
  const quoted = grid.vendors.filter((v) => v.priced > 0).length;
  const cleared = grid.vendors.filter((v) => v.cleared === true).length;
  const unsure = grid.cells.filter((c) => UNSURE.includes(c.state)).length;
  const saving = base ? base.total - q1.total : null;
  const baseName = base ? inp.vendors.find((v) => v.id === base.vendor_id)?.name : null;
  const fx = grid.vendors.find((v) => v.currency && v.currency !== "INR");
  const perKg = (await db().from("assumptions").select("vendors(name)").eq("rfx_id", id).eq("kind", "weight_per_piece").is("superseded_by", null).limit(1)).data?.[0];
  const perKgName = (perKg?.vendors as unknown as { name: string } | null)?.name;
  const maxPly = Math.max(0, ...inp.lines.map((l) => l.ply ?? 0));
  // Suggestions per DESIGN §3.8; vendor names come from the data (the currency and per-kg vendors), never fixed copy.
  const groups: [string, string[]][] = [
    ["Cost", ["Cheapest vendor per line, only among vendors who cleared the questionnaire", "What does that save versus awarding everything to the cheapest single vendor?",
      "Show landed cost instead of unit price — does the ranking change?", "Split 5-ply to the cheapest qualified and 3-ply to whoever is cheapest overall — better or worse than the first answer?"]],
    ["Risk", ["Which lines have only one qualified quote?", "Which cells are you not sure about, and how much money rides on them?",
      ...(fx ? [`What did ${fx.name}'s ${fx.currency} conversion assume, and what if the rupee moves 3%?`] : []), "Who has the shortest validity?"]],
    ["Vendors", [...(perKgName && maxPly ? [`Why is the ${maxPly}-ply from ${perKgName} so cheap?`] : []), "Who didn't quote line 22?", "Export the first answer as Excel"]],
  ];
  return (
    <div className="page">
      <div className="brief">
        <div>
          <p className="lead">
            {quoted ? <>{countWord(quoted)} vendor{quoted === 1 ? "" : "s"} quoted the {grid.lines.length} lines. {countWord(cleared)} cleared the questionnaire. </> : <>No prices yet. </>}
            {q1.allocated > 0 && <>Awarding each line to the <b>cheapest qualified vendor</b> comes to <b>{inrShort(q1.total)}</b> a year{q1.allocated < q1.lines ? ` for ${q1.allocated} of ${q1.lines} lines` : ""}. </>}
            {unsure > 0 && <>{unsure} cells are still unresolved on Sujit&apos;s side; totals exclude them and say so.</>}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Button asChild><Link href={`/rfx/${id}/comparison`}>See the grid</Link></Button>
            <Button asChild><Link href={`/rfx/${id}/award`}>{award ? "Read the memo" : "Award"}</Link></Button>
          </div>
        </div>
        <div className="card"><div className="bd">
          <div className="eyebrow">Against the best single vendor</div>
          {base && saving !== null ? <>
            <div className="delta" style={{ marginTop: 6 }}>{Math.abs(saving / base.total * 100).toFixed(1)}%<small> {saving >= 0 ? "lower" : "higher"} · {inrShort(Math.abs(saving))} a year</small></div>
            <div className="small text-muted-foreground" style={{ marginTop: 8, fontSize: 12.5 }}>Best single vendor: {baseName} at {inrShort(base.total)}{base.note ? ` — ${base.note}` : "."}</div>
          </> : <div className="small text-muted-foreground" style={{ marginTop: 8, fontSize: 12.5 }}>No qualified vendor has priced lines yet.</div>}
        </div></div>
      </div>
      <DecideAsk rfxId={id} groups={groups} />
    </div>
  );
}
