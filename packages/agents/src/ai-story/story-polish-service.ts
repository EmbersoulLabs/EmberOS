/**
 * Provider-neutral AI Story polish service (V1 vertical slice).
 */
import { callStructuredJsonModel } from "../llm";
import {
  AiStoryStructuredDraftSchema,
  buildAiStoryContextWarnings,
  type AiStoryContextWarning,
  type AiStoryStructuredDraft,
} from "@ceo-agent/shared";
import type { ZodIssue } from "zod";

export type AiStoryPolishInput = {
  originalIdea: string;
  campaign: {
    name: string;
    objective?: string | null;
    objectiveCustom?: string | null;
    targetAudienceOverride?: string | null;
    campaignBrief?: string | null;
    goal?: string | null;
  };
  businessProfile?: {
    brandName?: string | null;
    brandTone?: string | null;
    targetAudience?: string | null;
    industry?: string | null;
    description?: string | null;
  } | null;
  assetLabels: readonly string[];
  businessProfileComplete?: boolean;
};

export type AiStoryPolishResult =
  | {
      ok: true;
      draft: AiStoryStructuredDraft;
      warnings: AiStoryContextWarning[];
      usage: { input: number; output: number; costUsd: number };
      accounting: AiStoryPlanningAccounting;
      timings: AiStoryPlanningTimings;
    }
  | {
      ok: false;
      error: string;
      failureCode:
        | "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID"
        | "AI_STORY_PLANNING_PROVIDER_TRANSPORT_FAILURE";
      errorStage: "provider" | "decode" | "validation";
      validationIssueCodes: AiStoryPlanningValidationIssueCode[];
      warnings: AiStoryContextWarning[];
      accounting?: AiStoryPlanningAccounting;
      timings: AiStoryPlanningTimings;
    };

export type AiStoryPlanningValidationIssueCode =
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_ENUM"
  | "INVALID_ARRAY_LENGTH"
  | "INVALID_SCENE_STRUCTURE"
  | "UNKNOWN_FIELD"
  | "SCHEMA_MISMATCH";

export type AiStoryPlanningAccounting = {
  provider: "openai";
  model: string;
  providerRequestId: string;
  usage: { input: number; output: number; total: number };
  cost: { amount: number; currency: "USD"; costSource: "MODEL_PRICING_TABLE" };
};

export type AiStoryPlanningTimings = {
  planningProviderMs: number;
  planningDecodeMs: number;
  planningValidationMs: number;
};

export function sanitizeAiStoryPlanningIssues(
  issues: readonly ZodIssue[]
): AiStoryPlanningValidationIssueCode[] {
  const codes = new Set<AiStoryPlanningValidationIssueCode>();
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      codes.add("UNKNOWN_FIELD");
    } else if (issue.code === "invalid_enum_value") {
      codes.add("INVALID_ENUM");
    } else if (
      issue.code === "invalid_type" &&
      issue.received === "undefined"
    ) {
      codes.add("MISSING_REQUIRED_FIELD");
    } else if (
      (issue.code === "too_big" || issue.code === "too_small") &&
      issue.type === "array"
    ) {
      codes.add("INVALID_ARRAY_LENGTH");
    } else if (issue.path[0] === "story") {
      codes.add("INVALID_SCENE_STRUCTURE");
    } else {
      codes.add("SCHEMA_MISMATCH");
    }
  }
  if (codes.size === 0) codes.add("SCHEMA_MISMATCH");
  return [...codes].sort();
}

