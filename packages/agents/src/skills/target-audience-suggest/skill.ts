import {
  TargetAudienceSuggestSkillInputSchema,
  normalizeTargetAudienceSuggestOutput,
  type TargetAudienceSuggestSkillInput,
} from "@ceo-agent/shared";
import type { AiSkill, AiJsonCompletionResult, AiTokenUsage, AiProviderId } from "../types";
import { AiSkillError } from "../types";

export const TARGET_AUDIENCE_SUGGEST_SKILL_ID = "target-audience-suggest" as const;

export interface TargetAudienceSuggestSkillResult {
  text: string;
  metadata: {
    usage: AiTokenUsage;
    provider: AiProviderId;
    model: string;
    skillId: typeof TARGET_AUDIENCE_SUGGEST_SKILL_ID;
    promptVersion: string;
    schemaVersion: string;
  };
}

const SYSTEM_PROMPT = `You suggest a Target Audience for an EmberOS Campaign (PD-043).
Return exactly one concise audience proposal as JSON.
Do not return multiple alternatives.
Ground the suggestion in the provided Campaign Objective, Publishing Platforms, Campaign Description, Business Profile, and Workspace Language.
Do not invent unsupported business facts.`;

const SCHEMA_HINT = '{ "text": "string — single Target Audience proposal" }';

export const TargetAudienceSuggestSkill: AiSkill<
  TargetAudienceSuggestSkillInput,
  TargetAudienceSuggestSkillResult
> = {
  id: TARGET_AUDIENCE_SUGGEST_SKILL_ID,
  promptVersion: "1.0.0",
  schemaVersion: "1.0.0",
  retryPolicy: { maxRetries: 1 },

  validateInput(payload: unknown): TargetAudienceSuggestSkillInput {
    const parsed = TargetAudienceSuggestSkillInputSchema.safeParse(payload ?? {});
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
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        objective: input.objective ?? null,
        platforms: input.platforms ?? [],
        description: input.description ?? null,
        businessProfileSummary: input.businessProfileSummary ?? null,
        workspaceLanguage: input.workspaceLanguage ?? null,
        currentAudience: input.currentAudience ?? null,
      }),
      schemaHint: SCHEMA_HINT,
      preferredModel: "gpt-4o-mini",
      temperature: 0.4,
    };
  },

  normalizeOutput(raw, _input, completion: AiJsonCompletionResult) {
    try {
      const output = normalizeTargetAudienceSuggestOutput(raw);
      return {
        text: output.text,
        metadata: {
          usage: completion.usage,
          provider: completion.provider,
          model: completion.model,
          skillId: TARGET_AUDIENCE_SUGGEST_SKILL_ID,
          promptVersion: TargetAudienceSuggestSkill.promptVersion,
          schemaVersion: TargetAudienceSuggestSkill.schemaVersion,
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
