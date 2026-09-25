// Line checks against the category template (P9). Pure — used by the co-pilot, the Issue check and the New RFx screen.
// The template (Settings → Masters) decides WHICH fields are required; this file only knows how to test a field.
import type { CategoryTemplate, LineField } from "@/lib/settings-schema";

type Num = number | null | undefined;
export type LineLike = {
  line_no?: number; sku?: string | null; description?: string | null; ply?: Num; length_mm?: Num; width_mm?: Num; height_mm?: Num;
  gsm_spec?: string | null; burst_factor?: Num; item_type?: string | null; weight_per_piece_g?: Num; monthly_qty?: Num; delivery_location?: string | null;
};
export type LineRules = CategoryTemplate["line_rules"];

export const FIELD_LABEL: Record<LineField, string> = {
  sku: "SKU", description: "description", ply: "ply", dimensions: "dimensions", gsm_spec: "GSM spec", burst_factor: "burst factor",
  item_type: "item type", weight_per_piece_g: "weight per piece", monthly_qty: "monthly quantity", delivery_location: "delivery plant",
};

const text = (v: string | null | undefined) => !!v && v.trim() !== "" && v.trim() !== "—";
/** Is the field filled? Stored defaults count as empty: quantity 0, plant "—", SKU "LINE-n". A sheet needs L × W, a box also H. */
export function hasField(l: LineLike, f: LineField): boolean {
  switch (f) {
    case "sku": return text(l.sku) && !/^LINE-\d+$/.test(l.sku!.trim());
    case "description": return text(l.description);
    case "gsm_spec": return text(l.gsm_spec);
    case "item_type": return text(l.item_type);
    case "delivery_location": return text(l.delivery_location);
    case "monthly_qty": return !!l.monthly_qty && l.monthly_qty > 0;
    case "dimensions": return !!l.length_mm && !!l.width_mm && (l.item_type !== "box" || !!l.height_mm);
    default: return l[f] !== null && l[f] !== undefined;
  }
}

/** Values that are wrong, not just missing (block a typed add/update; reported on an imported sheet). */
export function lineErrors(l: LineLike, allowedPly: number[]): string[] {
  const e: string[] = [];
  if (l.ply !== null && l.ply !== undefined && !allowedPly.includes(l.ply)) e.push(`ply ${l.ply} — allowed: ${allowedPly.join(", ")}`);
  if (l.monthly_qty !== null && l.monthly_qty !== undefined && l.monthly_qty < 0) e.push("monthly quantity can't be negative");
  const layers = l.gsm_spec ? l.gsm_spec.split("/").map((x) => x.trim()).filter(Boolean).length : 0;
  if (l.gsm_spec && l.ply && layers !== l.ply) e.push(`GSM spec has ${layers} layers for a ${l.ply}-ply board`);
  if (l.item_type === "sheet" && l.height_mm) e.push("a sheet has no height");
  return e;
}

export type Gap = { field: LineField; lines: number[] };
/** Required fields missing (block Issue) and recommended fields missing (a note), grouped by field with line numbers. */
export function lineGaps(lines: LineLike[], rules: LineRules): { required: Gap[]; recommended: Gap[]; errors: { line: number; text: string }[] } {
  const no = (l: LineLike, i: number) => l.line_no ?? i + 1;
  const gaps = (fields: LineField[]) => fields.map((field) => ({ field, lines: lines.flatMap((l, i) => (hasField(l, field) ? [] : [no(l, i)])) })).filter((g) => g.lines.length);
  return {
    required: gaps(rules.required), recommended: gaps(rules.recommended.filter((f) => !rules.required.includes(f))),
    errors: lines.flatMap((l, i) => lineErrors(l, rules.allowed_ply).map((t) => ({ line: no(l, i), text: t }))),
  };
}

const nos = (n: number[]) => (n.length > 8 ? `${n.slice(0, 8).join(", ")} … (${n.length} lines)` : n.join(", "));
/** "monthly quantity missing on lines 4, 7" — one phrase per field. */
export const gapText = (g: Gap[]) => g.map((x) => `${FIELD_LABEL[x.field]} missing on line${x.lines.length > 1 ? "s" : ""} ${nos(x.lines)}`);

/** When there is no template for the category: nothing is required beyond a description (the co-pilot asks instead). */
export const NO_RULES: LineRules = { required: ["description"], recommended: [], allowed_ply: [3, 5, 7] };

/** What Issue still needs — one rule for the Issue button, the Issue route and the co-pilot. */
export function issueBlockers(d: { lines: LineLike[]; questions: unknown[]; vendors: unknown[]; rfx: { terms_set: boolean; response_deadline: string | null } }, rules: LineRules): string[] {
  const gaps = lineGaps(d.lines, rules).required;
  return [
    !d.lines.length && "line items", !!d.lines.length && gaps.length > 0 && `complete line items (${gapText(gaps).join("; ")})`,
    !d.rfx.terms_set && "commercial terms", !d.rfx.response_deadline && "a response deadline", !d.questions.length && "a questionnaire", !d.vendors.length && "vendors",
  ].filter((x): x is string => !!x);
}
