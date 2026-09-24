// TRD §8.3 candidate shortlist: cheap, deterministic, no model. Pure so it is unit-testable.
import type { RfxLine } from "@/types/db";

export type ItemLike = { vendor_sku: string | null; vendor_description: string; notes?: string | null; location: { snippet?: string } | null };
export type Candidate = { line_no: number; score: number; why: string[] };

const DIMS = /(\d{2,4})\s*(?:mm)?\s*[x×*]\s*(\d{2,4})(?:\s*(?:mm)?\s*[x×*]\s*(\d{2,4}))?/gi;
const PLY = /(\d)\s*-?\s*ply\b|\bply\s*(?:\/\s*bf)?\s*[:=]?\s*(\d)\b/i;
const REFS = /\b(?:items?|sr\.?\s*no\.?|s\.?\s*no\.?|line|sl\.?\s*no\.?)\s*#?\s*(\d{1,3}(?:\s*(?:,|&|and)\s*\d{1,3})*)/gi;
const RANGE = /\b(?:items?|lines?|sr\.?\s*no\.?)\s*#?\s*(\d{1,3})\s*(?:to|-|–|—|through|till)\s*(\d{1,3})\b/i;
const TYPE_WORDS: Record<string, RegExp> = {
  box: /\b(carton|box(es)?|rsc|shipper)\b/i,
  sheet: /\b(sheets?|pads?|layer)\b/i,
  partition: /\b(partitions?|cell)\b/i,
};

const text = (it: ItemLike) => `${it.vendor_description} ${it.vendor_sku ?? ""}`;

/** "items 1 to 12" → [1, 12]. Read from the description first, then the snippet. */
export function itemRange(it: ItemLike, lineCount: number): [number, number] | null {
  for (const t of [text(it), it.location?.snippet ?? ""]) {
    const m = t.match(RANGE);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a >= 1 && b > a && b <= lineCount) return [a, b];
    }
  }
  return null;
}

/** Item numbers the vendor cites ("item 9", "items 5 and 9", "S.No 3"). */
export function refs(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(REFS)) out.push(...m[1].split(/\s*(?:,|&|and)\s*/).map(Number));
  return out;
}

function dims(t: string): number[][] {
  return [...t.matchAll(DIMS)].map((m) => [m[1], m[2], m[3]].filter(Boolean).map(Number));
}
const near = (a: number, b: number) => Math.abs(a - b) <= 0.05 * b;
function dimsMatch(d: number[], l: RfxLine) {
  const want = [l.length_mm, l.width_mm, l.height_mm].filter((x): x is number => !!x);
  return d.length === want.length && d.every((x, i) => near(x, want[i]));
}
const tokens = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Score every RFx line for one vendor item; top `k` returned, best first.
 * Weights: dims ±5% +0.4 · ply ±0.25 · item type ±0.2 · Jaccard ×0.3 · our SKU +0.5 · "item N" +0.5 · bare S.No +0.15.
 */
export function shortlist(it: ItemLike, lines: RfxLine[], k = 5): Candidate[] {
  const own = text(it);
  // The extractor's notes often carry the labelled columns ("Size: 1200x800 mm, Ply: 5, B.F.: 32") that a bare spreadsheet row
  // ("E36=1200x800 F36=5 G36=32") gives without labels — read them with the snippet (P8: realistic Balaji sheets 23–25).
  const snippet = [it.location?.snippet, it.notes].filter(Boolean).join(" ");
  const all = `${own} ${snippet}`;
  const found = dims(all);
  const plyM = own.match(PLY) ?? snippet.match(PLY);
  const ply = plyM ? Number(plyM[1] ?? plyM[2]) : null;
  const types = Object.entries(TYPE_WORDS).filter(([, re]) => re.test(all)).map(([t]) => t);
  const toks = tokens(all);

  // Item numbers: the item's own text wins; a bare number ("9") counts if the snippet cites it, else it is a weak S.No prior.
  const ownRefs = refs(own);
  const bare = [it.vendor_description, it.vendor_sku ?? ""].map((s) => s.trim().match(/^#?(\d{1,3})$/)?.[1]).find(Boolean);
  const snipRefs = refs(snippet);
  const boost = new Map<number, number>();
  if (ownRefs.length) ownRefs.forEach((n) => boost.set(n, 0.5));
  else if (bare) boost.set(+bare, snipRefs.includes(+bare) ? 0.5 : 0.15);
  else snipRefs.forEach((n) => boost.set(n, snipRefs.length === 1 ? 0.5 : 0.25));

  return lines.map((l) => {
    let score = 0;
    const why: string[] = [];
    if (found.some((d) => dimsMatch(d, l))) { score += 0.4; why.push("size"); }
    if (ply !== null && l.ply !== null) {
      if (ply === l.ply) { score += 0.25; why.push("ply"); } else score -= 0.25;
    }
    if (l.item_type && types.length) {
      if (types.includes(l.item_type)) { score += 0.2; why.push("type"); } else score -= 0.2;
    }
    const j = jaccard(toks, tokens(l.description));
    score += 0.3 * j;
    const sku = (it.vendor_sku ?? "").toLowerCase();
    if (sku.length >= 4 && (sku.includes(l.sku.toLowerCase()) || l.sku.toLowerCase().includes(sku))) { score += 0.5; why.push("sku"); }
    const b = boost.get(l.line_no);
    if (b) { score += b; why.push(b >= 0.5 ? "item no." : "row no."); }
    return { line_no: l.line_no, score: Math.round(score * 1000) / 1000, why };
  }).sort((a, b) => b.score - a.score || a.line_no - b.line_no).slice(0, k);
}
