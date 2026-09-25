import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getComparison } from "@/lib/comparison";
import { getAward } from "@/lib/award";
import { allocate, baseline, discountText, totals } from "@/lib/scenarios/allocate";
import { loadInputs, withDiscounts } from "@/lib/scenarios";
import { countWord, inrShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DecideAsk } from "@/components/decide/decide-ask";

const UNSURE = ["low_confidence", "ambiguous", "references_prior", "conflict"];
const SUGGESTIONS = ["What does the cheapest-per-line split save versus awarding everything to the cheapest single vendor?",
  "Which lines have only one qualified quote?", "Which cells are you not sure about, and how much money rides on them?"];

// DESIGN §3.8 Decide — the approver's default tab, reworked on the human's review (DECISIONS 2026-09-25 "Decide for Priya"):
// is there something for me (status) → can I trust it (only when something is in doubt) → what it costs → Ask.
// Every number is computed: the split is the cheapest-qualified-per-line allocation (same engine as Ask Q1 and a saved
// option), the comparison is TRD §13.5's best single vendor (same as Q2).
export default async function DecidePage({ params }: PageProps<"/rfx/[id]/decide">) {
  const user = await requireUser();
  const { id } = await params;
  if (user.role !== "approver") redirect(`/rfx/${id}/overview`);
  const [grid, inp, award, { count: openCards }] = await Promise.all([getComparison(id), loadInputs(id), getAward(id),
    db().from("review_items").select("id", { count: "exact", head: true }).eq("rfx_id", id).in("status", ["open", "asked_vendor"])]);
  const q1 = totals(allocate(inp, { type: "cheapest_per_line", qualified_only: true, price_basis: "unit" }));
  const base = baseline(inp, "unit", true);
  const q1d = withDiscounts(inp, q1.share, q1.total);
  const held = grid.vendors.filter((v) => v.held !== null);
  const heldCodes = new Set(held.map((v) => v.code));
  const quoted = grid.vendors.filter((v) => v.priced > 0).length;
  const cleared = grid.vendors.filter((v) => v.cleared === true).length;
  // A held reply's cells are explained by its own notice, not counted again as "unsure prices".
  const unsure = grid.cells.filter((c) => UNSURE.includes(c.state) && !heldCodes.has(c.vendor)).length;
  const saving = base ? base.total - q1d.total_after : null;
  const baseName = base ? inp.vendors.find((v) => v.id === base.vendor_id)?.name : null;
  const memoTotal = award ? award.memo.totals.total_after ?? award.memo.totals.total : 0;

  const status = !award
    ? { text: <><b>Nothing to approve yet.</b> Sujit is still {openCards ? `reviewing (${openCards} item${openCards === 1 ? "" : "s"} open)` : "putting the award options together"}.</>, href: "comparison", label: "See the grid" }
    : award.status === "approved" ? { text: <><b>Approved.</b> The grid is locked and the memo is on file.</>, href: "award", label: "Read the memo" }
    : award.status === "sent_back" ? { text: <><b>You sent the memo back</b>{award.sent_back_note ? <> — “{award.sent_back_note}”</> : ""}. Waiting for Sujit&apos;s new draft.</>, href: "award", label: "Read the memo" }
    : award.stale ? { text: <><b>Sujit&apos;s memo is out of date:</b> {award.stale_reason === "prices" ? "prices changed" : "the option changed"} after it was drafted. Sujit needs to draft it again.</>, href: "award", label: "Read the memo" }
    : { text: <><b>Sujit&apos;s memo is waiting for you</b> · {award.memo.scenario.name} · {inrShort(memoTotal)} a year.</>, href: "award", label: "Read and approve", primary: true };

  return (
    <div className="page read">
      <div className="card"><div className="bd" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <p className="lead" style={{ flex: 1, minWidth: 260, margin: 0 }}>{status.text}</p>
        <Button asChild variant={status.primary ? "default" : undefined}><Link href={`/rfx/${id}/${status.href}`}>{status.label}</Link></Button>
      </div></div>

      {(held.length > 0 || unsure > 0) && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--amber)" }}>
          <div className="hd"><b>Before you approve</b></div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5 }}>
            {held.map((v) => (
              <div key={v.code}>
                <b>{v.name}&apos;s reply may be another vendor&apos;s file.</b> Its prices, questionnaire answers and discount are out of every total until Sujit confirms who sent it.
                <div className="small text-muted-foreground" style={{ fontSize: 12.5, marginTop: 2 }}>{v.held}</div>
              </div>
            ))}
            {unsure > 0 && <div>{countWord(unsure)} price{unsure === 1 ? " is" : "s are"} still unsure on Sujit&apos;s side; the totals below leave {unsure === 1 ? "it" : "them"} out.</div>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}><div className="bd">
        <div className="qgroups">
          <div className="stat">
            <div className="eyebrow">Cheapest qualified vendor per line</div>
            {q1.allocated > 0 ? <>
              <div className="v">{inrShort(q1d.total_after)}</div>
              <div className="l">a year{q1.allocated < q1.lines ? ` for ${q1.allocated} of ${q1.lines} lines` : ""}{q1d.total_after < q1.total - 0.5 ? ` · ${inrShort(q1.total)} as quoted, less the discounts it earns` : ""}</div>
            </> : <div className="l">No prices yet.</div>}
          </div>
          <div className="stat">
            <div className="eyebrow">Against the best single vendor</div>
            {base && saving !== null ? <>
              <div className="v">{Math.abs(saving / base.total * 100).toFixed(1)}%</div>
              <div className="l">{saving >= 0 ? "lower" : "higher"} · {inrShort(Math.abs(saving))} a year. {baseName} alone: {inrShort(base.total)}{base.discount?.met ? ` (${discountText({ ...base.discount, vendor: baseName ?? "" })})` : ""}{base.note ? ` — ${base.note}` : ""}</div>
            </> : <div className="l">No qualified vendor has priced lines yet.</div>}
          </div>
          <div className="stat">
            <div className="eyebrow">Coverage</div>
            <div className="v">{quoted} of {grid.vendors.length}</div>
            <div className="l">vendors with usable prices · {countWord(cleared).toLowerCase()} cleared the questionnaire · {grid.lines.length} lines</div>
          </div>
        </div>
      </div></div>

      <DecideAsk rfxId={id} suggestions={SUGGESTIONS} />
    </div>
  );
}
