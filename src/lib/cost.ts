// Cost of one model call from Gemini's usageMetadata (migration 0012). Pure parts are unit-tested in cost.test.ts.
export type Usage = {
  promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number; totalTokenCount?: number; promptTokensDetails?: { modality?: string; tokenCount?: number }[];
};
export type Price = { id: string; input_usd_per_mtok: number; cached_input_usd_per_mtok: number | null; output_usd_per_mtok: number };

/** Token columns for model_calls. Input tokens include the cached ones (Gemini API reference: promptTokenCount). */
export function usageColumns(u: Usage | undefined) {
  const by = (m: string) => u?.promptTokensDetails?.find((d) => d.modality === m)?.tokenCount ?? null;
  return {
    input_tokens: u?.promptTokenCount ?? null, output_tokens: u?.candidatesTokenCount ?? null,
    input_text_tokens: by("TEXT"), input_image_tokens: by("IMAGE"), input_document_tokens: by("DOCUMENT"), input_audio_tokens: by("AUDIO"), input_video_tokens: by("VIDEO"),
    cached_input_tokens: u?.cachedContentTokenCount ?? null, tool_use_prompt_tokens: u?.toolUsePromptTokenCount ?? null,
    thinking_tokens: u?.thoughtsTokenCount ?? null, total_tokens: u?.totalTokenCount ?? null,
  };
}

/**
 * USD = ((input − cached + tool-use) × input price + cached × cached price + (output + thinking) × output price) ÷ 1,000,000.
 * Cached tokens without a cached price are billed as normal input.
 */
export function costUsd(u: Usage, p: Price): number {
  const input = u.promptTokenCount ?? 0, cached = Math.min(u.cachedContentTokenCount ?? 0, input);
  const cachedPrice = p.cached_input_usd_per_mtok ?? p.input_usd_per_mtok;
  const usd = ((input - cached + (u.toolUsePromptTokenCount ?? 0)) * p.input_usd_per_mtok + cached * cachedPrice
    + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * p.output_usd_per_mtok) / 1e6;
  return Math.round(usd * 1e8) / 1e8;
}
