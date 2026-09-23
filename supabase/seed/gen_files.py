import json, os, csv, random, datetime
from gen_core import LINES, balaji, kohinoor, westline, orient, anand, QUESTIONS, QA, FX_USD, FX_DATE
random.seed(7)
OUT="pack"; os.makedirs(OUT, exist_ok=True)
for d in ["00_rfx","01_balaji","02_kohinoor","03_westline","04_orientpack","05_anand","gold"]:
    os.makedirs(f"{OUT}/{d}", exist_ok=True)

TODAY=datetime.date(2026,9,23)
def dmy(d): return d.strftime("%d %b %Y")

# ---------- 00 RFx: line sheet (csv + xlsx) and questions.json ----------
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
cols=["line_no","sku","description","ply","length_mm","width_mm","height_mm","gsm_spec","burst_factor","item_type","weight_per_piece_g","monthly_qty","annual_qty","delivery_location"]
with open(f"{OUT}/00_rfx/rfx_lines.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
    for L in LINES: w.writerow({c:L[c] for c in cols})
wb=openpyxl.Workbook(); ws=wb.active; ws.title="Line Items"
ws.append(["Meridian Foods Pvt Ltd — Corrugated Packaging Line Sheet (FY26-27 requirement)"]); ws.merge_cells("A1:N1")
ws["A1"].font=Font(bold=True,size=13)
ws.append(["Line","SKU","Description","Ply","L (mm)","W (mm)","H (mm)","GSM spec","BF","Type","Wt/pc (g)","Monthly qty","Annual qty","Deliver to"])
for c in ws[2]: c.font=Font(bold=True,color="FFFFFF"); c.fill=PatternFill("solid",fgColor="1F4E78")
for L in LINES: ws.append([L[c] for c in cols])
for col,wd in zip("ABCDEFGHIJKLMN",[6,16,42,5,8,8,8,22,5,10,10,12,12,13]): ws.column_dimensions[col].width=wd
wb.save(f"{OUT}/00_rfx/rfx_lines.xlsx")
json.dump([dict(q_no=q,text=t,answer_type=a,mandatory=m,disqualify_if=d) for q,t,a,m,d in QUESTIONS],open(f"{OUT}/00_rfx/questions.json","w"),indent=1)
json.dump(dict(code="MER-0417",title="Corrugated packaging — FY26-27 annual contract (Hosur & Nelamangala)",category="Corrugated packaging",
  currency="INR",quote_unit="per_1000_pcs",incoterm="delivered",freight_included_requested=True,payment_terms_days=45,
  validity_days_requested=60,contract_months=12,response_deadline="2026-10-07",delivery_locations=["Hosur","Nelamangala"],
  issued_on="2026-09-24",buyer=dict(name="Sujit Menon",title="Category Buyer — Packaging",email="sujit.menon@meridianfoods.example"),
  approver=dict(name="Priya Raghavan",title="VP Procurement"),
  cover_note="Meridian Foods invites quotations for its FY26-27 corrugated packaging requirement: 30 SKUs of 3-ply and 5-ply shipper, export, retail and inner cartons, corrugated sheets, layer pads and partition sets, for delivery to our Hosur (TN) and Nelamangala (KA) plants. Quotes are requested in INR per 1000 pieces, delivered to plant with freight included, 45-day payment, 60-day validity, for a 12-month contract."),
  open(f"{OUT}/00_rfx/rfx_meta.json","w"),indent=1)

# ---------- 01 Balaji: xlsx, own layout ----------
wb=openpyxl.Workbook(); ws=wb.active; ws.title="Price Offer"
ws["A1"]="SRI BALAJI PACKAGING"; ws["A1"].font=Font(bold=True,size=16,color="C00000")
ws["A2"]="Plot 42-B, SIPCOT Industrial Complex, Hosur 635126, Tamil Nadu | GSTIN 33AAECS4471K1Z9"
ws["A3"]="Ref: SBP/Q/2026-27/0912   Date: 27-Sep-2026   To: Mr. Sujit Menon, Meridian Foods Pvt Ltd"
ws["A4"]="Sub: Price offer against your enquiry MER-0417 (Corrugated boxes & sheets)"
ws.merge_cells("A6:B6"); ws["A6"]="Item details"; ws.merge_cells("C6:E6"); ws["C6"]="Specification"; ws.merge_cells("F6:I6"); ws["F6"]="Commercials"
for c in ["A6","C6","F6"]: ws[c].font=Font(bold=True); ws[c].alignment=Alignment(horizontal="center"); ws[c].fill=PatternFill("solid",fgColor="FCE4D6")
hdr=["S.No","Our Ref","Box Description","Size (mm)","Ply / BF","Paper GSM","Basic Rate (Rs. per 1000 Nos)","GST %","Remarks"]
ws.append(hdr)
for c in ws[7]: c.font=Font(bold=True); c.fill=PatternFill("solid",fgColor="DDEBF7")
for L in LINES:
    n=L["line_no"]; size=f'{L["length_mm"]}x{L["width_mm"]}' + (f'x{L["height_mm"]}' if L["height_mm"] else "")
    desc=L["description"].replace("RSC ","").replace(" 5-ply","").replace(" 3-ply","")
    desc=" ".join(desc.split()[:-1]) if L["item_type"]!="partition" else L["description"].replace(" 3-ply","")
    rem = "Die-cut, glued" if L["item_type"]=="box" and L["ply"]==5 else ("Stitched" if L["item_type"]=="box" else "")
    ws.append([n, f"SBP-{1000+n}", desc, size, f'{L["ply"]} ply / BF {L["burst_factor"]}', L["gsm_spec"], balaji[n], 18, rem])
r=ws.max_row+2
ws.cell(r,1,"Terms:").font=Font(bold=True)
terms=["1. Prices are basic, in INR per 1000 numbers, delivered to your Hosur / Nelamangala plant (freight included).",
"2. GST 18% extra as applicable.","3. Payment: 45 days from date of invoice, as per your enquiry.",
"4. Validity: 60 days from the date of this offer.",
"5. Special discount of 3% on total invoice value if all 30 items are awarded to us for the full year.",
"6. Tooling / die charges nil for repeat sizes.","7. Minimum order per SKU per delivery: 5,000 nos."]
for i,t in enumerate(terms): ws.cell(r+1+i,1,t)
for col,wd in zip("ABCDEFGHI",[6,10,36,16,14,22,26,7,16]): ws.column_dimensions[col].width=wd
ws2=wb.create_sheet("Supplier Questionnaire")
ws2.append(["Q No","Question (as received)","Our response"])
for c in ws2[1]: c.font=Font(bold=True)
for q,t,a,m,d in QUESTIONS: ws2.append([q,t,QA["balaji"][q][0]])
ws2.column_dimensions["B"].width=70; ws2.column_dimensions["C"].width=50
wb.save(f"{OUT}/01_balaji/SBP_Price_Offer_MER-0417.xlsx")

# ---------- PDF helpers (reportlab) ----------
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
ss=getSampleStyleSheet()
small=ParagraphStyle("small",parent=ss["Normal"],fontSize=8,leading=10)
body=ParagraphStyle("body",parent=ss["Normal"],fontSize=9.5,leading=13)
def letterhead(canvas, doc, name, addr, color):
    canvas.saveState(); canvas.setFillColor(color); canvas.rect(0,A4[1]-22*mm,A4[0],22*mm,fill=1,stroke=0)
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold",16); canvas.drawString(15*mm,A4[1]-13*mm,name)
    canvas.setFont("Helvetica",8); canvas.drawString(15*mm,A4[1]-18.5*mm,addr)
    canvas.setFillColor(colors.grey); canvas.setFont("Helvetica",7); canvas.drawRightString(A4[0]-15*mm,8*mm,f"{name} — Page {doc.page}")
    canvas.restoreState()

# ---------- 02 Kohinoor: letterhead PDF, 27 lines, footnote ----------
def kohinoor_pdf():
    path=f"{OUT}/02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf"
    doc=SimpleDocTemplate(path,pagesize=A4,topMargin=30*mm,bottomMargin=18*mm,leftMargin=15*mm,rightMargin=15*mm)
    el=[]
    el.append(Paragraph("<b>Quotation No. KC/Q/2026-27/1187</b> &nbsp;&nbsp; Date: 29 September 2026",body))
    el.append(Paragraph("To: Mr. Sujit Menon, Category Buyer — Packaging, Meridian Foods Pvt Ltd, Bengaluru<br/>Subject: Quotation against RFx MER-0417 — corrugated boxes and sheets",body))
    el.append(Spacer(1,4*mm))
    el.append(Paragraph("Dear Sir, with reference to your enquiry we are pleased to quote as under. Items 28–30 (partition sets) are not in our manufacturing range and are not quoted.",body))
    el.append(Spacer(1,3*mm))
    data=[["Sr","Description","Size (mm)","Ply/BF","Rate Rs. / 1000 pcs *"]]
    for L in LINES:
        n=L["line_no"]
        if n not in kohinoor: continue
        size=f'{L["length_mm"]} × {L["width_mm"]}' + (f' × {L["height_mm"]}' if L["height_mm"] else "")
        data.append([str(n), L["description"], size, f'{L["ply"]}/{L["burst_factor"]}', f'{kohinoor[n]:,.0f}'])
    t=Table(data,colWidths=[10*mm,78*mm,34*mm,18*mm,36*mm],repeatRows=1)
    t.setStyle(TableStyle([("FONT",(0,0),(-1,0),"Helvetica-Bold",8.5),("FONT",(0,1),(-1,-1),"Helvetica",8.5),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#E8EEF7")),("GRID",(0,0),(-1,-1),0.4,colors.grey),
        ("ALIGN",(4,1),(4,-1),"RIGHT"),("ALIGN",(0,0),(0,-1),"CENTER")]))
    el.append(t)
    el.append(Spacer(1,3*mm))
    el.append(Paragraph("* Rates are net of our 2.5% early-payment discount, applicable only if payment is received within 10 days of invoice. For payment beyond 10 days, rates are to be read as quoted ÷ 0.975.",small))
    el.append(PageBreak())
    el.append(Paragraph("<b>Commercial terms</b>",body))
    for t_ in ["Prices in INR per 1000 pieces, delivered to Hosur plant. Delivery to Nelamangala via our Bengaluru warehouse at the same rate.",
               "GST @ 18% extra.","Validity: 30 days from the date of this quotation.",
               "Payment: 30 days from invoice; 45 days acceptable (early-payment discount then not applicable — see note on page 1).",
               "Minimum order quantity: 10,000 pieces per SKU per delivery. Lead time 10 days from confirmed PO."]:
        el.append(Paragraph("• "+t_,body))
    el.append(Spacer(1,4*mm)); el.append(Paragraph("<b>Response to supplier questionnaire</b>",body))
    qd=[["Q","Question","Response"]]+[[str(q),Paragraph(t,small),Paragraph(QA["kohinoor"][q][0],small)] for q,t,a,m,d in QUESTIONS]
    qt=Table(qd,colWidths=[8*mm,95*mm,73*mm]); qt.setStyle(TableStyle([("GRID",(0,0),(-1,-1),0.4,colors.grey),("FONT",(0,0),(-1,0),"Helvetica-Bold",8.5),("VALIGN",(0,0),(-1,-1),"TOP")]))
    el.append(qt); el.append(Spacer(1,6*mm))
    el.append(Paragraph("For Kohinoor Corrugators Pvt Ltd<br/><br/>R. Deshpande, Sales Manager | sales@kohinoorcorr.example | +91 20 2712 xxxx",body))
    lh=lambda c,d: letterhead(c,d,"KOHINOOR CORRUGATORS PVT LTD","Gat No. 118, Chakan MIDC Phase II, Pune 410501, Maharashtra | GSTIN 27AABCK2210H1ZP | ISO 9001:2015",colors.HexColor("#1F3A5F"))
    doc.build(el,onFirstPage=lh,onLaterPages=lh)
kohinoor_pdf()

def simple_pdf(path, title, name, addr, color, paras):
    doc=SimpleDocTemplate(path,pagesize=A4,topMargin=30*mm,bottomMargin=18*mm,leftMargin=15*mm,rightMargin=15*mm)
    el=[Paragraph(f"<b>{title}</b>",ss["Heading2"]),Spacer(1,3*mm)]+[Paragraph(p,body) if not isinstance(p,Table) else p for p in paras]
    lh=lambda c,d: letterhead(c,d,name,addr,color); doc.build(el,onFirstPage=lh,onLaterPages=lh)

# supporting docs
simple_pdf(f"{OUT}/02_kohinoor/Kohinoor_Company_Profile.pdf","Company Profile","KOHINOOR CORRUGATORS PVT LTD","Chakan MIDC, Pune",colors.HexColor("#1F3A5F"),
 ["Established 1994. Two plants at Chakan (Pune) with automatic 5-ply and 3-ply corrugators, 4-colour flexo printing and rotary die-cutting. Monthly capacity 850 tonnes.",
  "Certifications: ISO 9001:2015, BRCGS Packaging Materials (AA). Key clients: Marico, Parle Agro, Tata Consumer Products.",
  "This document is a company profile and contains no pricing."])
simple_pdf(f"{OUT}/01_balaji/SBP_ISO9001_Certificate.pdf","Certificate of Registration — ISO 9001:2015","SRI BALAJI PACKAGING","SIPCOT Hosur",colors.HexColor("#C00000"),
 ["This is to certify that the quality management system of Sri Balaji Packaging, Plot 42-B SIPCOT Hosur, has been assessed and registered against ISO 9001:2015 for the manufacture of corrugated boxes and sheets.",
  "Certificate No. TUV-IN-QMS-118842. Valid until 14 March 2028. Issued by TÜV SÜD South Asia.","(Fictional certificate for demonstration.)"])
simple_pdf(f"{OUT}/03_westline/Westline_Company_Profile.pdf","Company Profile","WESTLINE PACKAGING","Changodar, Ahmedabad",colors.HexColor("#2E7D32"),
 ["Westline Packaging, Ahmedabad, manufactures 3-ply and 5-ply corrugated boxes, sheets and partitions. Capacity 600 MT/month. ISO 9001:2015. BRC audit planned Q1 2027.","No pricing in this document."])

# ---------- 03 Westline: docx, prose commercials + small table ----------
from docx import Document
from docx.shared import Pt
d=Document()
d.add_heading("Westline Packaging — Offer for Meridian Foods enquiry MER-0417",1)
d.add_paragraph("Ref WP/OFR/26-27/0344 | 30 September 2026 | Changodar GIDC, Ahmedabad 382213, Gujarat | GSTIN 24AADCW7781R1Z2")
d.add_paragraph("Dear Mr. Menon,")
d.add_paragraph("Thank you for your enquiry. We are pleased to offer the corrugated items as described below. Our prices are quoted per bundle as packed ex-our-works; all bundles are strapped and palletised. Prices are in Indian Rupees, exclusive of GST at 18%, and are valid for 60 days. Payment 45 days from invoice is acceptable. Freight to Hosur and Nelamangala is included in the bundle prices below.")
HIDDEN_TRUE_BUNDLE={5:25,9:20,15:50,19:40}
def item_phrase(n):
    L=LINES[n-1]; wl=westline[n]; short=L["description"].split("-ply ")[1]
    if wl["stated"]: return f'item {n} ({short}) Rs. {wl["per_bundle"]:,.0f} per bundle of {wl["bundle_size"]}'
    return None
d.add_paragraph("5-ply cartons (items 1 to 12 of your list) are supplied flat, strapped in bundles. Our prices are: " +
  "; ".join([item_phrase(n) for n in range(1,13) if item_phrase(n)]) +
  ". For items 5 and 9 our price is Rs. {:,.0f} and Rs. {:,.0f} per bundle respectively.".format(westline[5]["per_bundle"],westline[9]["per_bundle"]))
d.add_paragraph("3-ply cartons (items 13 to 22): " +
  "; ".join([f'item {n} Rs. {westline[n]["per_bundle"]:,.0f} per bundle of {westline[n]["bundle_size"]}' for n in range(13,23) if westline[n]["stated"]]) +
  ". Items 15 and 19 are offered at Rs. {:,.0f} and Rs. {:,.0f} per bundle.".format(westline[15]["per_bundle"],westline[19]["per_bundle"]))
d.add_paragraph("Sheets, layer pads and partition sets are tabulated below.")
tbl=d.add_table(rows=1,cols=4); tbl.style="Table Grid"
h=tbl.rows[0].cells; h[0].text="Item"; h[1].text="Description"; h[2].text="Pack"; h[3].text="Price per bundle (Rs.)"
for n in range(23,31):
    L=LINES[n-1]; r=tbl.add_row().cells; r[0].text=str(n); r[1].text=L["description"]; r[2].text=f'{westline[n]["bundle_size"]} per bundle'; r[3].text=f'{westline[n]["per_bundle"]:,.0f}'
d.add_paragraph("")
d.add_paragraph("Supplier questionnaire — our responses:")
for q,t,a,m,dq in QUESTIONS: d.add_paragraph(f"{q}. {t} — {QA['westline'][q][0]}", style="List Number")
d.add_paragraph("We look forward to your order.\n\nYours faithfully,\nHemant Shah, Director — Sales\nWestline Packaging | hemant@westlinepack.example | +91 79 2989 xxxx")
d.save(f"{OUT}/03_westline/Westline_Offer_MER-0417.docx")
open(f"{OUT}/03_westline/westline_clarification_reply.txt","w").write(f"""Dear Mr. Menon,

Apologies for the omission. Bundle sizes for the four items you asked about:

Item 5 (380x280x220, 5-ply): {HIDDEN_TRUE_BUNDLE[5]} per bundle
Item 9 (550x350x350, 5-ply): {HIDDEN_TRUE_BUNDLE[9]} per bundle (larger carton, packed 20)
Item 15 (350x250x180, 3-ply): {HIDDEN_TRUE_BUNDLE[15]} per bundle
Item 19 (320x220x160, 3-ply): {HIDDEN_TRUE_BUNDLE[19]} per bundle

Prices per bundle remain as offered. Regards,
Hemant Shah, Westline Packaging
""")

# ---------- 04 OrientPack: printable rate card PDF + filled questionnaire PDF + synthetic photo ----------
def orient_card_pdf():
    path=f"{OUT}/04_orientpack/OrientPack_Rate_Card_PRINT_ME.pdf"
    doc=SimpleDocTemplate(path,pagesize=A4,topMargin=30*mm,bottomMargin=16*mm,leftMargin=14*mm,rightMargin=14*mm)
    el=[Paragraph("<b>RATE CARD — Meridian Foods RFx MER-0417</b> &nbsp; Ref OP/RC/2026/0451 &nbsp; Date 01 Oct 2026",body),
        Paragraph("All prices in <b>US Dollars per 1,000 pieces, FOB Chennai</b> (freight and insurance to buyer's account). Validity 60 days. Payment 45 days. GST/duties extra as applicable.",body),Spacer(1,3*mm)]
    data=[["#","Item","Size mm","Ply","USD / 1000 pcs"]]
    for L in LINES:
        n=L["line_no"]; size=f'{L["length_mm"]}x{L["width_mm"]}' + (f'x{L["height_mm"]}' if L["height_mm"] else "")
        data.append([str(n),L["description"],size,str(L["ply"]),f'{orient[n]:,.2f}'])
    t=Table(data,colWidths=[9*mm,88*mm,30*mm,12*mm,36*mm],repeatRows=1)
    t.setStyle(TableStyle([("FONT",(0,0),(-1,-1),"Helvetica",9),("FONT",(0,0),(-1,0),"Helvetica-Bold",9),("FONT",(4,1),(4,-1),"Helvetica-Bold",9.5),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#FFF2CC")),("GRID",(0,0),(-1,-1),0.5,colors.black),("ALIGN",(4,1),(4,-1),"RIGHT"),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F7F7F7")])]))
    el.append(t); el.append(Spacer(1,3*mm))
    el.append(Paragraph("Notes: (1) FX exposure to buyer. (2) MOQ 3,000 pcs per SKU. (3) Regular lead time 6 days ex-works Chennai. Questionnaire responses attached separately.",small))
    lh=lambda c,d: letterhead(c,d,"ORIENTPACK LTD","Sriperumbudur, Chennai 602105 | A subsidiary of OrientPack Sdn Bhd, Malaysia | GSTIN 33AAACO1187E1ZQ",colors.HexColor("#7B3F00"))
    doc.build(el,onFirstPage=lh,onLaterPages=lh)
orient_card_pdf()
qd=[["Q","Question","Response"]]+[[str(q),Paragraph(t,small),Paragraph(QA["orientpack"][q][0],small)] for q,t,a,m,dq in QUESTIONS]
qt=Table(qd,colWidths=[8*mm,95*mm,73*mm]); qt.setStyle(TableStyle([("GRID",(0,0),(-1,-1),0.4,colors.grey),("FONT",(0,0),(-1,0),"Helvetica-Bold",8.5),("VALIGN",(0,0),(-1,-1),"TOP")]))
simple_pdf(f"{OUT}/04_orientpack/OrientPack_Supplier_Questionnaire_Response.pdf","Supplier Questionnaire — Response (RFx MER-0417)","ORIENTPACK LTD","Sriperumbudur, Chennai",colors.HexColor("#7B3F00"),
 ["Responses to Meridian Foods supplier questionnaire. No pricing in this document; see rate card.",qt])

# synthetic angled photo of the rate card page 1
import subprocess, re
from PIL import Image, ImageFilter, ImageDraw, ImageEnhance
subprocess.run(["pdftoppm","-r","130","-png","-f","1","-l","1",f"{OUT}/04_orientpack/OrientPack_Rate_Card_PRINT_ME.pdf",f"{OUT}/04_orientpack/_card"],check=True)
src=[f for f in os.listdir(f"{OUT}/04_orientpack") if f.startswith("_card")][0]
im=Image.open(f"{OUT}/04_orientpack/{src}").convert("RGB")
W,H=im.size
# smudge over line 14 price (approximate row position: header ~ y=? find by scanning is complex; use proportion)
# table starts after ~ 3 paragraphs; rows ~ (H*0.0208) each; estimate row 14 y
dr=ImageDraw.Draw(im,"RGBA")
# exact row-14 price bbox from pdftotext (points) -> pixels at 130 dpi
subprocess.run(["pdftotext","-bbox","-f","1","-l","1",f"{OUT}/04_orientpack/OrientPack_Rate_Card_PRINT_ME.pdf","/tmp/_op.html"],check=True)
m=re.search(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">90\.32<',open("/tmp/_op.html").read())
sc=130/72; x0,y0,x1,y1=[float(v)*sc for v in m.groups()]
# thumb shadow: fully hides the first digits, partially the rest
dr.ellipse([x0-70,y0-16,x0+(x1-x0)*0.62,y1+14],fill=(58,48,40,238))
dr.rounded_rectangle([x0+(x1-x0)*0.5,y0-5,x1+10,y1+5],radius=8,fill=(58,48,40,120))
im=im.filter(ImageFilter.GaussianBlur(0.4))
# perspective: map corners to a trapezoid + desk background
bg=Image.new("RGB",(int(W*1.25),int(H*1.15)),(96,84,70))
bd=ImageDraw.Draw(bg)
for i in range(0,bg.size[0],37): bd.line([(i,0),(i+120,bg.size[1])],fill=(104,92,78),width=2)
coeffs_src=[(0,0),(W,0),(W,H),(0,H)]
dst=[(int(W*0.14),int(H*0.06)),(int(W*1.02),int(H*0.11)),(int(W*1.12),int(H*1.08)),(int(W*0.06),int(H*1.02))]
import numpy as np
def find_coeffs(pa,pb):
    A=[]
    for p1,p2 in zip(pa,pb):
        A.append([p1[0],p1[1],1,0,0,0,-p2[0]*p1[0],-p2[0]*p1[1]]); A.append([0,0,0,p1[0],p1[1],1,-p2[1]*p1[0],-p2[1]*p1[1]])
    A=np.matrix(A,dtype=float); B=np.array(pb).reshape(8)
    return np.array(np.dot(np.linalg.inv(A.T*A)*A.T,B)).reshape(8)
c=find_coeffs(dst,coeffs_src)
warped=im.transform(bg.size,Image.PERSPECTIVE,c,Image.BICUBIC,fillcolor=(96,84,70))
mask=Image.new("L",(W,H),255).transform(bg.size,Image.PERSPECTIVE,c,Image.BICUBIC,fillcolor=0)
bg.paste(warped,(0,0),mask)
# lighting gradient + slight blur + noise
grad=Image.new("L",bg.size,0); gd=ImageDraw.Draw(grad)
for x in range(bg.size[0]): gd.line([(x,0),(x,bg.size[1])],fill=int(255*(0.78+0.22*x/bg.size[0])))
bg=Image.composite(bg,Image.new("RGB",bg.size,(20,15,10)),grad)
bg=ImageEnhance.Contrast(bg).enhance(0.92).filter(ImageFilter.GaussianBlur(0.6))
arr=np.array(bg).astype(np.int16); arr+=np.random.randint(-6,7,arr.shape,dtype=np.int16); bg=Image.fromarray(np.clip(arr,0,255).astype("uint8"))
bg.save(f"{OUT}/04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg",quality=82)
os.remove(f"{OUT}/04_orientpack/{src}")

# ---------- 05 Anand: email text + .eml ----------
anand_body=f"""Dear Sujit sir,

Ref your mail for MER-0417. Our rates for the boxes:

Rs 42/kg for the 5-ply boxes (items 1 to 12)
Rs 38/kg for the 3-ply boxes (items 13 to 22)

Sheets, layer pads and partitions (items 23 to 30) - rest same as last year, no change.

Freight extra at actuals. GST 18% extra. Payment 45 days ok. Rates valid 60 days.

Regarding your questionnaire:
1. ISO 9001 yes
2. Yes own corrugator
3. about 250 tonnes per month
4. one week for samples
5. Local bakeries, Sri Krishna Sweets, Adyar Ananda Bhavan
6. BRC audit is in process, expected by December
8. 10-12 days for regular orders
9. Only Nelamangala regularly; Hosur on request
10. Yes

Thanks & regards
Anand Kumar
Anand Box Works, Peenya 2nd Stage, Bengaluru 560058
Mob 98450 xxxxx
"""
open(f"{OUT}/05_anand/anand_email_body.txt","w").write(anand_body)
eml=f"""From: Anand Kumar <sabarishnair00+anand@gmail.com>
To: Sujit Menon <sender+rfx-mer-0417-anand@gmail.com>
Subject: Re: RFx MER-0417 - Corrugated packaging FY26-27 - Meridian Foods
Date: Thu, 02 Oct 2026 11:42:10 +0530
Message-ID: <anand-0417-1@mail.gmail.com>
Content-Type: text/plain; charset="UTF-8"

{anand_body}
> On Wed, 24 Sep 2026, Sujit Menon wrote:
> Dear Anand Kumar, Meridian Foods invites quotations for ...
"""
open(f"{OUT}/05_anand/anand_reply.eml","w").write(eml)

# ---------- GOLD KEY ----------
gold=dict(fx=dict(USD=dict(rate=FX_USD,date=FX_DATE)),tolerance_pct=1.0,cells=[],questionnaire=[],vendor_terms={})
for L in LINES:
    n=L["line_no"]; w=L["weight_per_piece_g"]
    # Balaji
    gold["cells"].append(dict(line_no=n,vendor_code="balaji",expected_state="confirmed",expected_unit_price_inr_per_1000=balaji[n],original=dict(value=balaji[n],unit="per_1000_pcs",currency="INR"),note="quoted per 1000 nos; 3% total discount NOT applied (ledger)"))
    # Kohinoor
    if n in kohinoor:
        gold["cells"].append(dict(line_no=n,vendor_code="kohinoor",expected_state="inferred",expected_unit_price_inr_per_1000=round(kohinoor[n]/0.975,2),alt_expected_unit_price_inr_per_1000=kohinoor[n],alt_expected_state="confirmed",original=dict(value=kohinoor[n],unit="per_1000_pcs",currency="INR"),note="printed rate is NET of 2.5% early-payment discount (footnote); Meridian pays at 45 days so payable = printed/0.975 → 'inferred' with discount_treatment assumption. Printed value with state 'confirmed' is accepted as alt (flagged_ok) only if a discount_treatment review item/ledger entry exists"))
    else:
        gold["cells"].append(dict(line_no=n,vendor_code="kohinoor",expected_state="not_quoted",expected_unit_price_inr_per_1000=None,note="stated 'not in our range'"))
    # Westline
    wl=westline[n]; per1000=round(wl["per_bundle"]*1000/wl["bundle_size"],2)
    if wl["stated"]:
        gold["cells"].append(dict(line_no=n,vendor_code="westline",expected_state="confirmed",expected_unit_price_inr_per_1000=per1000,original=dict(value=wl["per_bundle"],unit="per_bundle",currency="INR",pack_size=wl["bundle_size"]),note="bundle size stated in the same paragraph/table → vendor_stated basis"))
    else:
        gold["cells"].append(dict(line_no=n,vendor_code="westline",expected_state="ambiguous",expected_unit_price_inr_per_1000=None,best_guess=per1000,original=dict(value=wl["per_bundle"],unit="per_bundle",currency="INR",pack_size=None),after_clarification=dict(bundle_size=HIDDEN_TRUE_BUNDLE[n],expected_state="reviewed",expected_unit_price_inr_per_1000=round(wl["per_bundle"]*1000/HIDDEN_TRUE_BUNDLE[n],2)),note=f"bundle size NOT stated for this item; best guess {wl['bundle_size']}/bundle from same-ply pattern (ambiguous). True size per vendor's clarification reply = {HIDDEN_TRUE_BUNDLE[n]}. Before clarification: 'ambiguous' with best_guess within tolerance = correct; after clarification reply is ingested: value per after_clarification"))
    # OrientPack
    inr=round(orient[n]*FX_USD,2)
    if n==14:
        gold["cells"].append(dict(line_no=n,vendor_code="orientpack",expected_state="low_confidence",expected_unit_price_inr_per_1000=None,best_guess=inr,original=dict(value=orient[n],unit="per_1000_pcs",currency="USD"),note="row obscured in photo; any read with raw_confidence<0.6 is correct behaviour; if photo is legible and value read correctly → 'inferred' also accepted"))
    else:
        gold["cells"].append(dict(line_no=n,vendor_code="orientpack",expected_state="inferred",expected_unit_price_inr_per_1000=inr,original=dict(value=orient[n],unit="per_1000_pcs",currency="USD"),note=f"USD×{FX_USD}; FX assumption in ledger; FOB → freight excluded"))
    # Anand
    if anand[n] is not None:
        gold["cells"].append(dict(line_no=n,vendor_code="anand",expected_state="inferred",expected_unit_price_inr_per_1000=round(anand[n]*w,2),original=dict(value=anand[n],unit="per_kg",currency="INR"),note=f"₹{anand[n]}/kg × {w} g/pc = ₹{anand[n]*w:.0f} per 1000; weight from RFx spec (rfx_spec basis)"))
    else:
        gold["cells"].append(dict(line_no=n,vendor_code="anand",expected_state="references_prior",expected_unit_price_inr_per_1000=None,note="'rest same as last year' — prior pricing not on file"))
for vc,ans in QA.items():
    for q,t,a,m,dq in QUESTIONS:
        raw,exp=ans[q]
        item=dict(q_no=q,vendor_code=vc)
        if raw is None: item.update(expected_state="missing")
        elif a=="yes_no": item.update(expected_state=("ambiguous" if exp is None else "answered"),expected_bool=exp)
        elif a=="number": item.update(expected_state="answered",expected_number=exp)
        else: item.update(expected_state="answered",expected_text_contains=raw.split(",")[0].strip())
        gold["questionnaire"].append(item)
gold["vendor_terms"]={
 "balaji":dict(currency="INR",validity_days=60,freight_included=True,taxes_included=False,payment_days=45,total_discount_pct=3.0,total_discount_condition="all 30 items awarded for full year",references_prior_pricing=False,cleared_questionnaire=True,lines_priced=30),
 "kohinoor":dict(currency="INR",validity_days=30,freight_included=True,taxes_included=False,payment_days=30,total_discount_pct=None,footnote_discount_pct=2.5,footnote_condition="payment within 10 days (rates printed net)",references_prior_pricing=False,cleared_questionnaire=True,lines_priced=27,validity_short=True),
 "westline":dict(currency="INR",validity_days=60,freight_included=True,taxes_included=False,payment_days=45,references_prior_pricing=False,cleared_questionnaire=False,disqualified_by="Q6 BRC = No",lines_priced=26,ambiguous_lines=[5,9,15,19]),
 "orientpack":dict(currency="USD",validity_days=60,freight_included=False,freight_terms="FOB Chennai",taxes_included=False,payment_days=45,references_prior_pricing=False,cleared_questionnaire=True,lines_priced=29,low_confidence_lines=[14]),
 "anand":dict(currency="INR",validity_days=60,freight_included=False,freight_terms="freight extra at actuals",taxes_included=False,payment_days=45,references_prior_pricing=True,references_prior_lines=[23,24,25,26,27,28,29,30],cleared_questionnaire=None,q6_ambiguous=True,q7_missing=True,lines_priced=22),
}
json.dump(gold,open(f"{OUT}/gold/gold.json","w"),indent=1)
# gold as CSV for humans
with open(f"{OUT}/gold/gold_cells.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["line_no","vendor","expected_state","expected_inr_per_1000","best_guess","orig_value","orig_unit","orig_currency","note"])
    for c in gold["cells"]:
        o=c.get("original",{}); w.writerow([c["line_no"],c["vendor_code"],c["expected_state"],c["expected_unit_price_inr_per_1000"],c.get("best_guess"),o.get("value"),o.get("unit"),o.get("currency"),c["note"]])
print("done")
