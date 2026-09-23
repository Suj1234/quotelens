import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { cleanEmail } from "./email";
import { preprocess } from "./index";
import * as XLSX from "xlsx";
import { xlsxToText } from "./xlsx";
import { docxToText } from "./docx";
import { splitPdf } from "./pdf";

const seed = (p: string) => fs.readFileSync(`supabase/seed/${p}`);

describe("xlsx", () => {
  const { text } = xlsxToText(seed("realistic/01_balaji/Qtn SBP-0912 Meridian.xlsx"));
  test("keeps cell refs and text-formatted numbers verbatim", () => {
    expect(text).toContain("H22=84,080/-");
    expect(text).toContain("H12=70610");
    expect(text).toMatch(/\[row 12\] .*C12=SBP-1001/);
  });
  test("appends cell comments and keeps 'revised' text", () => {
    expect(text).toContain("H18=41810 (revised) [comment: Revised from 13200 after paper cost increase - RK]");
  });
  test("reads every non-empty sheet and drops empty ones", () => {
    expect(text).toContain('=== sheet "Questionnaire" ===');
    expect(text).toContain("B4=1,100 MT per month");
    expect(text).not.toContain('"Sheet3"');
  });
  test("keeps hidden rows but marks them", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Item", "Rate"], ["Box A", 100], ["Box B", 200]]);
    ws["!rows"] = [{}, { hidden: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quote");
    const text = xlsxToText(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true })).text;
    expect(text).toContain("[row 2] (hidden) A2=Box A B2=100");
    expect(text).toContain("[row 3] A3=Box B B3=200");
  });
});

describe("docx", async () => {
  const text = await docxToText(seed("realistic/03_westline/Westline offer Meridian Foods Sept26.docx"));
  test("numbers paragraphs and keeps prose prices", () => {
    expect(text).toMatch(/^\[p 1\] WESTLINE PACKAGING/);
    expect(text).toContain("item 1 (600x400x400) Rs 1,709/- per bundle of 25 nos");
    expect(text).toContain("Item 5 and item 9 we can offer at Rs 699/- and Rs 1,374/- per bundle resp.");
  });
  test("turns tables into pipe rows", () => {
    expect(text).toMatch(/\[table 1 row 1\] .+ \| .+/);
  });
});

describe("email", () => {
  const realistic = cleanEmail(fs.readFileSync("supabase/seed/realistic/05_anand/anand_email_realistic.txt", "utf8"));
  test("drops the quoted RFx and everything after 'Sent from my'", () => {
    expect(realistic).not.toMatch(/invites quotations|wrote:|^\[l \d+\] >/m);
    expect(realistic).not.toContain("Sent from my iPhone");
  });
  test("keeps the vendor's own prices and answers, numbered", () => {
    expect(realistic).toMatch(/\[l \d+\] 5 ply boxes \(item 1 to 12\) - Rs\.42\/- per kg/);
    expect(realistic).toContain("6 BRC audit is in process, expecting by Dec");
    expect(realistic.startsWith("[l 1] Sujit sir good morning,")).toBe(true);
  });
  test("strips '-- ' signatures and 'On … wrote:' tails", () => {
    expect(cleanEmail("Rate 10\n-- \nBob\nPhone")).toBe("[l 1] Rate 10");
    expect(cleanEmail("Rate 10\n\nOn Mon, 1 Oct 2026, Sujit wrote:\nold stuff")).toBe("[l 1] Rate 10");
  });
});

describe("dispatch", () => {
  test("eml → cleaned body with headers", async () => {
    const r = await preprocess("anand_reply.eml", seed("05_anand/anand_reply.eml"));
    expect(r.mode).toBe("text");
    if (r.mode === "text") expect(r.text).toMatch(/Rs 42\/kg for the 5-ply boxes/);
  });
  test("pdf → page count, photo → oriented PNG ≤ 2000px", async () => {
    const pdf = await preprocess("k.pdf", seed("02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf"));
    expect(pdf).toMatchObject({ mode: "pdf", pageCount: 2 });
    const img = await preprocess("p.jpg", seed("04_orientpack/OrientPack_Rate_Card_PHOTO_synthetic.jpg"));
    expect(img.mode).toBe("image");
    if (img.mode === "image") expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(2000);
  });
  test("short PDFs are not split", async () => {
    expect(await splitPdf(seed("02_kohinoor/Kohinoor_Quotation_KC-2026-1187.pdf"))).toHaveLength(1);
  });
  test("unknown types are flagged, not crashed on", async () => {
    expect(await preprocess("x.zip", Buffer.from("PK"))).toMatchObject({ mode: "unsupported" });
  });
});
