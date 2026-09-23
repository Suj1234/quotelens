# Core dataset generator: single source of truth for lines, vendor prices, gold key.
import json, random, math, csv
random.seed(417)

FX_USD = 83.15
FX_DATE = "2026-09-23"
RATE_PER_KG = 52.0   # market base INR/kg for landed corrugated

# 30 lines: (sku, desc, ply, L, W, H, gsm, bf, type, monthly_qty, location)
lines = [
 ("MF-CB-5P-001","Export carton RSC 5-ply 600x400x400",5,600,400,400,"150/120/150/120/150",32,"box",18000,"Hosur"),
 ("MF-CB-5P-002","Export carton RSC 5-ply 500x400x300",5,500,400,300,"150/120/150/120/150",32,"box",22000,"Hosur"),
 ("MF-CB-5P-003","Shipper carton 5-ply 450x300x300",5,450,300,300,"150/120/120/120/150",28,"box",30000,"Hosur"),
 ("MF-CB-5P-004","Shipper carton 5-ply 400x300x250",5,400,300,250,"150/120/120/120/150",28,"box",35000,"Nelamangala"),
 ("MF-CB-5P-005","Shipper carton 5-ply 380x280x220",5,380,280,220,"150/120/120/120/150",28,"box",40000,"Nelamangala"),
 ("MF-CB-5P-006","Bulk carton 5-ply 700x500x450",5,700,500,450,"180/120/150/120/180",32,"box",6000,"Hosur"),
 ("MF-CB-5P-007","Tray carton 5-ply 600x400x120",5,600,400,120,"150/120/120/120/150",28,"box",15000,"Hosur"),
 ("MF-CB-5P-008","Shipper carton 5-ply 350x250x200",5,350,250,200,"150/120/120/120/150",28,"box",45000,"Nelamangala"),
 ("MF-CB-5P-009","Export carton RSC 5-ply 550x350x350",5,550,350,350,"150/120/150/120/150",32,"box",12000,"Hosur"),
 ("MF-CB-5P-010","Shipper carton 5-ply 420x320x260",5,420,320,260,"150/120/120/120/150",28,"box",28000,"Nelamangala"),
 ("MF-CB-5P-011","Heavy duty carton 5-ply 650x450x400",5,650,450,400,"180/120/150/120/180",32,"box",8000,"Hosur"),
 ("MF-CB-5P-012","Shipper carton 5-ply 300x200x200",5,300,200,200,"150/120/120/120/150",28,"box",50000,"Nelamangala"),
 ("MF-CB-3P-013","Inner carton 3-ply 300x200x150",3,300,200,150,"150/120/150",22,"box",60000,"Hosur"),
 ("MF-CB-3P-014","Inner carton 3-ply 250x180x120",3,250,180,120,"150/120/150",22,"box",80000,"Hosur"),
 ("MF-CB-3P-015","Inner carton 3-ply 350x250x180",3,350,250,180,"150/120/150",25,"box",45000,"Nelamangala"),
 ("MF-CB-3P-016","Retail carton 3-ply 200x150x100",3,200,150,100,"120/100/120",22,"box",120000,"Hosur"),
 ("MF-CB-3P-017","Retail carton 3-ply 180x120x90",3,180,120,90,"120/100/120",22,"box",150000,"Hosur"),
 ("MF-CB-3P-018","Inner carton 3-ply 400x300x200",3,400,300,200,"150/120/150",25,"box",30000,"Nelamangala"),
 ("MF-CB-3P-019","Inner carton 3-ply 320x220x160",3,320,220,160,"150/120/150",22,"box",55000,"Nelamangala"),
 ("MF-CB-3P-020","Display carton 3-ply 380x260x140",3,380,260,140,"150/120/150",25,"box",25000,"Hosur"),
 ("MF-CB-3P-021","Retail carton 3-ply 220x160x110",3,220,160,110,"120/100/120",22,"box",100000,"Nelamangala"),
 ("MF-CB-3P-022","Inner carton 3-ply 280x200x140",3,280,200,140,"150/120/150",22,"box",70000,"Hosur"),
 ("MF-SH-5P-023","Corrugated sheet 5-ply 1200x800",5,1200,800,0,"150/120/150/120/150",32,"sheet",9000,"Hosur"),
 ("MF-SH-5P-024","Corrugated sheet 5-ply 1000x700",5,1000,700,0,"150/120/120/120/150",28,"sheet",12000,"Nelamangala"),
 ("MF-SH-3P-025","Corrugated sheet 3-ply 1200x800",3,1200,800,0,"150/120/150",25,"sheet",15000,"Hosur"),
 ("MF-SH-3P-026","Corrugated sheet 3-ply 1000x700",3,1000,700,0,"150/120/150",22,"sheet",18000,"Nelamangala"),
 ("MF-SH-3P-027","Layer pad 3-ply 800x600",3,800,600,0,"120/100/120",22,"sheet",25000,"Hosur"),
 ("MF-PT-3P-028","Partition set 3-ply 12-cell for 600x400x400",3,600,400,400,"120/100/120",22,"partition",18000,"Hosur"),
 ("MF-PT-3P-029","Partition set 3-ply 6-cell for 450x300x300",3,450,300,300,"120/100/120",22,"partition",30000,"Hosur"),
 ("MF-PT-3P-030","Partition set 3-ply 24-cell for 500x400x300",3,500,400,300,"120/100/120",22,"partition",22000,"Nelamangala"),
]

