// The questions offered above the Ask box (the human's review, 25 Sep 2026): question types written once, each shown only when
// this RFx's data makes it worth asking, with the names filled in from that data. Nothing here names a vendor or a currency.
// Pure (suggest.test.ts); the facts are loaded by rfxSuggestions() in ask.ts.

export type RfxFacts = {
  vendors: { name: string; cleared: boolean | null; status: string; lines_priced: number; lines_total: number; freight_included: boolean | null; currency: string | null; discount_pct: number | null }[];
  unsure_cells: number;
  scenarios: number;
};

const own = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`); // "Anand Box Works'", "Westline's"

/** Every question worth asking on this RFx, most useful first. The Ask box shows the first 3 not yet asked. */
export function suggestQuestions(f: RfxFacts): string[] {
  const replied = f.vendors.filter((v) => v.status !== "invited");
  const failed = replied.filter((v) => v.cleared === false);
  const pending = replied.filter((v) => v.cleared === null);
  const currencies = [...new Set(replied.map((v) => v.currency).filter((c): c is string => !!c && c !== "INR"))];
  const partial = replied.filter((v) => v.lines_priced > 0 && v.lines_priced < v.lines_total);
  const anyCleared = replied.some((v) => v.cleared === true);
  const q: (string | false)[] = [
    anyCleared ? "Cheapest vendor per line, only among vendors who cleared the questionnaire" : "Cheapest vendor per line",
    f.unsure_cells > 0 && "Which cells are you not sure about, and how much money rides on them?",
    "What does the cheapest-per-line split save versus awarding everything to the cheapest single vendor?",
    ...failed.slice(0, 2).map((v) => `Why did ${v.name} fail the questionnaire?`),
    ...currencies.map((c) => `What if ${c} moves 3% against the rupee?`),
    f.vendors.some((v) => v.status === "invited") && "Which vendors haven't replied yet?",
    ...pending.slice(0, 1).map((v) => `What is still open on ${own(v.name)} questionnaire?`),
    replied.some((v) => v.freight_included === false) && "Which vendors exclude freight, and does landed cost change the cheapest vendor?",
    f.scenarios >= 2 && "Compare the saved scenarios",
    ...partial.slice(0, 1).map((v) => `Which lines didn't ${v.name} quote?`),
    replied.some((v) => (v.discount_pct ?? 0) > 0) && "Which vendors offer a discount, and on what condition?",
    anyCleared && "Which lines have only one qualified quote?",
    "Where is the biggest price gap between the cheapest and the second-cheapest vendor?",
    "Which vendor's quote expires first?",
    "Compare every vendor's unit price on the first 5 lines",
  ];
  return [...new Set(q.filter((x): x is string => !!x))];
}
