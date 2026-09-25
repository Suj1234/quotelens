// TRD §13.4 SQL guard. Pure: the Ask route calls it on every model-written query before run_readonly_query.
// run_readonly_query is security definer (DECISIONS "Known risk for P4"), so this is the only thing standing
// between a model-written query and the base tables: only the v_* views, their columns, keywords and a short
// function list may appear.

const COMPARISON_COLS = ["rfx_code", "line_no", "sku", "description", "ply", "item_type", "delivery_location", "monthly_qty", "annual_qty", "vendor", "vendor_code", "state", "unit_price", "landed_price", "original_value", "original_unit", "original_currency", "mapping_probability", "annual_value_unit", "annual_value_landed", "rfx_id", "rfx_line_id", "vendor_id"];
export const VIEWS: Record<string, string[]> = {
  v_comparison: COMPARISON_COLS,
  v_comparison_bestguess: COMPARISON_COLS,
  v_vendor_status: ["rfx_id", "vendor_id", "vendor", "vendor_code", "status", "disqualified_reason", "lines_priced", "lines_total", "cleared_questionnaire", "validity_until", "freight_included", "validity_days"],
  v_questionnaire: ["rfx_id", "q_no", "question", "answer_type", "disqualify_if", "vendor", "vendor_code", "answer_bool", "answer_number", "answer_text", "probability", "state", "passes"],
  v_assumptions: ["rfx_id", "kind", "description", "basis", "made_by", "created_at", "vendor", "line_no"],
  v_documents: ["rfx_id", "vendor", "vendor_code", "file_name", "mime", "page_count", "kind", "caption", "source", "is_clarification", "received_at"],
  v_vendor_terms: ["rfx_id", "vendor", "vendor_code", "currency", "payment_days", "payment_terms_raw", "validity_days", "validity_until", "freight_included", "freight_terms_raw",
    "taxes_included", "tax_terms_raw", "total_discount_pct", "total_discount_condition", "references_prior_pricing", "references_prior_pricing_text", "other_notes"],
  // P11 (migration 0019)
  v_line_stats: ["rfx_id", "line_no", "description", "ply", "item_type", "annual_qty", "quotes", "qualified_quotes", "lowest_price", "lowest_vendor", "second_price", "second_vendor",
    "median_price", "highest_price", "spread_pct", "gap_to_second_pct", "lowest_qualified_price", "lowest_qualified_vendor", "lowest_annual_value"],
  v_messages: ["rfx_id", "vendor", "vendor_code", "direction", "kind", "subject", "status", "sent_at", "received_at", "attachments"],
  v_review_cards: ["rfx_id", "vendor", "vendor_code", "line_no", "type", "title", "status", "created_at", "updated_at"],
};

// Every table in migrations 0001–0005 (+ the migration log). Named anywhere → rejected, even as an alias.
const BASE_TABLES = new Set(["users", "vendors", "rfx", "rfx_lines", "rfx_questions", "rfx_vendors", "communications", "responses", "response_files", "extracted_items", "response_terms", "line_quotes", "questionnaire_answers", "assumptions", "review_items", "unmatched_items", "queries", "scenarios", "scenario_lines", "settings", "awards", "audit_events", "model_calls", "eval_runs", "_migrations"]);

const FUNCTIONS = new Set([
  // aggregates
  "sum", "avg", "min", "max", "count", "bool_and", "bool_or", "every", "string_agg", "array_agg", "stddev", "variance",
  // conditionals / numbers
  "coalesce", "nullif", "greatest", "least", "round", "abs", "ceil", "ceiling", "floor", "trunc", "sign", "power", "sqrt", "mod",
  // strings
  "lower", "upper", "initcap", "length", "char_length", "concat", "concat_ws", "substring", "substr", "replace", "trim", "btrim", "ltrim", "rtrim", "split_part", "left", "right", "position", "strpos", "lpad", "rpad", "to_char", "format",
  // dates
  "date_part", "extract", "date_trunc", "age",
  // window
  "rank", "dense_rank", "row_number", "percent_rank", "cume_dist", "ntile", "lag", "lead", "first_value", "last_value",
]);

const KEYWORDS = new Set((
  "select with as from where and or not in is null true false case when then else end join inner left right full outer cross on using " +
  "group by order asc desc nulls first last limit offset having distinct all union intersect except exists between like ilike over partition " +
  "rows range unbounded preceding following current row filter cast interval numeric int integer bigint smallint decimal real float double precision " +
  "text varchar char boolean date timestamp timestamptz any some within day days month year current_date"
).split(" "));

const FORBIDDEN: [RegExp, string][] = [
  [/\b(insert|update|delete|drop|alter|create|grant|truncate|copy|call|do)\b/i, "a write or DDL keyword"],
  [/;/, "a semicolon"], [/--/, "a line comment"], [/\/\*/, "a block comment"], [/pg_/i, "a pg_ object"],
  [/information_schema/i, "information_schema"], [/current_user/i, "current_user"], [/\bset\s/i, "SET"],
  [/\blateral\b/i, "LATERAL"], [/\binto\s/i, "INTO"],
];

const UUID = /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi;
export type GuardResult = { ok: true } | { ok: false; error: string };