def gsm_total(gsm): return sum(int(x) for x in gsm.split("/"))

def weight_g(l):
    sku,desc,ply,L,W,H,gsm,bf,typ,mq,loc = l
    g = gsm_total(gsm) * 1.12  # starch/adhesive allowance
    if typ=="box":
        area = 2*(L+W+40)*(W+H+20)/1e6   # blank area m2 (RSC)
    elif typ=="sheet":
        area = L*W/1e6
    else:  # partition set: cells
        cells = int(desc.split()[3].split("-")[0])
        area = (L*H*2 + W*H*2)/1e6 * (0.5 + cells/24)  # approx strips
    return round(area*g, 1)

LINES=[]
for i,l in enumerate(lines, start=1):
    sku,desc,ply,L,W,H,gsm,bf,typ,mq,loc = l
    w = weight_g(l)
    mq = max(500, int(round(mq/5/100))*100)  # scale volumes so annual contract ≈ ₹4.5 crore (brief's '₹4 crore' scale)
    base = round(w*RATE_PER_KG/10)*10  # INR per 1000 pcs
    LINES.append(dict(line_no=i,sku=sku,description=desc,ply=ply,length_mm=L,width_mm=W,height_mm=(H or None),
        gsm_spec=gsm,burst_factor=bf,item_type=typ,weight_per_piece_g=w,monthly_qty=mq,annual_qty=mq*12,
        delivery_location=loc,base_price_per_1000=base))

def jitter(v, pct): return v*(1+random.uniform(-pct,pct))

# ---- Vendor quotes ----
# V1 Balaji: per 1000 pcs INR, all 30, ~base*1.00, 3% total discount if awarded all lines (not applied)
balaji = {}
for L in LINES:
    balaji[L["line_no"]] = round(jitter(L["base_price_per_1000"]*1.00,0.035)/10)*10
# V2 Kohinoor: per 1000 pcs INR net of 2.5% early payment (footnote); lines 28-30 not in range; validity 30d
kohinoor = {}
for L in LINES:
    if L["line_no"] in (28,29,30): continue
    kohinoor[L["line_no"]] = round(jitter(L["base_price_per_1000"]*0.97,0.035)/10)*10
# V3 Westline: per bundle; bundle size stated except lines 5,9,15,19 (missing); sheets per bundle of 100? keep bundles
westline = {}
WEST_BUNDLE = {}
for L in LINES:
    n=L["line_no"]; typ=L["item_type"]
    if typ=="box": bs = 25 if L["ply"]==5 else 50
    elif typ=="sheet": bs = 100
    else: bs = 20
    WEST_BUNDLE[n]=bs
    per1000 = jitter(L["base_price_per_1000"]*1.03,0.035)
    per_bundle = round(per1000*bs/1000, 0)
    westline[n]=dict(per_bundle=per_bundle, bundle_size=bs, stated=(n not in (5,9,15,19)))
# V4 OrientPack: USD per 1000 pcs FOB Chennai, all 30, ~base*1.05/FX; line 14 obscured in photo
orient = {}
for L in LINES:
    orient[L["line_no"]] = round(jitter(L["base_price_per_1000"]*1.05,0.035)/FX_USD, 2)
