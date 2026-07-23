/**
 * PD-040 asset naming — business feature entry.
 * Uses Skill Runner only when approved content intelligence is present.
 * Never imports providers/prompts/models.
 */
import { randomUUID } from "node:crypto";
import {
  extractAssetContentIntelligence,
  fallbackAssetDisplayName,
} from "@ceo-agent/shared";
import { executeSkill, AiSkillError } from "@ceo-agent/agents";
import { logAiSkillFailure } from "@/lib/ai-skill-log";

export async function suggestReadableAssetName(input: {
  originalFilename: string;
  type: string;
  mimeType?: string | null;
  metadata?: Record<string, unknown> | null;
  campaignId?: string;
  assetId?: string;
  workspaceId?: string;
}): Promise<{ displayName: string; source: "ai" | "fallback" }> {
  const fallback = fallbackAssetDisplayName(input.originalFilename);
  const intelligence = extractAssetContentIntelligence(input.metadata);

  if (!intelligence.available) {
    return { displayName: fallback, source: "fallback" };
  }

  try {
    const result = await executeSkill("asset-display-name", {
      originalFilename: input.originalFilename,
      type: input.type,
      mimeType: input.mimeType ?? null,
      contentSummary: intelligence.contentSummary ?? undefined,
      contentLabels:
        intelligence.contentLabels.length > 0 ? intelligence.contentLabels : undefined,
    });
    const name = result.displayName?.trim();
    if (!name || name.length < 2) {
      return { displayName: fallback, source: "fallback" };
    }
    return { displayName: name, source: "ai" };
  } catch (error) {
    const skillError = error instanceof AiSkillError ? error : null;
    const code = skillError?.code;
    logAiSkillFailure({
      correlationId: randomUUID(),
      skillId: "asset-display-name",
      action: "name",
      campaignId: input.campaignId,
      assetId: input.assetId,
      workspaceId: input.workspaceId,
      code: code ?? "UNKNOWN",
      resultState:
        code === "PROVIDER_UNAVAILABLE"
          ? "unavailable"
          : code === "INVALID_INPUT"
            ? "invalid_input"
            : code === "NORMALIZE_FAILED"
              ? "normalize_failed"
              : "failed",
    });
    return { displayName: fallback, source: "fallback" };
  }
}
