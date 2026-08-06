import {
  AssetDisplayNameSkillInputSchema,
  normalizeAssetDisplayNameOutput,
  type AssetDisplayNameSkillInput,
} from "@ceo-agent/shared";
import type { AiSkill, AiJsonCompletionResult, AiTokenUsage, AiProviderId } from "../types";
import { AiSkillError } from "../types";

export const ASSET_DISPLAY_NAME_SKILL_ID = "asset-display-name" as const;

export interface AssetDisplayNameSkillResult {
  displayName: string;
  metadata: {
    usage: AiTokenUsage;
    provider: AiProviderId;
    model: string;
    skillId: typeof ASSET_DISPLAY_NAME_SKILL_ID;
    promptVersion: string;
    schemaVersion: string;
  };
}

const SYSTEM_PROMPT = `You name marketing media assets for EmberOS (PD-040).
Use only the provided content intelligence (summary/labels).
Do not invent content from filenames alone.
Return a short human-readable display name (2–8 words).
No file extensions. No quotes. No brand claims.`;

const SCHEMA_HINT = '{ "displayName": "string — human-readable asset label" }';

export const AssetDisplayNameSkill: AiSkill<
  AssetDisplayNameSkillInput,
  AssetDisplayNameSkillResult
> = {
  id: ASSET_DISPLAY_NAME_SKILL_ID,
  promptVersion: "1.0.0",
  schemaVersion: "1.0.0",
  retryPolicy: { maxRetries: 0 },

  validateInput(payload: unknown): AssetDisplayNameSkillInput {
    const parsed = AssetDisplayNameSkillInputSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw new AiSkillError(
        parsed.error.issues[0]?.message ?? "Invalid skill payload",
        "INVALID_INPUT",
        parsed.error
      );
    }
    const hasIntelligence =
      Boolean(parsed.data.contentSummary?.trim()) ||
      (parsed.data.contentLabels?.length ?? 0) > 0;
    if (!hasIntelligence) {
      throw new AiSkillError(
        "Content intelligence required for AI asset naming",
        "INVALID_INPUT"
      );
    }
    return parsed.data;
  },

  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        type: input.type,
        mimeType: input.mimeType ?? null,
        contentSummary: input.contentSummary ?? null,
        contentLabels: input.contentLabels ?? [],
        // Filename for formatting context only — do not invent unseen content from it.
        originalFilename: input.originalFilename,
      }),
      schemaHint: SCHEMA_HINT,
      preferredModel: "gpt-4o-mini",
      temperature: 0.3,
    };
  },

  normalizeOutput(raw, _input, completion: AiJsonCompletionResult) {
    try {
      const output = normalizeAssetDisplayNameOutput(raw);
      return {
        displayName: output.displayName,
        metadata: {
          usage: completion.usage,
          provider: completion.provider,
          model: completion.model,
          skillId: ASSET_DISPLAY_NAME_SKILL_ID,
          promptVersion: AssetDisplayNameSkill.promptVersion,
          schemaVersion: AssetDisplayNameSkill.schemaVersion,
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