# V5 Anand: INR/kg: 42 for 5-ply boxes (1-12), 38 for 3-ply boxes (13-22); sheets/partitions same as last year; freight extra
anand = {}
for L in LINES:
    n=L["line_no"]
    if L["item_type"]=="box":
        anand[n] = 42 if L["ply"]==5 else 38
    else:
        anand[n] = None  # references prior

# ---- Questionnaire ----
QUESTIONS = [
 (1,"Do you hold BIS or ISO 9001 certification for corrugated packaging manufacture?","yes_no",True,"no"),
 (2,"Is corrugation done in-house (own corrugator), not outsourced?","yes_no",True,None),
 (3,"What is your monthly production capacity in tonnes?","number",True,"lt:200"),
 (4,"What is your lead time for samples, in days?","number",True,None),
 (5,"Name FMCG or food clients you have supplied in the last 2 years.","text",True,None),
 (6,"Are you BRC/food-grade packaging compliant (or equivalent)?","yes_no",True,"no"),
 (7,"What is your minimum order quantity per SKU per delivery, in pieces?","number",False,None),
 (8,"What is your lead time for regular orders, in days?","number",True,None),
 (9,"Can you supply both Hosur and Nelamangala plants?","yes_no",True,None),
 (10,"Do you accept 45-day payment terms from invoice date?","yes_no",True,None),
]
# answers per vendor (raw as they'd write; bool/number/text; expected)
QA = {
 "balaji":   {1:("Yes – ISO 9001:2015 (TUV SUD), BIS IS 2771 Part 1",True),2:("Yes, two 5-ply corrugators at Hosur",True),3:("1,100 MT per month",1100),4:("5 working days",5),5:("Britannia, ITC Foods, Nandini (KMF), Hatsun",None),6:("Yes – BRCGS Packaging Materials Issue 6, Grade A",True),7:("5,000 pieces",5000),8:("7 days from PO",7),9:("Yes, both plants from Hosur unit",True),10:("Yes, 45 days accepted",True)},
 "kohinoor": {1:("ISO 9001:2015 certified",True),2:("In-house corrugation, Pune plant",True),3:("850 tonnes/month",850),4:("7 days",7),5:("Marico, Parle Agro, Tata Consumer",None),6:("BRCGS certified (AA grade)",True),7:("10,000 pcs",10000),8:("10 days",10),9:("Hosur yes; Nelamangala serviced via Bengaluru warehouse",True),10:("We request 30 days; 45 days acceptable with 2.5% early-payment discount forgone",True)},
 "westline": {1:("ISO 9001:2015",True),2:("Yes",True),3:("600 MT/month",600),4:("10 days",10),5:("Balaji Wafers, Amul (partial), Zydus Wellness",None),6:("No – BRC audit planned for Q1 2027",False),7:("8,000 pieces",8000),8:("12 days",12),9:("Yes, ex-Ahmedabad by road",True),10:("Yes",True)},
 "orientpack":{1:("Yes – ISO 9001:2015 and ISO 14001",True),2:("Yes, Chennai plant (parent: OrientPack Sdn Bhd, Malaysia)",True),3:("1,400 tonnes per month",1400),4:("4 days",4),5:("Nestle India, Unilever (HUL), Cavinkare",None),6:("Yes – BRCGS Packaging, Grade A+",True),7:("3,000 pieces",3000),8:("6 days",6),9:("Yes",True),10:("Yes",True)},
 "anand":    {1:("ISO 9001 yes",True),2:("Yes own corrugator",True),3:("about 250 tonnes",250),4:("one week",7),5:("Local bakeries, Sri Krishna Sweets, Adyar Ananda Bhavan",None),6:("BRC audit is in process, expected by December",None),7:(None,None),8:("10-12 days",10),9:("Only Nelamangala regularly; Hosur on request",True),10:("Yes",True)},
}

if __name__=="__main__":
    json.dump(dict(fx_usd=FX_USD,fx_date=FX_DATE,lines=LINES,balaji=balaji,kohinoor=kohinoor,westline=westline,orient=orient,anand=anand),open("core.json","w"),indent=1)
    print("lines", len(LINES)); 
    for L in LINES[:3]+LINES[22:24]+LINES[27:28]: print(L["line_no"],L["description"],L["weight_per_piece_g"],L["base_price_per_1000"])
