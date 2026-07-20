import {
  BusinessProfileAiAnalyzeRequestSchema,
  assessBusinessProfileAiSources,
  normalizeBusinessProfileAiAnalysis,
  type BusinessProfileAiAnalyzeRequest,
  type BusinessProfileAiMeta,
} from "@ceo-agent/shared";
import type { AiSkill, AiJsonCompletionResult, AiTokenUsage, AiProviderId } from "../types";
import { AiSkillError } from "../types";

export const BUSINESS_PROFILE_ANALYZER_SKILL_ID = "business-profile-analyzer" as const;

export interface BusinessProfileAnalyzerSkillResult {
  brandSummary: string;
  brandPersonality: string[];
  brandTone: string[];
  brandKeywords: string[];
  targetAudience: string[];
  confidence: number;
  metadata: {
    sourcesUsed: BusinessProfileAiMeta["sourcesUsed"];
    missingSources: BusinessProfileAiMeta["missingSources"];
    usage: AiTokenUsage;
    provider: AiProviderId;
    model: string;
    skillId: typeof BUSINESS_PROFILE_ANALYZER_SKILL_ID;
    promptVersion: string;
    schemaVersion: string;
  };
}

const SYSTEM_PROMPT = `You are EmberOS Business Profile AI (PROMPT-002).
Analyze the provided business context and suggest brand identity attributes.

Rules:
- Use only information supported by the input. Do not invent unsupported facts.
- If confidence is low because fields are sparse, use neutral wording.
- Avoid exaggerated marketing language, hype, or unverifiable claims.
- Optional missing fields must not prevent analysis; work with what is available.
- Do not propose campaigns, SEO strategies, or marketing plans.
- Output JSON only.`;

const SCHEMA_HINT = `{
  "brandSummary": "string — short business positioning (1-2 sentences)",
  "brandPersonality": ["Professional", "Friendly"],
  "brandTone": ["Warm", "Elegant"],
  "brandKeywords": ["Luxury Florist", "Wedding"],
  "targetAudience": ["Women 25-40", "Corporate Clients"]
}`;

function industryLabel(input: BusinessProfileAiAnalyzeRequest): string | null {
  return (
    input.industryDisplayName?.trim() ||
    input.industryCustomValue?.trim() ||
    input.industryId?.trim() ||
    null
  );
}

function buildUserPrompt(
  input: BusinessProfileAiAnalyzeRequest,
  meta: BusinessProfileAiMeta
): string {
  const context = {
    companyName: input.companyName ?? null,
    industry: industryLabel(input),
    services: input.services ?? [],
    businessDescription: input.businessDescription ?? null,
    targetAudience: input.targetAudience ?? null,
    country: input.country ?? null,
    website: input.website ?? null,
    socialMedia: {
      facebook: input.facebook ?? null,
      instagram: input.instagram ?? null,
      tiktok: input.tiktok ?? null,
      youtube: input.youtube ?? null,
      redNote: input.redNote ?? null,
      linkedIn: input.linkedIn ?? null,
    },
    logoPresent: Boolean(input.logo?.trim()),
    brandColors: input.brandColors ?? [],
    existingBrandKeywords: input.brandKeywords ?? [],
    existingBrandPersonality: input.brandPersonality ?? [],
    sourcesUsed: meta.sourcesUsed,
    missingSources: meta.missingSources,
    estimatedConfidence: meta.confidence,
  };

  return `Analyze this business context and return suggested Business Profile attributes.

Context JSON:
${JSON.stringify(context, null, 2)}

Return brandSummary, brandPersonality, brandTone, brandKeywords, and targetAudience.`;
}

export const BusinessProfileAnalyzerSkill: AiSkill<
  BusinessProfileAiAnalyzeRequest,
  BusinessProfileAnalyzerSkillResult
> = {
  id: BUSINESS_PROFILE_ANALYZER_SKILL_ID,
  promptVersion: "1.0.0",
  schemaVersion: "1.0.0",
  retryPolicy: { maxRetries: 1 },

  validateInput(payload: unknown): BusinessProfileAiAnalyzeRequest {
    const parsed = BusinessProfileAiAnalyzeRequestSchema.safeParse(payload ?? {});
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
    const meta = assessBusinessProfileAiSources(input);
    return {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input, meta),
      schemaHint: SCHEMA_HINT,
      preferredModel: "gpt-4o-mini",
      temperature: 0.7,
    };
  },

  normalizeOutput(raw, input, completion: AiJsonCompletionResult) {
    try {
      const analysis = normalizeBusinessProfileAiAnalysis(raw);
      const meta = assessBusinessProfileAiSources(input);
      return {
        brandSummary: analysis.brandSummary,
        brandPersonality: analysis.brandPersonality,
        brandTone: analysis.brandTone,
        brandKeywords: analysis.brandKeywords,
        targetAudience: analysis.targetAudience,
        confidence: meta.confidence,
        metadata: {
          sourcesUsed: meta.sourcesUsed,
          missingSources: meta.missingSources,
          usage: completion.usage,
          provider: completion.provider,
          model: completion.model,
          skillId: BUSINESS_PROFILE_ANALYZER_SKILL_ID,
          promptVersion: BusinessProfileAnalyzerSkill.promptVersion,
          schemaVersion: BusinessProfileAnalyzerSkill.schemaVersion,
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
