import "server-only";
import ExcelJS from "exceljs";
import type { Draft } from "@/lib/rfx-draft";
import { longDate } from "@/lib/format";

// TRD §16 issue: one quote form (XLSX, exceljs) attached to every dispatch email — tab "Line Items" for prices, tab
// "Questionnaire" for the supplier questions (DECISIONS 2026-09-25: replaces the TRD's flat questionnaire PDF, which
// suppliers couldn't type into). Built from the draft; no model involved.

const UNIT: Record<string, string> = { per_1000_pcs: "per 1000 pieces", per_piece: "per piece", per_kg: "per kg", per_box: "per box" };
const TYPE: Record<string, string> = { yes_no: "Yes / No", number: "Number", text: "Text" };

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F0EB" } } as const;
const INFO_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F6F2" } } as const;
const INPUT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6CC" } } as const; // cells the supplier fills in
const EDGE = { style: "thin", color: { argb: "FFDEDCD5" } } as const;

/** The RFx facts as one shaded, bordered block above the table: each line merged across all `cols` columns, then a
 *  blank spacer row. Returns the row number the table header goes on. */
function infoBlock(ws: ExcelJS.Worksheet, cols: number, title: string, lines: string[]): number {
  [title, ...lines].forEach((text, i) => {
    const n = i + 1;
    ws.getCell(n, 1).value = text;
    ws.mergeCells(n, 1, n, cols);
    const c = ws.getCell(n, 1);
    c.fill = INFO_FILL;
    c.font = i === 0 ? { bold: true, size: 13 } : { size: 10.5 };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = { left: EDGE, right: EDGE, top: i === 0 ? EDGE : undefined, bottom: i === lines.length ? EDGE : undefined };
    ws.getRow(n).height = i === 0 ? 24 : 18;
  });
  return lines.length + 3;
}

function headerRow(ws: ExcelJS.Worksheet, at: number, labels: string[]) {
  const row = ws.getRow(at);
  row.values = labels;
  row.font = { bold: true };
  row.eachCell((c) => { c.fill = HEAD_FILL; c.border = { bottom: { style: "thin" } }; });
}

export async function quoteFormXlsx(d: Draft): Promise<Buffer> {
  const r = d.rfx;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Meridian Foods Pvt Ltd";
  const unit = `${r.currency} ${UNIT[r.quote_unit] ?? r.quote_unit}`;
  const reply = `Reply by ${r.response_deadline ? longDate(r.response_deadline) : "the deadline in the email"}`;

  const labels = ["Line", "SKU", "Description", "Ply", "L (mm)", "W (mm)", "H (mm)", "GSM spec", "BF", "Type", "Wt/pc (g)", "Monthly qty", "Annual qty", "Deliver to", `Your price (${unit})`, "Remarks"];
  const ws = wb.addWorksheet("Line Items");
  const top = infoBlock(ws, labels.length, `Meridian Foods Pvt Ltd — ${r.title}`, [
    `RFx ${r.code} · ${reply}`,
    `Quote in ${unit} · ${r.incoterm === "delivered" ? "delivered to plant" : r.incoterm.replace("_", "-")}${r.freight_included_requested ? ", freight included" : ""} · ${r.tax_basis === "incl_gst" ? "prices incl. GST" : "prices excl. GST, state the rate"}`,
    `${r.payment_terms_days}-day payment · ${r.validity_days_requested}-day validity`,
    "Fill in the yellow cells with your price per line, and answer the Questionnaire tab — or reply in any format convenient to you.",
  ]);
  ws.views = [{ state: "frozen", ySplit: top }];
  headerRow(ws, top, labels);
  for (const l of d.lines) {
    const row = ws.addRow([l.line_no, l.sku, l.description, l.ply, l.length_mm, l.width_mm, l.height_mm, l.gsm_spec, l.burst_factor, l.item_type, l.weight_per_piece_g, l.monthly_qty, l.annual_qty, l.delivery_location, null, null]);
    [15, 16].forEach((c) => { row.getCell(c).fill = INPUT_FILL; });
  }
  [6, 16, 40, 5, 8, 8, 8, 20, 5, 10, 10, 12, 12, 14, 24, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  [12, 13].forEach((c) => { ws.getColumn(c).numFmt = "#,##,##0"; });

  const qLabels = ["Q", "Question", "Answer type", "Mandatory", "Your answer", "Remarks"];
  const qs = wb.addWorksheet("Questionnaire");
  const qTop = infoBlock(qs, qLabels.length, `Supplier Questionnaire — ${r.code}`, [
    `${reply} · answer every question in the yellow "Your answer" column.`,
    "Mandatory questions must be answered for your quotation to be evaluated.",
  ]);
  qs.views = [{ state: "frozen", ySplit: qTop }];
  headerRow(qs, qTop, qLabels);
  for (const q of d.questions) {
    const row = qs.addRow([q.q_no, q.text, TYPE[q.answer_type] ?? q.answer_type, q.mandatory ? "Yes" : "No", null, null]);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    [5, 6].forEach((c) => { row.getCell(c).fill = INPUT_FILL; });
    if (q.answer_type === "yes_no") row.getCell(5).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
  }
  [5, 70, 12, 11, 24, 30].forEach((w, i) => { qs.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
