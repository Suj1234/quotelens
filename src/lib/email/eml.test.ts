import { describe, expect, it } from "vitest";
import { simpleParser } from "mailparser";
import { buildEml } from "./index";

describe(".eml round trip (nodemailer → mailparser)", () => {
  it("keeps headers, the tagged Reply-To, threading and attachments", async () => {
    const xlsx = Buffer.from("PK\u0003\u0004 fake xlsx bytes");
    const pdf = Buffer.from("%PDF-1.4 fake");
    const { eml, messageId } = await buildEml({
      from: '"Sujit Menon (Meridian Foods)" <sujit.menon@meridianfoods.example>', to: "sales@westline.example",
      reply_to: "sourcing+rfx-mer-0419-westline-clar-1@meridianfoods.example", subject: "Clarification — RFx MER-0419", text: "Dear team,\n\nPlease state the bundle size.",
      attachments: [{ filename: "MER-0419_Line_Sheet.xlsx", content: xlsx }, { filename: "MER-0419_Supplier_Questionnaire.pdf", content: pdf, contentType: "application/pdf" }],
      in_reply_to: "<dispatch-1@meridianfoods.example>",
    });
    expect(messageId).toMatch(/^<.+@meridianfoods\.example>$/);
    const m = await simpleParser(eml);
    expect(m.messageId).toBe(messageId);
    expect(m.replyTo?.text).toContain("rfx-mer-0419-westline-clar-1");
    expect(m.inReplyTo).toBe("<dispatch-1@meridianfoods.example>");
    expect(m.references).toBe("<dispatch-1@meridianfoods.example>");
    expect(m.from?.value[0].name).toBe("Sujit Menon (Meridian Foods)");
    expect(m.subject).toBe("Clarification — RFx MER-0419");
    expect(m.text?.trim()).toBe("Dear team,\n\nPlease state the bundle size.");
    expect(m.attachments.map((a) => a.filename)).toEqual(["MER-0419_Line_Sheet.xlsx", "MER-0419_Supplier_Questionnaire.pdf"]);
    expect(m.attachments[0].content.equals(xlsx)).toBe(true);
    expect(m.attachments[1].content.equals(pdf)).toBe(true);
  });
});
