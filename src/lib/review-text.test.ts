import { describe, expect, it } from "vitest";
import { plain, short, sourceLabel } from "./review-text";
import { actionsFor, buttonsFor, conflictOf, ifNothing } from "./review";

describe("review card wording", () => {
  it("strips the preprocessors' markers", () => {
    expect(plain("[l 8] sheets, layer pad (item 23 to 30) rest same as last year")).toBe("sheets, layer pad (item 23 to 30) rest same as last year");
    expect(plain("[row 18] A18=4 B18=Corrugated Box 5 ply H18=13,710/-")).toBe("4 · Corrugated Box 5 ply · 13,710/-");
    expect(plain("H18=13,710/-")).toBe("13,710/-");
  });
  it("names the source the way a buyer says it", () => {
    expect(sourceLabel("email body · line 8")).toBe("From the email, line 8");
    expect(sourceLabel("Terms read from the email body")).toBe("From the email");
    expect(sourceLabel("KC_Quotation.pdf · page 2")).toBe("From KC_Quotation.pdf, page 2");
    expect(sourceLabel("Questionnaire answer")).toBe("From the questionnaire answer");
    expect(sourceLabel("Settings → FX rates")).toBe("Settings → FX rates");
  });
  it("shortens vendor names for buttons without cutting them to one word", () => {
    expect(short("Kohinoor Corrugators Pvt Ltd")).toBe("Kohinoor Corrugators");
    expect(short("Sri Balaji Packaging")).toBe("Sri Balaji Packaging");
    expect(short("OrientPack Ltd")).toBe("OrientPack");
  });
});

