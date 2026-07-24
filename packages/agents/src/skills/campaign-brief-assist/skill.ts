import {
  CampaignBriefAssistSkillInputSchema,
  normalizeCampaignBriefAssistOutput,
  type CampaignBriefAssistSkillInput,
} from "@ceo-agent/shared";
import type { AiSkill, AiJsonCompletionResult, AiTokenUsage, AiProviderId } from "../types";
import { AiSkillError } from "../types";

export const CAMPAIGN_BRIEF_ASSIST_SKILL_ID = "campaign-brief-assist" as const;

export interface CampaignBriefAssistSkillResult {
  text: string;
  action: CampaignBriefAssistSkillInput["action"];
  metadata: {
    usage: AiTokenUsage;
    provider: AiProviderId;
    model: string;
    skillId: typeof CAMPAIGN_BRIEF_ASSIST_SKILL_ID;
    promptVersion: string;
    schemaVersion: string;
    action: CampaignBriefAssistSkillInput["action"];
  };
}

const ACTION_RULES: Record<CampaignBriefAssistSkillInput["action"], string> = {
  polish:
    "Improve wording, grammar, clarity, and structure without changing meaning or campaign direction. Do not invent new facts, offers, products, audiences, or claims.",
  expand:
    "Expand the short idea into one sufficiently complete Campaign Brief using only the provided text and optional campaign context. Do not invent unsupported business facts, offers, products, audiences, or claims.",
  shorten:
    "Condense the text while preserving essential meaning, constraints, and user intent. Do not invent new content.",
};

const SYSTEM_PROMPT = `You assist with Campaign Brief writing for EmberOS (PD-041).
Return exactly one proposed brief result as JSON.
Never return multiple versions, rewrite styles, or alternatives.
Never invent unsupported business facts.`;

const SCHEMA_HINT = '{ "text": "string — single proposed Campaign Brief" }';

export const CampaignBriefAssistSkill: AiSkill<
  CampaignBriefAssistSkillInput,
  CampaignBriefAssistSkillResult
> = {
  id: CAMPAIGN_BRIEF_ASSIST_SKILL_ID,
  promptVersion: "1.0.0",
  schemaVersion: "1.0.0",
  retryPolicy: { maxRetries: 1 },

  validateInput(payload: unknown): CampaignBriefAssistSkillInput {
    const parsed = CampaignBriefAssistSkillInputSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw new AiSkillError(
        parsed.error.issues[0]?.message ?? "Invalid skill payload",
        "INVALID_INPUT",
        parsed.error
      );
    }
    return parsed.data;
  },

  buildPrompt(input) {
    return {
      system: `${SYSTEM_PROMPT}\n\nAction rules: ${ACTION_RULES[input.action]}`,
      user: JSON.stringify({
        action: input.action,
        currentBrief: input.text,
        campaignName: input.campaignName ?? null,
        objective: input.objective ?? null,
        platforms: input.platforms ?? [],
        targetAudience: input.targetAudience ?? null,
      }),
      schemaHint: SCHEMA_HINT,
      preferredModel: "gpt-4o-mini",
      temperature: 0.5,
    };
  },

  normalizeOutput(raw, input, completion: AiJsonCompletionResult) {
    try {
      const output = normalizeCampaignBriefAssistOutput(raw);
      return {
        text: output.text,
        action: input.action,
        metadata: {
          usage: completion.usage,
          provider: completion.provider,
          model: completion.model,
          skillId: CAMPAIGN_BRIEF_ASSIST_SKILL_ID,
          promptVersion: CampaignBriefAssistSkill.promptVersion,
          schemaVersion: CampaignBriefAssistSkill.schemaVersion,
          action: input.action,
        },
      };
    } catch (error) {
      throw new AiSkillError(
        (error as Error).message ?? "Failed to normalize skill output",
        "NORMALIZE_FAILED",
        error
      );
    }
  },
};
