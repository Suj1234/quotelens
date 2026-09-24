import { describe, expect, it } from "vitest";
import { costUsd, usageColumns } from "./cost";

const flashLite = { id: "p", input_usd_per_mtok: 0.3, cached_input_usd_per_mtok: 0.03, output_usd_per_mtok: 2.5 };

describe("model call cost (migration 0012)", () => {
  it("input + output + thinking at the model's prices", () => {
    // 10,000 in × 0.30 + (1,000 out + 2,000 thinking) × 2.50 = 0.003 + 0.0075
    expect(costUsd({ promptTokenCount: 10_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 2_000 }, flashLite)).toBeCloseTo(0.0105, 10);
  });
  it("cached tokens are part of the input and billed at the cached price; tool-use prompt tokens as input", () => {
    // (10,000 − 4,000 + 500) × 0.30 + 4,000 × 0.03 + 0 = 0.00195 + 0.00012
    expect(costUsd({ promptTokenCount: 10_000, cachedContentTokenCount: 4_000, toolUsePromptTokenCount: 500 }, flashLite)).toBeCloseTo(0.00207, 10);
  });
  it("no cached price → cached tokens at the input price; missing counts are 0", () => {
    expect(costUsd({ promptTokenCount: 1_000_000, cachedContentTokenCount: 1_000_000 }, { ...flashLite, cached_input_usd_per_mtok: null })).toBeCloseTo(0.3, 10);
    expect(costUsd({}, flashLite)).toBe(0);
  });
  it("token columns: input split by modality (a PDF + an image + text)", () => {
    const c = usageColumns({ promptTokenCount: 3_100, candidatesTokenCount: 200, thoughtsTokenCount: 50, totalTokenCount: 3_350,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 300 }, { modality: "DOCUMENT", tokenCount: 1_548 }, { modality: "IMAGE", tokenCount: 1_252 }] });
    expect(c).toMatchObject({ input_tokens: 3_100, input_text_tokens: 300, input_document_tokens: 1_548, input_image_tokens: 1_252, input_audio_tokens: null, thinking_tokens: 50, output_tokens: 200, total_tokens: 3_350 });
  });
});