export function guardSql(sql: string, rfxId: string): GuardResult {
  const fail = (error: string): GuardResult => ({ ok: false, error });
  const s = sql.trim();
  if (s.length > 4000) return fail(`The query is ${s.length} characters; the limit is 4,000.`);
  if (!/^(select|with)\b/i.test(s)) return fail("The query must start with SELECT or WITH.");
  for (const [re, what] of FORBIDDEN) if (re.test(s)) return fail(`The query contains ${what}, which is not allowed.`);

  const scoped = [...s.matchAll(/rfx_id\s*=\s*'([^']*)'/gi)];
  if (!scoped.some((m) => m[1] === rfxId)) return fail(`The query must filter rfx_id = '${rfxId}'.`);
  const other = [...s.matchAll(UUID)].map((m) => m[1]).find((id) => id.toLowerCase() !== rfxId.toLowerCase());
  if (other) return fail(`The query refers to another id ('${other}'); only rfx_id = '${rfxId}' is allowed.`);

  // Tokenise outside string literals; double-quoted identifiers are checked like bare ones (a quoted alias after AS is fine).
  const code = s.replace(/'(?:[^']|'')*'/g, " '' ");
  // call = a "(" follows the word directly (whitespace only), so "x AS a, (b * c)" is not a call to a().
  const tokens = [...code.matchAll(/"([^"]*)"|([a-z_][a-z0-9_$]*)|(\()/gi)].map((m) => ({
    word: (m[1] ?? m[2] ?? "(").toLowerCase(), quoted: m[1] !== undefined, paren: !!m[3],
    call: !m[3] && /^\s*\(/.test(code.slice(m.index + m[0].length)),
  }));
  const words = tokens.filter((t) => !t.paren);

  const base = words.find((t) => BASE_TABLES.has(t.word));
  if (base) return fail(`"${base.word}" is a base table; only the views are allowed.`);
  const columns = new Set(Object.values(VIEWS).flat());
  const ctes = new Set<string>();
  const aliases = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], next = tokens[i + 1];
    if (t.word === "as" && next && !next.paren) aliases.add(next.word);
    if (next?.word === "as" && next.call && !t.paren) ctes.add(t.word); // name AS ( … )
  }
  // FROM / JOIN targets must be a view or a CTE of this query; the following bare word is a table alias.
  for (let i = 0; i < tokens.length; i++) {
    if (!["from", "join"].includes(tokens[i].word)) continue;
    const target = tokens[i + 1];
    if (!target || target.paren) continue; // subquery
    if (columns.has(target.word) || KEYWORDS.has(target.word)) continue; // extract(day from x), is distinct from x
    if (!(target.word in VIEWS) && !ctes.has(target.word)) return fail(`"${target.word}" is not one of the allowed views (${Object.keys(VIEWS).join(", ")}).`);
    const alias = tokens[i + 2];
    if (alias && !alias.paren && !KEYWORDS.has(alias.word)) aliases.add(alias.word);
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.paren) continue;
    const w = t.word;
    if (t.call && !KEYWORDS.has(w) && !FUNCTIONS.has(w) && !ctes.has(w)) return fail(`The function ${w}() is not allowed.`);
    if (KEYWORDS.has(w) || FUNCTIONS.has(w) || w in VIEWS || columns.has(w) || ctes.has(w) || aliases.has(w)) continue;
    if (t.quoted && tokens[i - 1]?.word === "as") continue;
    return fail(`Unknown identifier "${w}". Use only the views and their columns, and write aliases with AS.`);
  }

  // Each view reference needs its own RFx scope (a literal filter or a join on rfx_id), or joins multiply rows across RFx.
  const viewRefs = tokens.filter((t, i) => i > 0 && ["from", "join"].includes(tokens[i - 1].word) && t.word in VIEWS).length;
  const rfxMentions = words.filter((t) => t.word === "rfx_id").length;
  if (rfxMentions < viewRefs) return fail(`The query reads ${viewRefs} views but scopes only ${rfxMentions} to this RFx; filter each one on rfx_id = '${rfxId}' (or join on rfx_id).`);
  return { ok: true };
}

/**
 * TRD §13.2 "Include best guesses": the same SQL on v_comparison_bestguess, with the eligibility clause widened
 * so ambiguous / low-confidence cells (which now carry the system's best guess as their price) count as priced.
 */
export function rewriteBestGuess(sql: string): string {
  const GUESS = ["ambiguous", "low_confidence"];
  const list = (inner: string) => inner.split(",").map((x) => x.trim()).filter(Boolean);
  return sql
    .replace(/\bv_comparison\b(?!_)/g, "v_comparison_bestguess")
    .replace(/(\bstate\s+not\s+in\s*)\(([^)]*)\)/gi, (_, head: string, inner: string) => {
      const keep = list(inner).filter((x) => !GUESS.includes(x.replace(/'/g, "").toLowerCase()));
      return keep.length ? `${head}(${keep.join(", ")})` : `${head}('__none__')`;
    })
    .replace(/(\bstate\s+in\s*)\(([^)]*)\)/gi, (m, head: string, inner: string) => {
      const items = list(inner);
      const names = items.map((x) => x.replace(/'/g, "").toLowerCase());
      if (!names.some((n) => ["confirmed", "inferred", "reviewed"].includes(n))) return m; // e.g. "which cells are unsure" — leave as asked
      return `${head}(${[...items, ...GUESS.filter((g) => !names.includes(g)).map((g) => `'${g}'`)].join(", ")})`;
    })
    .replace(/(\bstate\s*(?:<>|!=)\s*)'(ambiguous|low_confidence)'/gi, "$1'__none__'");
}
