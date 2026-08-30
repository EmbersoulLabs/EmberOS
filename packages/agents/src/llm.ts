import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { LLM_BUDGET_PER_TASK_USD, CEO_MAX_RETRIES } from "@ceo-agent/shared";
import type { TaskGraph } from "@ceo-agent/shared";

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export type StructuredJsonDecodeIssue =
  | "INVALID_JSON"
  | "MISSING_CONTENT"
  | "PROVIDER_REFUSAL";

export type StructuredJsonModelCompletion = {
  result: unknown;
  decodeIssue?: StructuredJsonDecodeIssue;
  providerRequestId: string;
  modelVersion: string;
  usage: { input: number; output: number; costUsd: number };
  timings: { providerMs: number; decodeMs: number };
};

function openAiTokenCost(
  model: "gpt-4o-mini" | "gpt-4o",
  input: number,
  output: number
): number {
  // Canonical pricing authority for the currently allowed JSON models.
  const [inRate, outRate] = model === "gpt-4o" ? [2.5, 10] : [0.15, 0.6];
  return (input * inRate + output * outRate) / 1_000_000;
}

/**
 * Strict structured-output call derived directly from a canonical Zod schema.
 * The response body is decoded but never retained here. Canonical application
 * validation remains the caller's responsibility.
 */
export async function callStructuredJsonModel<T>(input: {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  model?: "gpt-4o-mini" | "gpt-4o";
}): Promise<StructuredJsonModelCompletion> {
  const openai = getOpenAI();
  const model = input.model ?? "gpt-4o-mini";
  const providerStartedAt = performance.now();
  const response = await openai.chat.completions.create(
    {
      model,
      response_format: zodResponseFormat(input.schema, input.schemaName),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.7,
    },
    { maxRetries: 0 }
  );
  const providerMs = performance.now() - providerStartedAt;
  const message = response.choices[0]?.message;
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const usage = {
    input: inputTokens,
    output: outputTokens,
    costUsd: openAiTokenCost(model, inputTokens, outputTokens),
  };

  const decodeStartedAt = performance.now();
  const content = message?.content;
  if (message?.refusal) {
    return {
      result: null,
      decodeIssue: "PROVIDER_REFUSAL",
      providerRequestId: response.id,
      modelVersion: response.model,
      usage,
      timings: { providerMs, decodeMs: performance.now() - decodeStartedAt },
    };
  }
  if (!content) {
    return {
      result: null,
      decodeIssue: "MISSING_CONTENT",
      providerRequestId: response.id,
      modelVersion: response.model,
      usage,
      timings: { providerMs, decodeMs: performance.now() - decodeStartedAt },
    };
  }
  try {
    const result: unknown = JSON.parse(content);
    return {
      result,
      providerRequestId: response.id,
      modelVersion: response.model,
      usage,
      timings: { providerMs, decodeMs: performance.now() - decodeStartedAt },
    };
  } catch {
    return {
      result: null,
      decodeIssue: "INVALID_JSON",
      providerRequestId: response.id,
      modelVersion: response.model,
      usage,
      timings: { providerMs, decodeMs: performance.now() - decodeStartedAt },
    };
  }
}

export async function callJsonModel<T>(
  system: string,
  user: string,
  schemaHint: string,
  options?: { model?: "gpt-4o-mini" | "gpt-4o" }
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  const openai = getOpenAI();
  const model = options?.model ?? "gpt-4o-mini";
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = openAiTokenCost(model, input, output);

  return { result: JSON.parse(content) as T, usage: { input, output, costUsd } };
}

/** GPT-4o vision for frame analysis (higher cost than gpt-4o-mini). */
export async function callVisionJsonModel<T>(
  system: string,
  userText: string,
  imageDataUrls: string[],
  schemaHint: string
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          ...imageDataUrls.slice(0, 8).map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ],
      },
    ],
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = (input * 2.5 + output * 10) / 1_000_000;

  return { result: JSON.parse(content) as T, usage: { input, output, costUsd } };
}

export function buildDefaultTaskGraph(): TaskGraph {
  return {
    version: "1.0",
    steps: [
      { id: "parse_intent", agent: "ceo", dependsOn: [] },
      { id: "strategy_plan", agent: "strategy", dependsOn: ["parse_intent"] },
      { id: "ceo_plan", agent: "ceo", dependsOn: ["strategy_plan"] },
      { id: "vision_analyze", agent: "vision", dependsOn: ["ceo_plan"] },
      { id: "content_generate", agent: "marketing_content", dependsOn: ["vision_analyze", "strategy_plan"] },
      { id: "hook_generate", agent: "hook", dependsOn: ["content_generate"] },
      { id: "copy_generate", agent: "copy", dependsOn: ["content_generate"] },
      { id: "edit_director_plan", agent: "edit", dependsOn: ["copy_generate", "vision_analyze"] },
      { id: "ffmpeg_render", agent: "worker", dependsOn: ["edit_director_plan"] },
      { id: "compliance_check", agent: "compliance", dependsOn: ["ffmpeg_render", "copy_generate"] },
      { id: "marketing_score", agent: "score", dependsOn: ["compliance_check"] },
      { id: "human_review", agent: "human", dependsOn: ["marketing_score"] },
      { id: "platform_adapt", agent: "publish", dependsOn: ["human_review"] },
    ],
    retryPolicy: {
      maxRetries: CEO_MAX_RETRIES,
      onCopyReject: ["copy_generate", "compliance_check"],
      onEditReject: ["edit_director_plan", "ffmpeg_render", "compliance_check"],
    },
    costBudgetUsd: LLM_BUDGET_PER_TASK_USD,
  };
}
