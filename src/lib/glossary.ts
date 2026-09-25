// P11 #1 tier (b): what the analyst says when asked "what is landed cost?" and the like. Written from this app's own rules
// (the Help page, normalise, the allocation engine), so the explanation never disagrees with what the grid shows. Pure.

export type Term = { term: string; aliases: string[]; text: string; ask?: string };

export const GLOSSARY: Term[] = [
  { term: "landed cost", aliases: ["landed price", "landed", "delivered cost", "all-in cost"],
    text: "The unit price plus freight, per 1000 pieces. When a vendor's price includes freight, landed cost equals the unit price. When a vendor excludes freight and the buyer has entered a freight amount for it, that amount is added. When the amount isn't known, landed cost stays at the unit price and the grid says \"amount not stated\".",
    ask: "Which vendors' prices exclude freight, what did each say about freight, and is a freight amount known for it?" },
  { term: "unit price", aliases: ["price", "rate"],
    text: "The vendor's price converted to the RFx basis: INR per 1000 pieces, before freight. A price quoted per kg, per bundle or in another currency is converted, and every conversion step is shown in the cell's source view and the ledger." },
  { term: "per 1000 basis", aliases: ["per 1000 pieces", "per 1000 pcs", "per thousand"],
    text: "Every price in the comparison is INR per 1000 pieces, so vendors who quote per piece, per bundle, per box or per kg can be compared line by line. Annual value = price × annual quantity ÷ 1000." },
  { term: "annual value", aliases: ["annual spend", "yearly value"],
    text: "Price per 1000 pieces × the line's annual quantity ÷ 1000, in rupees per year. Totals add up annual values across lines." },
  { term: "cleared the questionnaire", aliases: ["qualified", "qualified vendor", "questionnaire", "disqualified"],
    text: "A vendor has cleared the questionnaire when none of its answers to the disqualifying questions trips the rule (for example \"No\" to a required certification). It fails when one does, or when a mandatory answer is missing. \"Not cleared yet\" means an answer is unclear, or its reply is on hold, and waits for a decision on the Review tab.",
    ask: "Which vendors cleared the questionnaire, and why did the others not?" },
  { term: "unsure cell", aliases: ["unsure", "low confidence", "low-confidence", "ambiguous", "conflict", "references prior", "prior pricing", "same as last year"],
    text: "A price the system can't count yet. Four kinds: low-confidence (the reading may be wrong, e.g. a blurred photo), ambiguous (the unit or pack size isn't clear), refers to earlier pricing (\"same as last year\" with no figure), and conflict (two replies from the vendor disagree). Unsure cells are left out of totals until someone decides them on the Review tab.",
    ask: "Which cells are you not sure about, and how much money rides on them?" },
  { term: "best guess", aliases: ["best guesses", "include best guesses"],
    text: "For an ambiguous or low-confidence cell, the system's most likely price. It is never counted by default; \"Include best guesses\" shows an answer with and without them side by side." },
  { term: "value at stake", aliases: ["money at stake", "at stake"],
    text: "What the unsure cells are worth at the system's best guess: best-guess price × annual quantity ÷ 1000, added up. It shows how much of the decision still depends on cells nobody has checked." },
  { term: "single-source line", aliases: ["single source", "single-source", "only one quote"],
    text: "A line where only one eligible vendor has a usable price, so there is no competing quote to compare it with. A supply and negotiation risk.",
    ask: "Which lines have only one qualified quote?" },
  { term: "conditional discount", aliases: ["discount", "total discount", "total-level discount"],
    text: "A discount a vendor offers on its whole quote with a condition, e.g. \"3% if all 30 items are awarded\". Prices in the grid and in Ask stay as quoted; each award option on the Award tab checks the condition against what that vendor wins and applies the discount only when it is met." },
  { term: "validity", aliases: ["quote validity", "valid until", "expiry"],
    text: "How long a vendor's prices hold, from its reply. The Award tab warns when a winning vendor's quote has expired or expires within 14 days." },
  { term: "scenario", aliases: ["award option", "split"],
    text: "One way to award the lines: which vendor gets each line, its price and the total. Saved from an Ask answer or built by a rule (cheapest per line, grouped by ply or plant); lines can be moved to another vendor with a reason. Scenarios are compared on the Award tab." },
  { term: "award memo", aliases: ["memo", "approval"],
    text: "The document the approver signs off: the recommended scenario, the allocation, exclusions, open assumptions and the review ledger. The buyer drafts it; only the approver can approve it, which locks the RFx." },
  { term: "assumption ledger", aliases: ["ledger", "assumptions"],
    text: "Every number the system filled in or converted — FX rate, pack size, weight per piece, freight, discount treatment — with where it came from (vendor stated, RFx spec, settings, buyer entered, system inferred)." },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The entry for a term (by name or alias, then by containment), or null. */
export function lookupTerm(q: string): Term | null {
  const n = norm(q);
  if (!n) return null;
  const exact = GLOSSARY.find((t) => norm(t.term) === n || t.aliases.some((a) => norm(a) === n));
  if (exact) return exact;
  const hits = GLOSSARY.filter((t) => [t.term, ...t.aliases].some((a) => n.includes(norm(a)) || norm(a).includes(n)));
  return hits.sort((a, b) => b.term.length - a.term.length)[0] ?? null;
}
