import "server-only";
import ExcelJS from "exceljs";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Draft } from "@/lib/rfx-draft";
import { longDate } from "@/lib/format";

// TRD §16 issue: the line-item sheet (XLSX, exceljs) and the supplier questionnaire (PDF, @react-pdf/renderer)
// attached to every dispatch email. Built from the frozen v1 draft; no model involved.

const UNIT: Record<string, string> = { per_1000_pcs: "per 1000 pieces", per_piece: "per piece", per_kg: "per kg", per_box: "per box" };
const TYPE: Record<string, string> = { yes_no: "Yes / No", number: "Number", text: "Text" };

export async function lineSheetXlsx(d: Draft): Promise<Buffer> {
  const r = d.rfx;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Meridian Foods Pvt Ltd";
  const ws = wb.addWorksheet("Line Items", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([`Meridian Foods Pvt Ltd — ${r.title}`]).font = { bold: true, size: 13 };
  ws.addRow([`RFx ${r.code} · quote in ${r.currency} ${UNIT[r.quote_unit] ?? r.quote_unit} · ${r.incoterm === "delivered" ? "delivered to plant" : r.incoterm.replace("_", "-")}${r.freight_included_requested ? ", freight included" : ""} · ${r.payment_terms_days}-day payment · ${r.validity_days_requested}-day validity`]);
  ws.addRow([`Please reply by ${r.response_deadline ? longDate(r.response_deadline) : "the deadline in the email"}. Fill in your price per line, or reply in any format convenient to you.`]).font = { italic: true };
  ws.addRow([]);
  const head = ws.addRow(["Line", "SKU", "Description", "Ply", "L (mm)", "W (mm)", "H (mm)", "GSM spec", "BF", "Type", "Wt/pc (g)", "Monthly qty", "Annual qty", "Deliver to", `Your price (${r.currency} ${UNIT[r.quote_unit] ?? r.quote_unit})`, "Remarks"]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F0EB" } }; c.border = { bottom: { style: "thin" } }; });
  for (const l of d.lines) {
    ws.addRow([l.line_no, l.sku, l.description, l.ply, l.length_mm, l.width_mm, l.height_mm, l.gsm_spec, l.burst_factor, l.item_type, l.weight_per_piece_g, l.monthly_qty, l.annual_qty, l.delivery_location, null, null]);
  }
  [6, 16, 40, 5, 8, 8, 8, 20, 5, 10, 10, 12, 12, 14, 24, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  [12, 13].forEach((c) => { ws.getColumn(c).numFmt = "#,##,##0"; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1C1E22" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  meta: { color: "#6E727A", marginBottom: 14 },
  intro: { marginBottom: 14, lineHeight: 1.4 },
  q: { borderTop: "1 solid #DEDCD5", paddingVertical: 8, flexDirection: "row" },
  qn: { width: 28, fontFamily: "Helvetica-Bold" },
  qt: { flex: 1, lineHeight: 1.35 },
  tag: { color: "#6E727A", fontSize: 8.5, marginTop: 2 },
  box: { marginTop: 6, height: 26, border: "1 solid #DEDCD5" },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, color: "#9EA2A9", fontSize: 8 },
});

export async function questionnairePdf(d: Draft, buyer: { name: string; email: string }): Promise<Buffer> {
  const r = d.rfx;
  return renderToBuffer(
    <Document title={`${r.code} Supplier Questionnaire`} author="Meridian Foods Pvt Ltd">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Supplier Questionnaire — {r.code}</Text>
        <Text style={s.meta}>Meridian Foods Pvt Ltd · {r.title}{r.response_deadline ? ` · reply by ${longDate(r.response_deadline)}` : ""}</Text>
        <Text style={s.intro}>Please answer every question. Mandatory questions must be answered for your quotation to be evaluated. You may fill in this form, or answer in your reply email or on your letterhead — in any format convenient to you.</Text>
        {d.questions.map((q) => (
          <View key={q.q_no} style={s.q} wrap={false}>
            <Text style={s.qn}>Q{q.q_no}</Text>
            <View style={s.qt}>
              <Text>{q.text}</Text>
              <Text style={s.tag}>Answer: {TYPE[q.answer_type] ?? q.answer_type}{q.mandatory ? " · mandatory" : " · optional"}</Text>
              <View style={s.box} />
            </View>
          </View>
        ))}
        <Text style={s.foot} fixed>{buyer.name} · {buyer.email} · {r.code} v{Math.max(1, r.version)}</Text>
      </Page>
    </Document>,
  );
}
