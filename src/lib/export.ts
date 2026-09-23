import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { COUNTED, getComparison, type CellState, type GridCell } from "@/lib/comparison";
import { getLedger } from "@/lib/rfx-tabs";
import { longDate } from "@/lib/format";
import type { Row } from "@/lib/query/result";

// TRD §16 exports. Colours are DESIGN §1.1 light tokens (Excel has no dark mode).
const C = { ink: "1C1E22", muted: "6E727A", faint: "9EA2A9", hair: "DEDCD5", tint: "F1F0EB", accent: "0F6663", amber: "955A0A", amberBg: "FAF0DB", green: "2B7A4B", greenBg: "E5F1E9", indigo: "4757A6", indigoBg: "E7EAF6", red: "A93A2E", redBg: "F7E6E3" };
const STATE: Record<CellState, { label: string; meaning: string; fill?: string; font?: string; strike?: boolean }> = {
  confirmed: { label: "Confirmed", meaning: "Read from the vendor's document and converted with stated units only." },
  inferred: { label: "Inferred", meaning: "Converted using an assumption (RFx spec, FX rate, discount treatment) — see the ledger.", fill: C.indigoBg, font: C.indigo },
  reviewed: { label: "Reviewed", meaning: "Decided by the buyer in the review queue.", fill: C.greenBg, font: C.green },
  low_confidence: { label: "Low-confidence", meaning: "The number could not be read reliably; not counted in totals.", fill: C.amberBg, font: C.amber },
  ambiguous: { label: "Ambiguous", meaning: "The unit is unclear; the best guess is shown but not counted.", fill: C.amberBg, font: C.amber },
  not_quoted: { label: "Not quoted", meaning: "The vendor did not quote this line.", fill: C.tint, font: C.faint },
  references_prior: { label: "Prior pricing", meaning: "The vendor points to earlier pricing that is not on file; no value.", fill: C.tint, font: C.muted },
  excluded: { label: "Excluded", meaning: "Excluded by the buyer.", font: C.faint, strike: true },
  conflict: { label: "Conflict", meaning: "Two items from this vendor map to this line; not counted.", fill: C.redBg, font: C.red },
};
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${argb}` } });
const MONEY = "#,##,##0"; // Indian grouping in Excel

async function rfxCode(rfxId: string) {
  const { data } = await db().from("rfx").select("code").eq("id", rfxId).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "RFx not found", undefined, 404);
  return data.code as string;
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
export const toCsv = (cols: string[], rows: unknown[][]) => [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** GET /api/export/comparison — xlsx: lines × vendors coloured by state + legend/notes + ledger; csv: one tidy row per cell. */
export async function exportComparison(rfxId: string, format: "xlsx" | "csv", basis: "unit" | "landed") {
  const [code, grid] = await Promise.all([rfxCode(rfxId), getComparison(rfxId)]);
  const name = `${code}-comparison-${basis}.${format}`;
  const at = (l: number, v: string) => grid.cells.find((c) => c.line_no === l && c.vendor === v);
  const price = (c: GridCell | undefined) => (c ? (basis === "landed" ? c.landed : c.unit) : null);

  if (format === "csv") {
    const cols = ["line_no", "sku", "description", "annual_qty", "vendor", "state", "unit_price_inr_per_1000", "landed_price_inr_per_1000", "best_guess_inr_per_1000", "original_value", "original_unit", "original_currency", `annual_value_${basis}_inr`];
    const rows = grid.lines.flatMap((l) => grid.vendors.map((v) => {
      const c = at(l.line_no, v.code);
      const p = price(c);
      return [l.line_no, l.sku, l.description, l.annual_qty, v.name, c?.state ?? "", c?.unit ?? "", c?.landed ?? "", c?.best_guess ?? "", c?.original?.value ?? "", c?.original?.unit ?? "", c?.original?.currency ?? "",
        p !== null && c && COUNTED.includes(c.state) ? Math.round(p * l.annual_qty / 1000) : ""];
    }));
    return { name, type: "text/csv; charset=utf-8", body: Buffer.from("﻿" + toCsv(cols, rows)) };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "QuoteLens";
  const ws = wb.addWorksheet("Comparison", { views: [{ state: "frozen", xSplit: 3, ySplit: 2 }] });
  ws.addRow([`${code} · ₹ per 1000 pcs · ${basis === "landed" ? "landed cost" : "unit price"} · exported ${longDate(new Date().toISOString())}`]).font = { bold: true };
  const head = ws.addRow(["Line", "SKU", "Description", "Annual qty", ...grid.vendors.map((v) => `${v.name} ${v.cleared === true ? "✓" : v.cleared === false ? "✗" : "?"}`)]);
  head.font = { bold: true, color: { argb: `FF${C.muted}` } };
  head.eachCell((c) => { c.border = { bottom: { style: "thin", color: { argb: `FF${C.hair}` } } }; });
  const eligible = (c: GridCell | undefined) => !!c && COUNTED.includes(c.state) && price(c) !== null && grid.vendors.find((v) => v.code === c.vendor)?.cleared === true;
  for (const l of grid.lines) {
    const cells = grid.vendors.map((v) => at(l.line_no, v.code));
    const min = Math.min(...cells.filter(eligible).map((c) => price(c)!));
    const row = ws.addRow([l.line_no, l.sku, l.description, l.annual_qty, ...cells.map((c) => {
      if (!c) return null;
      if (c.state === "not_quoted") return "not quoted";
      if (c.state === "references_prior") return "prior pricing";
      const p = price(c);
      if (p !== null) return Math.round(p);
      return c.best_guess !== null ? `${Math.round(c.best_guess).toLocaleString("en-IN")}? (best guess)` : "?";
    })]);
    row.getCell(4).numFmt = MONEY;
    cells.forEach((c, i) => {
      if (!c) return;
      const cell = row.getCell(5 + i);
      const s = STATE[c.state];
      if (typeof cell.value === "number") cell.numFmt = MONEY;
      if (s.fill) cell.fill = solid(s.fill);
      cell.font = { color: s.font ? { argb: `FF${s.font}` } : undefined, strike: s.strike, bold: eligible(c) && price(c) === min };
      if (eligible(c) && price(c) === min) cell.border = { left: { style: "thick", color: { argb: `FF${C.accent}` } } };
      cell.alignment = { horizontal: "right" };
    });
  }
  const tot = ws.addRow(["", "", "Annual value (counted cells)", "", ...grid.vendors.map((v) => Math.round(basis === "landed" ? v.total_landed : v.total_unit))]);
  tot.font = { bold: true };
  tot.eachCell((c, i) => { if (i > 4) c.numFmt = MONEY; c.border = { top: { style: "thin", color: { argb: `FF${C.hair}` } } }; });
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 16; ws.getColumn(3).width = 42; ws.getColumn(4).width = 12;
  grid.vendors.forEach((_, i) => { ws.getColumn(5 + i).width = 20; });

  const notes = wb.addWorksheet("Legend & notes");
  notes.addRow(["State", "Meaning", "Cells"]).font = { bold: true };
  for (const [k, s] of Object.entries(STATE) as [CellState, typeof STATE[CellState]][]) {
    const r = notes.addRow([s.label, s.meaning, grid.cells.filter((c) => c.state === k).length]);
    if (s.fill) r.getCell(1).fill = solid(s.fill);
    r.getCell(1).font = { color: s.font ? { argb: `FF${s.font}` } : undefined, strike: s.strike };
  }
  notes.addRow([]);
  notes.addRow(["Bold with a teal left edge = lowest eligible price on the line (vendors who cleared the questionnaire; confirmed, inferred or reviewed cells)."]);
  notes.addRow(["Totals count only confirmed, inferred and reviewed cells."]);
  notes.addRow([]);
  notes.addRow(["Vendor", "Questionnaire", "Priced"]).font = { bold: true };
  for (const v of grid.vendors) notes.addRow([v.name, v.cleared === true ? "cleared" : v.cleared_note, `${v.priced}/${v.lines}`]);
  notes.getColumn(1).width = 30; notes.getColumn(2).width = 90;

  const led = wb.addWorksheet("Ledger");
  led.addRow(["Kind", "Vendor", "Lines", "Assumption", "Basis", "By", "When"]).font = { bold: true };
  for (const r of await getLedger(rfxId)) led.addRow([r.kind, r.vendor, r.lines, r.description, r.basis, r.by, r.at ? longDate(r.at) : ""]);
  led.getColumn(4).width = 90; led.getColumn(2).width = 28;

  return { name, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from(await wb.xlsx.writeBuffer()) };
}

/** GET /api/export/query/{id} — an Ask answer's rows (column order kept), plus the question, answer and SQL. */
export async function exportQuery(queryId: string, format: "xlsx" | "csv") {
  const { data: q, error } = await db().from("queries").select("rfx_id, question, answer_text, computed_note, sql, result_rows, plan, created_at, exclusions").eq("id", queryId).maybeSingle();
  if (error) throw error;
  if (!q) throw new AppError("NOT_FOUND", "Answer not found", undefined, 404);
  const rows = (q.result_rows ?? []) as Row[];
  const cols = ((q.plan as { columns?: string[] } | null)?.columns?.length ? (q.plan as { columns: string[] }).columns : rows.length ? Object.keys(rows[0]) : []);
  const name = `${await rfxCode(q.rfx_id)}-answer-${queryId.slice(0, 8)}.${format}`;
  if (format === "csv") return { name, type: "text/csv; charset=utf-8", body: Buffer.from("﻿" + toCsv(cols, rows.map((r) => cols.map((c) => r[c])))) };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Answer");
  ws.addRow(cols).font = { bold: true, color: { argb: `FF${C.muted}` } };
  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => r[c] ?? null));
    cols.forEach((c, i) => { if (typeof r[c] === "number" && /_inr$|price|value|total|spend|saving|cost/i.test(c) && !/pct|rank/i.test(c)) row.getCell(i + 1).numFmt = MONEY; });
  }
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(10, c.length + 4)); });
  const about = wb.addWorksheet("Question");
  const excl = ((q.exclusions ?? []) as { vendor?: string; cells?: number; reason: string }[]).map((e) => e.vendor ? `${e.vendor}: ${e.reason}` : `${e.cells} ${e.reason}`).join("; ");
  for (const [k, v] of [["Question", q.question], ["Answer", q.answer_text], ["How it was computed", q.computed_note], ["Excluded", excl], ["SQL", q.sql], ["Asked", longDate(q.created_at)]]) {
    const r = about.addRow([k, v ?? ""]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  about.getColumn(1).width = 20; about.getColumn(2).width = 110;
  return { name, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from(await wb.xlsx.writeBuffer()) };
}
