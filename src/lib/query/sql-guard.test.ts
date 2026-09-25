import { describe, expect, it } from "vitest";
import { guardSql, rewriteBestGuess } from "./sql-guard";

const RFX = "8f0c7a52-1d3e-4b6a-9c11-2a5e7d9b0f34";
const OTHER = "11111111-2222-4333-8444-555555555555";

const Q1 = `with eligible as (
  select c.line_no, c.description, c.vendor, c.unit_price, c.annual_qty
  from v_comparison c
  join v_vendor_status s on s.vendor_id = c.vendor_id and s.rfx_id = c.rfx_id
  where c.rfx_id = '${RFX}'
    and s.cleared_questionnaire = true
    and c.state in ('confirmed','inferred','reviewed')
    and c.unit_price is not null
), ranked as (
  select *, row_number() over (partition by line_no order by unit_price) as rn,
         min(unit_price) over (partition by line_no) as best_price
  from eligible
)
select line_no, description, vendor, round(unit_price) as price_inr,
       round(unit_price * annual_qty / 1000.0) as annual_value_inr
from ranked where rn = 1 order by line_no limit 30`;

const Q6 = `select line_no, vendor, state, original_value, original_unit,
       round(coalesce(unit_price, 0) * annual_qty / 1000.0) as annual_value_inr
from v_comparison
where rfx_id = '${RFX}' and state in ('low_confidence','ambiguous','references_prior','conflict')
order by vendor, line_no`;

const reject = (sql: string, match: RegExp) => {
  const r = guardSql(sql, RFX);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(match);
};

describe("guardSql (TRD §13.4)", () => {
  it("accepts a realistic Q1 (CTE + window functions) and Q6", () => {
    expect(guardSql(Q1, RFX)).toEqual({ ok: true });
    expect(guardSql(Q6, RFX)).toEqual({ ok: true });
  });

  it("accepts extract(... from col), casts, quoted aliases and the best-guess view", () => {
    const sql = `select vendor, extract(day from validity_until::timestamp - current_date::timestamp) as days_left, count(*)::int as "Lines priced"
      from v_vendor_status vs where vs.rfx_id = '${RFX}' group by vendor, validity_until order by "Lines priced" desc`;
    expect(guardSql(sql, RFX)).toEqual({ ok: true });
    // regression: an alias followed by ", (expr)" is not a function call
    expect(guardSql(`select c.unit_price as unit_price_val, (c.unit_price * c.annual_qty) as v from v_comparison as c where c.rfx_id = '${RFX}'`, RFX)).toEqual({ ok: true });
    expect(guardSql(`select sum(annual_value_unit) as total from v_comparison_bestguess where rfx_id = '${RFX}'`, RFX)).toEqual({ ok: true });
  });

  it("rule 1: must start with select or with", () => reject(`explain select * from v_comparison where rfx_id = '${RFX}'`, /start with SELECT/));

  it("rule 2: rejects writes, DDL and dangerous tokens", () => {
    reject(`select * from v_comparison where rfx_id = '${RFX}' and 1=1; delete from v_comparison`, /write or DDL|semicolon/);
    reject(`with x as (delete from v_comparison returning *) select * from x where rfx_id = '${RFX}'`, /write or DDL/);
    reject(`select * from v_comparison where rfx_id = '${RFX}'; select 1`, /semicolon/);
    reject(`select * from v_comparison where rfx_id = '${RFX}' -- hi`, /line comment/);
    reject(`select /* x */ * from v_comparison where rfx_id = '${RFX}'`, /block comment/);
    reject(`select pg_sleep(10) from v_comparison where rfx_id = '${RFX}'`, /pg_/);
    reject(`select * from information_schema.tables where rfx_id = '${RFX}'`, /information_schema/);
    reject(`select current_user from v_comparison where rfx_id = '${RFX}'`, /current_user/);
    reject(`select * from v_comparison, lateral (select 1) x where rfx_id = '${RFX}'`, /LATERAL/);
    reject(`select * into tmp from v_comparison where rfx_id = '${RFX}'`, /INTO/);
    reject(`select set_config('a','b',false) from v_comparison where rfx_id = '${RFX}'`, /function set_config/);
  });

  it("rule 3: only views, their columns, keywords and allowed functions", () => {
    reject(`select email, password_hash from users where rfx_id = '${RFX}'`, /users/);
    reject(`select * from line_quotes where rfx_id = '${RFX}'`, /line_quotes/);
    reject(`select 1 as users from v_comparison where rfx_id = '${RFX}' union select 1 from users`, /users.*base table/);
    reject(`select vendor from v_comparison c, users u where c.rfx_id = '${RFX}'`, /users/);
    reject(`select * from public.v_comparison where rfx_id = '${RFX}'`, /public/);
    reject(`select password_hash from v_comparison where rfx_id = '${RFX}'`, /Unknown identifier "password_hash"/);
    reject(`select dblink('x') from v_comparison where rfx_id = '${RFX}'`, /function dblink/);
    reject(`select min(unit_price) cheapest from v_comparison where rfx_id = '${RFX}'`, /Unknown identifier "cheapest"/);
  });

  it("rule 4: must filter this rfx_id; other ids are rejected", () => {
    reject(`select * from v_comparison`, /must filter rfx_id/);
    reject(`select * from v_comparison where rfx_id = '${OTHER}'`, /must filter rfx_id/);
    reject(`select * from v_comparison where rfx_id = '${RFX}' or rfx_id = '${OTHER}'`, /another id/);
    reject(`select * from v_comparison c join v_vendor_status s on s.vendor_id = c.vendor_id where c.rfx_id = '${RFX}'`, /scopes only 1/);
  });

  it("rule 5: at most 4,000 characters", () => reject(`select vendor from v_comparison where rfx_id = '${RFX}'${" and 1 = 1".repeat(400)}`, /4,000/));
});

describe("rewriteBestGuess (TRD §13.2)", () => {
  it("moves the query to the best-guess view and widens the eligibility clause", () => {
    const out = rewriteBestGuess(Q1);
    expect(out).toContain("from v_comparison_bestguess c");
    expect(out).toContain("c.state in ('confirmed', 'inferred', 'reviewed', 'ambiguous', 'low_confidence')");
    expect(guardSql(out, RFX)).toEqual({ ok: true });
  });
  it("drops unsure states from a NOT IN list and leaves an unsure-cells question alone", () => {
    const sql = `select * from v_comparison where rfx_id = '${RFX}' and state not in ('low_confidence','ambiguous','references_prior')`;
    expect(rewriteBestGuess(sql)).toContain("state not in ('references_prior')");
    expect(rewriteBestGuess(Q6)).toContain("state in ('low_confidence','ambiguous','references_prior','conflict')");
  });
});

describe("P9 C2: documents and vendor terms views", () => {
  it("accepts queries on v_documents and v_vendor_terms", () => {
    expect(guardSql(`select vendor, file_name, caption from v_documents where rfx_id = '${RFX}' and caption ilike '%ISO%'`, RFX)).toEqual({ ok: true });
    expect(guardSql(`select vendor, payment_days, payment_terms_raw from v_vendor_terms where rfx_id = '${RFX}' and vendor_code = 'kohinoor'`, RFX)).toEqual({ ok: true });
  });
  it("still rejects the base tables behind them", () => {
    expect(guardSql(`select * from response_terms where rfx_id = '${RFX}'`, RFX).ok).toBe(false);
    expect(guardSql(`select * from response_files where rfx_id = '${RFX}'`, RFX).ok).toBe(false);
  });
});