describe("review card actions", () => {
  const row = (type: string, proposed_value: number | null = null, proposed_state: string | null = null, evidence: Record<string, unknown> = {}) => ({ type, proposed_value, proposed_state, line_quote_id: null, evidence });
  it("never offers Dismiss where it did the same as Accept", () => {
    for (const t of ["freight_treatment", "discount_treatment", "fx_assumption", "tax_basis", "validity_short", "missing_line", "conflict"]) expect(actionsFor(row(t, 100))).not.toContain("dismiss");
  });
  it("every card: at most the four buttons, by the four rules (P10 B1)", () => {
    const T = ["ambiguous_unit", "low_confidence_read", "price_check", "conflict", "total_mismatch", "prior_pricing", "missing_line", "unmapped_item", "freight_treatment", "fx_assumption",
      "discount_treatment", "tax_basis", "validity_short", "vendor_condition", "questionnaire_ambiguous", "questionnaire_missing", "vendor_mismatch", "unknown_vendor", "not_a_quote"];
    for (const t of T) for (const pv of [null, 100]) {
      const b = buttonsFor(row(t, pv));
      expect(Object.keys(b)).toEqual(["accept", "change", "ask", "exclude"]);
      if (["ambiguous_unit", "conflict", "freight_treatment"].includes(t) && pv === null) expect(b.accept).toBeNull(); // nothing suggested → no Accept
    }
    expect(buttonsFor(row("unmapped_item")).ask).toBe(false);            // our own matching: the vendor can't answer it
    expect(buttonsFor(row("unknown_vendor")).ask).toBe(false);           // nobody to ask
    expect(buttonsFor(row("freight_treatment", 180)).exclude).toBeNull(); // freight can't be left out; Change it to 0
    expect(buttonsFor(row("discount_treatment", 3, null, { discount: { kind: "all_lines" } })).exclude).toBe("exclude"); // ignore the discount
    expect(buttonsFor(row("discount_treatment", 2.5, null, { gross_up: true })).exclude).toBeNull(); // a gross-up is a correction, not an offer
    expect(buttonsFor({ ...row("discount_treatment", 2.5), title: "Printed rates are net of a 2.5% discount we won't earn" }).exclude).toBeNull(); // older cards: by title
  });
  it("the 14 gaps now have an action behind the button (scripts/test-four-buttons.ts)", () => {
    expect(actionsFor(row("vendor_mismatch", 30))).toEqual(["confirm", "reassign", "ask-vendor", "exclude"]);
    expect(actionsFor(row("discount_treatment", 3, null, { discount: {} }))).toEqual(["confirm", "set-discount", "ask-vendor", "exclude"]);
    expect(actionsFor(row("fx_assumption"))).toEqual(["confirm", "set-fx", "ask-vendor"]);
    expect(actionsFor(row("freight_treatment", null))).toEqual(["set-freight", "ask-vendor"]);
    expect(actionsFor(row("tax_basis"))).toEqual(["confirm", "set-gst", "ask-vendor"]);
    expect(actionsFor(row("questionnaire_missing"))).toEqual(["dismiss", "answer", "ask-vendor"]);
    expect(actionsFor(row("validity_short", 30))).toEqual(["confirm", "ask-vendor"]);
    expect(actionsFor(row("missing_line", 3))).toEqual(["confirm", "enter-prices", "ask-vendor"]);
    expect(actionsFor(row("conflict", 100))).toEqual(["confirm", "override", "ask-vendor", "exclude"]);
    expect(actionsFor(row("prior_pricing"))).toEqual(["mark-not-quoted", "enter-prices", "ask-vendor"]);
  });
  it("says what happens if nobody decides", () => {
    expect(ifNothing(row("prior_pricing"), "Anand Box Works", null, 8, false)).toBe("These 8 lines count as not quoted.");
    expect(ifNothing(row("freight_treatment", 180), "Anand Box Works", null, 0, false)).toBe("Landed prices for Anand Box Works include ₹180 per 1000 for freight.");
    expect(ifNothing(row("freight_treatment", null), "Anand Box Works", null, 0, false)).toBe("Landed prices for Anand Box Works leave freight out — the amount isn't stated.");
    expect(ifNothing(row("questionnaire_ambiguous"), "Anand Box Works", null, 0, true)).toBe("Anand Box Works isn't counted as cleared, so their lines can't win.");
    expect(ifNothing(row("ambiguous_unit"), "Westline", 9, 0, false)).toBe("Line 9 isn't counted in totals.");
    expect(ifNothing(row("vendor_mismatch", 30), "OrientPack Ltd", null, 0, false)).toBe("Its 30 prices stay out of the grid and every total.");
  });
  it("two answers from one vendor: Accept keeps the earlier one, Change uses the other or types one; the box fits the question", () => {
    const two = { conflict: { earlier: { answer: "aprox 250 ton per month", from: "the email" }, other: { answer: "400 MT per month", from: "Qtn SBP-0912 Meridian.xlsx" } }, answer_type: "number" };
    expect(buttonsFor(row("questionnaire_ambiguous", null, null, two))).toMatchObject({ accept: "confirm", change: { form: "answers" }, ask: true, exclude: null });
    expect(ifNothing(row("questionnaire_ambiguous", null, null, two), "Anand Box Works", null, 0, true)).toBe("Anand Box Works's earlier answer (“aprox 250 ton per month”) stands.");
    // older cards carry the two answers only in their title
    expect(conflictOf({ type: "questionnaire_ambiguous", title: "Q3: two answers from this vendor — “aprox 250 ton” vs “400 MT”" })).toEqual({ earlier: { answer: "aprox 250 ton", from: null }, other: { answer: "400 MT", from: null } });
    // one unclear answer: nothing to accept; Yes / No only for a yes-no question
    expect(buttonsFor(row("questionnaire_ambiguous", null, null, { answer_type: "yes_no" })).change?.form).toBe("yesno");
    expect(buttonsFor(row("questionnaire_ambiguous", null, null, { answer_type: "number" }))).toMatchObject({ accept: null, change: { form: "answers" } });
    expect(buttonsFor({ ...row("questionnaire_ambiguous"), answer_type: "number" }).change?.form).toBe("answers"); // type from the question when the card doesn't say
  });
  it("discount cards say what happens to that discount, never 'as Settings says' (P10)", () => {
    expect(ifNothing(row("discount_treatment", 3, null, { discount: { kind: "all_lines" } }), "Sri Balaji Packaging", null, 0, false)).toBe("The 3% comes off only in award options where Sri Balaji Packaging is awarded all the lines; line prices stay as quoted.");
    expect(ifNothing(row("discount_treatment", 3, null, { discount: { kind: "unclear" } }), "X", null, 0, false)).toBe("The discount isn't applied anywhere until its condition is clear; line prices stay as quoted.");
    expect(ifNothing(row("discount_treatment", 2.5, null, { gross_up: true }), "Kohinoor", null, 0, false)).toBe("Kohinoor's prices stay grossed up to the rate we'd actually pay (+2.5%).");
    expect(ifNothing(row("discount_treatment", 3, null, { discount: { kind: "all_lines" } }), "X", null, 0, false)).not.toMatch(/Settings/);
  });
  it("an unknown sender's cards wait: no buttons until the reply belongs to a vendor", () => {
    expect(buttonsFor({ ...row("conflict", 100), vendor_id: null })).toEqual({ accept: null, change: null, ask: false, exclude: null });
    expect(buttonsFor({ ...row("unknown_vendor"), vendor_id: null }).change?.form).toBe("vendor");
  });
});
