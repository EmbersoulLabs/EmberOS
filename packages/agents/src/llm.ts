import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AsyncLocalStorage } from "node:async_hooks";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { LLM_BUDGET_PER_TASK_USD, CEO_MAX_RETRIES } from "@ceo-agent/shared";
import type { TaskGraph } from "@ceo-agent/shared";
import {
  CertificationPlanningAuthorityService,
  CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS,
  CERTIFICATION_PLANNING_MODEL,
  type CertificationPlanningIdentity,
  type CertificationPlanningStage,
} from "@ceo-agent/db";

export type CertificationPlanningModelAdapter = {
  complete(request: ChatCompletionCreateParamsNonStreaming, options?: { maxRetries: number }): Promise<ChatCompletion>;
};

/** The only network-capable completion adapter. Certification tests inject a fake here. */
export const realCertificationPlanningModelAdapter: CertificationPlanningModelAdapter = {
  complete: (request, options) => getOpenAI().chat.completions.create(request, options),
};

type CertificationCallContext = CertificationPlanningIdentity & {
  logicalCallSuffix: string;
  providerAttemptId?: string;
  modelAdapter?: CertificationPlanningModelAdapter;
};
const certificationCallContext = new AsyncLocalStorage<CertificationCallContext>();
export function withCertificationPlanningContext<T>(context: CertificationCallContext, run: () => Promise<T>): Promise<T> {
  return certificationCallContext.run(context, run);
}

function certificationModelAdapter(): CertificationPlanningModelAdapter {
  return certificationCallContext.getStore()?.modelAdapter ?? realCertificationPlanningModelAdapter;
}

async function claimCertificationCall(stage: CertificationPlanningStage | undefined, model: string) {
  const context = certificationCallContext.getStore();
  if (!context) return null;
  if (!stage || model !== CERTIFICATION_PLANNING_MODEL) throw new Error("PLANNING_CALL_CONTRACT_INVALID");
  const authority = new CertificationPlanningAuthorityService();
  const claim = await authority.claim({
    ...context,
    logicalCallIdentity: `${stage}:${context.logicalCallSuffix}`,
    stage,
    model: CERTIFICATION_PLANNING_MODEL,
    maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[stage],
    maxRetries: 0,
    providerAttemptId: context.providerAttemptId,
    claimedAt: new Date().toISOString(),
  });
  return { authority, claim, maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[stage] };
}

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  // Resolve fetch when the client is constructed. The SDK otherwise captures
  // fetch at module import time, before an isolated test can install its guard.
  return new OpenAI({ apiKey, fetch: globalThis.fetch });
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
  model: "gpt-4o-mini" | "gpt-4o-mini-2024-07-18" | "gpt-4o",
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
  model?: "gpt-4o-mini" | "gpt-4o-mini-2024-07-18" | "gpt-4o";
}): Promise<StructuredJsonModelCompletion> {
  if (certificationCallContext.getStore() && input.model && input.model !== CERTIFICATION_PLANNING_MODEL) throw new Error("PLANNING_MODEL_MISMATCH");
  const model = certificationCallContext.getStore() ? CERTIFICATION_PLANNING_MODEL : (input.model ?? "gpt-4o-mini");
  const certification = await claimCertificationCall("story_polish", model);
  const providerStartedAt = performance.now();
  let response;
  try {
    response = await certificationModelAdapter().complete(
    {
      model,
      ...(certification ? { max_tokens: certification.maxOutputTokens } : {}),
      response_format: zodResponseFormat(input.schema, input.schemaName),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.7,
    },
    { maxRetries: 0 }
  );
  } catch (error) {
    if (certification) await certification.authority.failUnknown({ planningClaimId: certification.claim.planningClaimId, completedAt: new Date().toISOString() });
    throw error;
  }
  if (certification) {
    if (!response.usage || !Number.isInteger(response.usage.prompt_tokens) || !Number.isInteger(response.usage.completion_tokens)) {
      await certification.authority.failUnknown({ planningClaimId: certification.claim.planningClaimId, completedAt: new Date().toISOString() });
      throw new Error("PLANNING_PROVIDER_USAGE_MISSING");
    }
    await certification.authority.settle({ planningClaimId: certification.claim.planningClaimId, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, providerRequestId: response.id, completedAt: new Date().toISOString() });
  }
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
  options?: { model?: "gpt-4o-mini" | "gpt-4o-mini-2024-07-18" | "gpt-4o"; certificationStage?: CertificationPlanningStage }
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  if (certificationCallContext.getStore() && options?.model && options.model !== CERTIFICATION_PLANNING_MODEL) throw new Error("PLANNING_MODEL_MISMATCH");
  const model = certificationCallContext.getStore() ? CERTIFICATION_PLANNING_MODEL : (options?.model ?? "gpt-4o-mini");
  const certification = await claimCertificationCall(options?.certificationStage, model);
  let response;
  try {
    response = await certificationModelAdapter().complete({
    model,
    ...(certification ? { max_tokens: certification.maxOutputTokens } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  }, certification ? { maxRetries: 0 } : undefined);
  } catch (error) {
    if (certification) await certification.authority.failUnknown({ planningClaimId: certification.claim.planningClaimId, completedAt: new Date().toISOString() });
    throw error;
  }
  if (certification) {
    if (!response.usage || !Number.isInteger(response.usage.prompt_tokens) || !Number.isInteger(response.usage.completion_tokens)) {
      await certification.authority.failUnknown({ planningClaimId: certification.claim.planningClaimId, completedAt: new Date().toISOString() });
      throw new Error("PLANNING_PROVIDER_USAGE_MISSING");
    }
    await certification.authority.settle({ planningClaimId: certification.claim.planningClaimId, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, providerRequestId: response.id, completedAt: new Date().toISOString() });
  }

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
  schemaHint: string,
  requestOptions?: { maxRetries: number }
): Promise<{
  result: T;
  usage: { input: number; output: number; costUsd: number };
  providerRequestId: string | null;
  requestedModelId: "gpt-4o";
  providerModelId: string | null;
}> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create(
    {
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
    },
    requestOptions
  );

  const content = response.choices[0]?.message?.content ?? "{}";
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = (input * 2.5 + output * 10) / 1_000_000;

  return {
    result: JSON.parse(content) as T,
    usage: { input, output, costUsd },
    providerRequestId: response.id ?? null,
    requestedModelId: "gpt-4o",
    providerModelId: response.model ?? null,
  };
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
