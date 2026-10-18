export const OPENAI_EFFICIENT_MODEL = "gpt-6-luna" as const;
export const OPENAI_QUALITY_MODEL = "gpt-6.1-sol" as const;

export const OPENAI_LEGACY_MODELS = [
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o",
] as const;

export const OPENAI_TEXT_MODELS = [
  OPENAI_EFFICIENT_MODEL,
  OPENAI_QUALITY_MODEL,
  ...OPENAI_LEGACY_MODELS,
] as const;

export type OpenAiTextModel = (typeof OPENAI_TEXT_MODELS)[number];

export function isOpenAiTextModel(value: string): value is OpenAiTextModel {
  return (OPENAI_TEXT_MODELS as readonly string[]).includes(value);
}

const STANDARD_USD_PER_MILLION: Record<OpenAiTextModel, Readonly<{ input: number; output: number }>> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export function openAiTokenCostUsd(model: OpenAiTextModel, input: number, output: number): number {
  const rate = STANDARD_USD_PER_MILLION[model];
  return (input * rate.input + output * rate.output) / 1_000_000;
}

export function openAiChatControls(model: OpenAiTextModel, maxCompletionTokens?: number) {
  return {
    ...(model === OPENAI_EFFICIENT_MODEL
      ? { reasoning_effort: "none" as const }
      : model === OPENAI_QUALITY_MODEL
        ? { reasoning_effort: "low" as const }
        : {}),
    ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}),
  };
}
