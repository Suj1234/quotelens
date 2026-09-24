import { describe, expect, it } from "vitest";
import { formatTag, parseTag } from "./tag";

const TAGS = ["rfx-mer-0419-westline", "rfx-mer-0419-balaji", "rfx-mer-0419-testsupplier", "rfx-mer-0419-testsupplier2", "rfx-mer-04-westline", "rfx-mer-04-2-westline"];

describe("reply tags (TRD §15.1)", () => {
  it("formats plain and clarification tags", () => {
    expect(formatTag("MER-0419", "westline")).toBe("rfx-mer-0419-westline");
    expect(formatTag("MER-0419", "westline", 2)).toBe("rfx-mer-0419-westline-clar-2");
  });
  it("reads a plus-address", () => {
    expect(parseTag("Sujit <sourcing+rfx-mer-0419-westline@meridianfoods.example>", TAGS)).toEqual({ reply_tag: "rfx-mer-0419-westline", clar_n: null });
  });
  it("reads a bare tag in a subject, and -clar-n", () => {
    expect(parseTag("Re: prices [rfx-mer-0419-balaji]", TAGS)).toEqual({ reply_tag: "rfx-mer-0419-balaji", clar_n: null });
    expect(parseTag("sourcing+rfx-mer-0419-westline-clar-2@meridianfoods.example", TAGS)).toEqual({ reply_tag: "rfx-mer-0419-westline", clar_n: 2 });
  });
  it("ignores case", () => {
    expect(parseTag("SOURCING+RFX-MER-0419-WESTLINE-CLAR-1@MERIDIANFOODS.EXAMPLE", TAGS)).toEqual({ reply_tag: "rfx-mer-0419-westline", clar_n: 1 });
  });
  it("keeps vendor codes with digits apart", () => {
    expect(parseTag("x+rfx-mer-0419-testsupplier2@y.example", TAGS)?.reply_tag).toBe("rfx-mer-0419-testsupplier2");
    expect(parseTag("x+rfx-mer-0419-testsupplier@y.example", TAGS)?.reply_tag).toBe("rfx-mer-0419-testsupplier");
  });
  it("keeps RFx codes that share a prefix apart", () => {
    expect(parseTag("x+rfx-mer-04-2-westline@y.example", TAGS)?.reply_tag).toBe("rfx-mer-04-2-westline");
    expect(parseTag("x+rfx-mer-04-westline@y.example", TAGS)?.reply_tag).toBe("rfx-mer-04-westline");
  });
  it("returns null when no known tag is present", () => {
    expect(parseTag("Re: RFx MER-0419 quotation", TAGS)).toBeNull();
    expect(parseTag("x+rfx-mer-0419-westlinex@y.example", TAGS)).toBeNull();
    expect(parseTag(null, TAGS)).toBeNull();
  });
});
