import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ZodType } from "zod";
import { LLM_BUDGET_PER_TASK_USD, CEO_MAX_RETRIES } from "@ceo-agent/shared";
import type { TaskGraph } from "@ceo-agent/shared";
import { controlledSelfUseProviderFetch, withCertificationPlanningHttpGrant } from "./controlled-self-use-provider-context";
import {
  CertificationPlanningAuthorityService,
  CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS,
  CERTIFICATION_PLANNING_MODEL,
  isCertificationPlanningModel,
  type CertificationPlanningModel,
  type CertificationPlanningHttpGrant,
  type CertificationPlanningIdentity,
  type CertificationPlanningStage,
} from "@ceo-agent/db";
import {
  OPENAI_EFFICIENT_MODEL,
  OPENAI_QUALITY_MODEL,
  openAiChatControls,
  openAiTokenCostUsd,
  type OpenAiTextModel,
} from "./openai-model-policy";

export type CertificationPlanningModelAdapter = {
  complete(request: ChatCompletionCreateParamsNonStreaming, options?: { maxRetries: number }): Promise<ChatCompletion>;
};

/** The only network-capable completion adapter. Certification tests inject a fake here. */
export const realCertificationPlanningModelAdapter: CertificationPlanningModelAdapter = {
  complete: async (request, options) => (await getOpenAI()).chat.completions.create(request, options),
};

type CertificationCallContext = CertificationPlanningIdentity & {
  logicalCallSuffix: string;
  model?: CertificationPlanningModel;
  providerAttemptId?: string;
  modelAdapter?: CertificationPlanningModelAdapter;
};
const certificationCallContext = new AsyncLocalStorage<CertificationCallContext>();
const openAiModelAdapterContext = new AsyncLocalStorage<CertificationPlanningModelAdapter>();
export function withCertificationPlanningContext<T>(context: CertificationCallContext, run: () => Promise<T>): Promise<T> {
  return certificationCallContext.run(context, run);
}

/** Test seam at the real request boundary. It does not weaken production authorization. */
export function withOpenAiModelAdapter<T>(adapter: CertificationPlanningModelAdapter, run: () => Promise<T>): Promise<T> {
  return openAiModelAdapterContext.run(adapter, run);
}

function certificationModelAdapter(): CertificationPlanningModelAdapter {
  return certificationCallContext.getStore()?.modelAdapter
    ?? openAiModelAdapterContext.getStore()
    ?? realCertificationPlanningModelAdapter;
}

async function claimCertificationCall(stage: CertificationPlanningStage | undefined, model: string) {
  const context = certificationCallContext.getStore();
  if (!context) return null;
  if (!stage || !isCertificationPlanningModel(model)) throw new Error("PLANNING_CALL_CONTRACT_INVALID");
  const authority = new CertificationPlanningAuthorityService();
  const logicalCallIdentity = `${stage}:${context.logicalCallSuffix}`;
  const claim = await authority.claim({
    ...context,
    logicalCallIdentity,
    stage,
    model,
    maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[stage],
    maxRetries: 0,
    providerAttemptId: context.providerAttemptId,
    claimedAt: new Date().toISOString(),
  });
  const httpGrant: CertificationPlanningHttpGrant = {
    planningClaimId: claim.planningClaimId,
    environment: context.environment,
    certificationRunId: context.certificationRunId,
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    campaignId: context.campaignId,
    storyId: context.storyId,
    actorUserId: context.actorUserId,
    logicalCallIdentity,
    model,
  };
  return { authority, claim, maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[stage], httpGrant };
}

function completeWithCertificationGrant<T>(
  certification: { httpGrant: CertificationPlanningHttpGrant } | null,
  run: () => Promise<T>
): Promise<T> {
  return certification ? withCertificationPlanningHttpGrant(certification.httpGrant, run) : run();
}

export async function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai");
  // Resolve fetch when the client is constructed. The SDK otherwise captures
  // fetch at module import time, before an isolated test can install its guard.
  return new OpenAI({ apiKey, fetch: controlledSelfUseProviderFetch, maxRetries: 0 });
}