export async function polishAiStoryDraft(
  input: AiStoryPolishInput
): Promise<AiStoryPolishResult> {
  const audience =
    input.campaign.targetAudienceOverride?.trim() ||
    input.businessProfile?.targetAudience?.trim() ||
    "";
  const objective =
    input.campaign.objectiveCustom?.trim() ||
    input.campaign.objective?.trim() ||
    input.campaign.goal?.trim() ||
    "";
  const tone = input.businessProfile?.brandTone?.trim() || "";

  const warnings = buildAiStoryContextWarnings({
    businessProfileComplete: input.businessProfileComplete,
    campaignObjective: objective,
    targetAudience: audience,
    brandTone: tone,
    assetCount: input.assetLabels.length,
  });

  const system = [
    "You are an AI marketing director for EmberOS.",
    "Convert the user's plain-language story idea into a structured Story Draft JSON object.",
    "Do not include provider-specific fields, shot lists, scene plans, or animation instructions.",
    "Use the campaign and business context when available.",
    "Return ONLY valid JSON matching the schema hint.",
  ].join(" ");

  const user = [
    `Campaign: ${input.campaign.name}`,
    objective ? `Objective: ${objective}` : "",
    audience ? `Target audience: ${audience}` : "",
    tone ? `Brand tone: ${tone}` : "",
    input.businessProfile?.brandName ? `Brand: ${input.businessProfile.brandName}` : "",
    input.businessProfile?.description
      ? `Business: ${input.businessProfile.description}`
      : "",
    input.campaign.campaignBrief ? `Brief: ${input.campaign.campaignBrief}` : "",
    input.assetLabels.length
      ? `Referenced assets: ${input.assetLabels.join("; ")}`
      : "",
    "",
    `Story idea:\n${input.originalIdea}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await callStructuredJsonModel({
      system,
      user,
      schema: AiStoryStructuredDraftSchema,
      schemaName: "ai_story_structured_draft",
    });
    const accounting: AiStoryPlanningAccounting = {
      provider: "openai",
      model: completion.modelVersion,
      providerRequestId: completion.providerRequestId,
      usage: {
        input: completion.usage.input,
        output: completion.usage.output,
        total: completion.usage.input + completion.usage.output,
      },
      cost: {
        amount: completion.usage.costUsd,
        currency: "USD",
        costSource: "MODEL_PRICING_TABLE",
      },
    };
    const validationStartedAt = performance.now();
    const result = completion.result as Record<string, unknown> | null;
    if (completion.decodeIssue || !result || typeof result !== "object") {
      return {
        ok: false,
        error: "AI Story planning output contract invalid",
        failureCode: "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID",
        errorStage: "decode",
        validationIssueCodes: ["SCHEMA_MISMATCH"],
        warnings,
        accounting,
        timings: {
          planningProviderMs: completion.timings.providerMs,
          planningDecodeMs: completion.timings.decodeMs,
          planningValidationMs: performance.now() - validationStartedAt,
        },
      };
    }
    const parsed = AiStoryStructuredDraftSchema.safeParse({
      ...result,
      assetReferences: Array.isArray(result.assetReferences)
        ? result.assetReferences.filter((v): v is string => typeof v === "string")
        : [],
      warnings: [
        ...warnings.map((w) => w.message),
        ...(Array.isArray(result.warnings)
          ? result.warnings.filter((v): v is string => typeof v === "string")
          : []),
      ],
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: "AI Story planning output contract invalid",
        failureCode: "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID",
        errorStage: "validation",
        validationIssueCodes: sanitizeAiStoryPlanningIssues(parsed.error.issues),
        warnings,
        accounting,
        timings: {
          planningProviderMs: completion.timings.providerMs,
          planningDecodeMs: completion.timings.decodeMs,
          planningValidationMs: performance.now() - validationStartedAt,
        },
      };
    }
    return {
      ok: true,
      draft: parsed.data,
      warnings,
      usage: completion.usage,
      accounting,
      timings: {
        planningProviderMs: completion.timings.providerMs,
        planningDecodeMs: completion.timings.decodeMs,
        planningValidationMs: performance.now() - validationStartedAt,
      },
    };
  } catch {
    return {
      ok: false,
      error: "AI Story planning provider request failed",
      failureCode: "AI_STORY_PLANNING_PROVIDER_TRANSPORT_FAILURE",
      errorStage: "provider",
      validationIssueCodes: [],
      warnings,
      timings: {
        planningProviderMs: 0,
        planningDecodeMs: 0,
        planningValidationMs: 0,
      },
    };
  }
}
