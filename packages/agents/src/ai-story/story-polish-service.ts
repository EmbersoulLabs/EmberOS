/**
 * Provider-neutral AI Story polish service (V1 vertical slice).
 */
import { callJsonModel } from "../llm";
import {
  AiStoryStructuredDraftSchema,
  buildAiStoryContextWarnings,
  type AiStoryContextWarning,
  type AiStoryStructuredDraft,
} from "@ceo-agent/shared";

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
    }
  | { ok: false; error: string; warnings: AiStoryContextWarning[] };

const SCHEMA_HINT = JSON.stringify({
  title: "string",
  summary: "string",
  objective: "string",
  targetAudience: "string",
  tone: "string",
  estimatedDuration: "string e.g. 30s or 60s",
  story: { opening: "string", development: "string", ending: "string" },
  keyMessages: ["string"],
  cta: "string",
  assetReferences: ["uuid strings for selected assets if known"],
  warnings: ["string — optional generation notes"],
});

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
    const { result, usage } = await callJsonModel<Record<string, unknown>>(system, user, SCHEMA_HINT);
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
        error: "AI returned malformed Story Draft structure",
        warnings,
      };
    }
    return { ok: true, draft: parsed.data, warnings, usage };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Story polish failed",
      warnings,
    };
  }
}