export type StructuredJsonDecodeIssue =
  | "INVALID_JSON"
  | "MISSING_CONTENT"
  | "PROVIDER_REFUSAL"
  | "TRUNCATED";

export type StructuredJsonModelCompletion = {
  result: unknown;
  decodeIssue?: StructuredJsonDecodeIssue;
  providerRequestId: string;
  modelVersion: string;
  usage: { input: number; output: number; costUsd: number };
  timings: { providerMs: number; decodeMs: number };
};

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
  model?: OpenAiTextModel;
  certificationStage?: CertificationPlanningStage;
  /** Required by bounded user-initiated calls; certification supplies its own limit. */
  maxOutputTokens?: number;
}): Promise<StructuredJsonModelCompletion> {
  const certificationContext = certificationCallContext.getStore();
  const certificationModel = certificationContext?.model ?? CERTIFICATION_PLANNING_MODEL;
  if (certificationContext && input.model && input.model !== certificationModel) throw new Error("PLANNING_MODEL_MISMATCH");
  const model = certificationContext ? certificationModel : (input.model ?? OPENAI_EFFICIENT_MODEL);
  const certification = await claimCertificationCall(input.certificationStage ?? "story_polish", model);
  const { zodResponseFormat } = await import("openai/helpers/zod");
  const providerStartedAt = performance.now();
  let response;
  try {
    response = await completeWithCertificationGrant(certification, () => certificationModelAdapter().complete(
    {
      model,
      ...openAiChatControls(model, certification?.maxOutputTokens ?? input.maxOutputTokens),
      response_format: zodResponseFormat(input.schema, input.schemaName),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      ...(model === OPENAI_QUALITY_MODEL ? {} : { temperature: 0.7 }),
    },
    { maxRetries: 0 }
  ));
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
    costUsd: openAiTokenCostUsd(model, inputTokens, outputTokens),
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
  if (response.choices[0]?.finish_reason === "length") {
    return {
      result: null,
      decodeIssue: "TRUNCATED",
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
  options?: { model?: OpenAiTextModel; certificationStage?: CertificationPlanningStage }
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  const certificationContext = certificationCallContext.getStore();
  const certificationModel = certificationContext?.model ?? CERTIFICATION_PLANNING_MODEL;
  if (certificationContext && options?.model && options.model !== certificationModel) throw new Error("PLANNING_MODEL_MISMATCH");
  const model = certificationContext ? certificationModel : (options?.model ?? OPENAI_EFFICIENT_MODEL);
  const certification = await claimCertificationCall(options?.certificationStage, model);
  let response;
  try {
    response = await completeWithCertificationGrant(certification, () => certificationModelAdapter().complete({
    model,
    ...openAiChatControls(model, certification?.maxOutputTokens),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      { role: "user", content: user },
    ],
    ...(model === OPENAI_QUALITY_MODEL ? {} : { temperature: 0.7 }),
  }, certification ? { maxRetries: 0 } : undefined));
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

  const message = response.choices[0]?.message;
  if (message?.refusal) throw new Error("OPENAI_PROVIDER_REFUSAL");
  if (response.choices[0]?.finish_reason === "length") throw new Error("OPENAI_OUTPUT_TRUNCATED");
  const content = message?.content;
  if (!content) throw new Error("OPENAI_OUTPUT_MISSING");
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = openAiTokenCostUsd(model, input, output);

  return { result: JSON.parse(content) as T, usage: { input, output, costUsd } };
}

/** Low-cost vision extraction. Quality-sensitive visual QC uses the separate quality model. */
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
  requestedModelId: typeof OPENAI_EFFICIENT_MODEL;
  providerModelId: string | null;
}> {
  const openai = await getOpenAI();
  const response = await openai.chat.completions.create(
    {
      model: OPENAI_EFFICIENT_MODEL,
      ...openAiChatControls(OPENAI_EFFICIENT_MODEL),
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
  const costUsd = openAiTokenCostUsd(OPENAI_EFFICIENT_MODEL, input, output);

  return {
    result: JSON.parse(content) as T,
    usage: { input, output, costUsd },
    providerRequestId: response.id ?? null,
    requestedModelId: OPENAI_EFFICIENT_MODEL,
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
