/**
 * PD-013 Business Profile analysis — thin compatibility facade over PD-014 Skill Runner.
 * Prefer `executeSkill("business-profile-analyzer", payload)` for new call sites.
 */
import type { BusinessProfileAiAnalyzeRequest } from "@ceo-agent/shared";
import { executeSkill } from "./skills/runner/skill-runner";

export async function analyzeBusinessProfileWithAi(input: BusinessProfileAiAnalyzeRequest) {
  const result = await executeSkill("business-profile-analyzer", input);
  return {
    analysis: {
      brandSummary: result.brandSummary,
      brandPersonality: result.brandPersonality,
      brandTone: result.brandTone,
      brandKeywords: result.brandKeywords,
      targetAudience: result.targetAudience,
    },
    meta: {
      confidence: result.confidence,
      sourcesUsed: result.metadata.sourcesUsed,
      missingSources: result.metadata.missingSources,
    },
    usage: result.metadata.usage,
  };
}
