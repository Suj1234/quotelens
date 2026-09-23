import "server-only";
import { bool, choice, decide, type DecisionResult, type Question } from "@/lib/ai/decision";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { ResponseRow, RfxLine } from "@/types/db";
import { itemRange, shortlist, type ItemLike } from "./shortlist";
import { clearStageReviews, insertReviews, type ReviewInput } from "./reviews";

const BATCH = 10; // items per decide() call (CLAUDE.md P2-T3)
const NONE = "none_of_these";

export type ExtractedItem = ItemLike & {
  id: string; item_index: number; file_id: string | null; unit_price: number | null; price_unit_raw: string | null;
  currency_raw: string | null; pack_size: number | null; pack_size_unit: string | null; discount_pct: number | null;
  notes: string | null; raw_confidence: number | null; location: Record<string, unknown> & { snippet?: string };
};
export type MapEntry = {
  item_id: string; line_id: string; line_no: number; p: number; provider: string;
  alternatives: { line_no: number; p: number }[]; range?: [number, number];
  conflict_with?: string; // set on the losing item when two items claim one line (TRD §8.3)
};
export type MapSummary = { items: number; mapped: number; needs_look: number; unmatched: number; conflicts: number; provider: string | null; mapping: MapEntry[] };

/** TRD §8.3 — extracted items → RFx lines. Stores the mapping in responses.summary.map; unmatched → unmatched_items. */
export async function map(resp: ResponseRow): Promise<MapSummary> {
  const [{ data: items, error: ie }, { data: lines, error: le }, th] = await Promise.all([
    db().from("extracted_items").select("*").eq("response_id", resp.id).order("item_index"),
    db().from("rfx_lines").select("*").eq("rfx_id", resp.rfx_id).order("line_no"),
    getSetting("thresholds"),
  ]);
  if (ie || le) throw ie ?? le;
  const all = items as ExtractedItem[];
  const L = lines as RfxLine[];
  const byNo = new Map(L.map((l) => [l.line_no, l]));

  await clearStageReviews(resp.id, "map");
  const { error: ue } = await db().from("unmatched_items").delete().eq("response_id", resp.id);
  if (ue) throw ue;

  const render = (l: RfxLine) => `L${l.line_no}: ${l.sku} ${l.description}${l.burst_factor ? ` BF${l.burst_factor}` : ""}`;
  const describe = (it: ExtractedItem) => [
    it.vendor_description, it.vendor_sku && `sku ${it.vendor_sku}`,
    it.unit_price !== null && `price ${it.unit_price} ${it.price_unit_raw ?? ""}`.trim(),
    it.pack_size && `pack ${it.pack_size} ${it.pack_size_unit ?? ""}`.trim(),
    it.location.snippet && `source: "${String(it.location.snippet).slice(0, 180)}"`,
  ].filter(Boolean).join(" | ");

  type Job = { it: ExtractedItem; key: string; q: Question; opts?: { line_no: number; label: string }[]; range?: [number, number] };
  const jobs: Job[] = all.map((it) => {
    const range = itemRange(it, L.length);
    if (range) {
      const inRange = L.filter((l) => l.line_no >= range[0] && l.line_no <= range[1]);
      return {
        it, key: `r${it.item_index}`, range,
        q: { type: "boolean", statement: `ITEM r${it.item_index} is the supplier's offer for every one of these RFx lines: ${inRange.map((l) => `L${l.line_no} ${l.description}`).join("; ")}.` },
      };
    }
    const opts = shortlist(it, L).map((c) => ({ line_no: c.line_no, label: render(byNo.get(c.line_no)!) }));
    return {
      it, key: `i${it.item_index}`, opts,
      q: {
        type: "choice", options: [...opts.map((o) => o.label), NONE],
        instruction: `Which RFx line is ITEM i${it.item_index} the supplier's price for? Match on size (within 5%), ply and item type; item numbers the supplier cites refer to the RFx line numbers. Answer ${NONE} if no line fits.`,
      },
    };
  });

  // Batches of 10 in parallel; the state lists the batch plus one neighbour on each side for context (TRD §8.3).
  const batches: Job[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH) batches.push(jobs.slice(i, i + BATCH));
  const results = await Promise.all(batches.map((b, bi) => {
    const before = jobs[bi * BATCH - 1], after = jobs[bi * BATCH + b.length];
    const state = [
      "Supplier quotation items (as written by the supplier):",
      ...(before ? [`(previous item) ${describe(before.it)}`] : []),
      ...b.map((j) => `ITEM ${j.key}: ${describe(j.it)}`),
      ...(after ? [`(next item) ${describe(after.it)}`] : []),
    ].join("\n");
    return decide(state, Object.fromEntries(b.map((j) => [j.key, j.q])), { purpose: "map", rfx_id: resp.rfx_id, response_id: resp.id });
  }));
  const answerOf = new Map<string, DecisionResult>();
  batches.forEach((b, i) => b.forEach((j) => answerOf.set(j.key, results[i])));

  const mapping: MapEntry[] = [];
  const reviews: ReviewInput[] = [];
  const unmatched: { extracted_item_id: string; best_candidate_line_id: string | null; best_candidate_probability: number }[] = [];
  const base = (it: ExtractedItem) => ({ extracted_item_id: it.id, evidence: { file_id: it.file_id, location: it.location, snippet: it.location.snippet ?? null } });

  for (const j of jobs) {
    const r = answerOf.get(j.key)!;
    if (j.range) {
      const p = round(bool(r, j.key));
      const inRange = L.filter((l) => l.line_no >= j.range![0] && l.line_no <= j.range![1]);
      if (p >= th.review) {
        for (const l of inRange) mapping.push({ item_id: j.it.id, line_id: l.id, line_no: l.line_no, p, provider: r.provider, alternatives: [], range: j.range });
        if (p < th.act) reviews.push({ ...base(j.it), type: "low_confidence_read", title: `Mapping needs a look: "${j.it.vendor_description}" → lines ${j.range[0]}–${j.range[1]}`, proposed_state: "mapped", probability: p });
      } else {
        unmatched.push({ extracted_item_id: j.it.id, best_candidate_line_id: inRange[0]?.id ?? null, best_candidate_probability: p });
        reviews.push({ ...base(j.it), type: "unmapped_item", title: `Couldn't place "${j.it.vendor_description}"`, detail: `It names lines ${j.range[0]}–${j.range[1]}, but that reading scored p=${p}.`, probability: p });
      }
      continue;
    }
    const c = choice(r, j.key);
    const alts = j.opts!.map((o) => ({ line_no: o.line_no, p: round(c.probabilities[o.label] ?? 0) })).sort((a, b) => b.p - a.p);
    const top = j.opts!.find((o) => o.label === c.answer);
    const p = round(c.probabilities[c.answer] ?? 0);
    if (top && p >= th.review) {
      const line = byNo.get(top.line_no)!;
      mapping.push({ item_id: j.it.id, line_id: line.id, line_no: line.line_no, p, provider: r.provider, alternatives: alts.filter((a) => a.line_no !== line.line_no) });
      if (p < th.act) reviews.push({ ...base(j.it), rfx_line_id: line.id, type: "low_confidence_read", title: `Mapping needs a look: "${j.it.vendor_description}" → line ${line.line_no}`, proposed_state: "mapped", probability: p });
    } else {
      const best = alts[0];
      unmatched.push({ extracted_item_id: j.it.id, best_candidate_line_id: best ? byNo.get(best.line_no)!.id : null, best_candidate_probability: best?.p ?? 0 });
      reviews.push({
        ...base(j.it), type: "unmapped_item", title: `Couldn't place "${j.it.vendor_description}"`,
        detail: best ? `Closest line ${best.line_no} (p=${best.p}); ${top ? "below the review threshold" : "the model chose none of these"}.` : "No candidate lines.",
        probability: best?.p ?? 0,
      });
    }
  }

  // Conflict rule (TRD §8.3): two items on one line with p ≥ review → keep the higher, flag the other.
  const byLine = new Map<string, MapEntry[]>();
  for (const m of mapping) byLine.set(m.line_id, [...(byLine.get(m.line_id) ?? []), m]);
  let conflicts = 0;
  for (const [lineId, ms] of byLine) {
    if (ms.length < 2) continue;
    ms.sort((a, b) => b.p - a.p || (a.range ? 1 : 0) - (b.range ? 1 : 0)); // explicit item beats a range at equal p
    for (const loser of ms.slice(1)) {
      loser.conflict_with = ms[0].item_id;
      conflicts++;
      const it = all.find((i) => i.id === loser.item_id)!;
      reviews.push({ ...base(it), rfx_line_id: lineId, type: "conflict", title: `Two prices for line ${loser.line_no}`, detail: `"${it.vendor_description}" (p=${loser.p}) and another item (p=${ms[0].p}) both map here.`, probability: loser.p });
    }
  }

  if (unmatched.length) {
    const { error } = await db().from("unmatched_items").insert(unmatched.map((u) => ({ ...u, rfx_id: resp.rfx_id, response_id: resp.id })));
    if (error) throw error;
  }
  await insertReviews(resp, "map", reviews);

  const mappedItems = new Set(mapping.filter((m) => !m.conflict_with).map((m) => m.item_id));
  return {
    items: all.length, mapped: mappedItems.size, needs_look: reviews.filter((r) => r.type === "low_confidence_read").length,
    unmatched: unmatched.length, conflicts, provider: results[0]?.provider ?? null, mapping,
  };
}

const round = (p: number) => Math.round(p * 1000) / 1000;
