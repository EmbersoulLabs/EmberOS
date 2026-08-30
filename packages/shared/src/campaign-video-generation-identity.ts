import { z } from "zod";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";
import { PlatformSchema } from "./types/index";
import { CONTENT_STYLES, VOICE_PRESETS } from "./campaign-brief";
import { BGM_USER_PREFERENCES } from "./bgm/library";
import { BGM_START_PREFERENCES } from "./bgm/start-offset";

export const CAMPAIGN_VIDEO_GENERATION_IDENTITY_VERSION = 1 as const;
export const CAMPAIGN_VIDEO_EXECUTION_CONTRACT = "campaign-video-generation-v1" as const;
const nullableText = z.string().nullable();

export const CampaignVideoGenerationIdentityV1Schema = z.object({
  version: z.literal(1),
  executionContract: z.literal(CAMPAIGN_VIDEO_EXECUTION_CONTRACT),
  authority: z.object({ organizationId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid() }).strict(),
  generation: z.object({
    campaignName: z.string().min(1), effectiveGoal: z.string().min(1),
    campaignBrief: nullableText, targetAudience: nullableText,
    platforms: z.array(PlatformSchema), contentLocale: z.enum(["en", "zh", "ms"]),
    treatment: z.object({
      contentStyle: z.enum(CONTENT_STYLES).nullable(), voicePreset: z.enum(VOICE_PRESETS),
      bgmPreference: z.enum(BGM_USER_PREFERENCES), bgmStartPreference: z.enum(BGM_START_PREFERENCES),
      renderPreferences: z.object({ subtitleStyle: z.enum(["minimal", "corporate", "modern", "social"]), subtitleLanguage: z.enum(["zh", "en", "ms", "zh_en", "en_zh", "zh_ms", "en_ms"]) }).strict(),
    }).strict(),
    businessContext: z.object({
      industry: nullableText, tone: nullableText, bannedWords: z.array(z.string().min(1)),
      cta: nullableText, targetAudience: nullableText, locale: z.string().min(1), logoObjectReference: nullableText,
    }).strict(),
    sources: z.array(z.object({ assetId: z.string().uuid(), contentHash: SourceAssetContentHashSchema, mediaKind: z.enum(["video", "image"]) }).strict()).min(1),
  }).strict(),
}).strict();

export type CampaignVideoGenerationIdentityV1 = z.infer<typeof CampaignVideoGenerationIdentityV1Schema>;
export const CampaignVideoGenerationFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const textOrNull = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const normalizedSet = (values: readonly string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

export function normalizeCampaignVideoGenerationIdentityV1(input: CampaignVideoGenerationIdentityV1): CampaignVideoGenerationIdentityV1 {
  return CampaignVideoGenerationIdentityV1Schema.parse({
    ...input,
    generation: {
      ...input.generation,
      campaignName: input.generation.campaignName.trim(), effectiveGoal: input.generation.effectiveGoal.trim(),
      campaignBrief: textOrNull(input.generation.campaignBrief), targetAudience: textOrNull(input.generation.targetAudience),
      platforms: normalizedSet(input.generation.platforms),
      businessContext: {
        industry: textOrNull(input.generation.businessContext.industry), tone: textOrNull(input.generation.businessContext.tone),
        bannedWords: normalizedSet(input.generation.businessContext.bannedWords), cta: textOrNull(input.generation.businessContext.cta),
        targetAudience: textOrNull(input.generation.businessContext.targetAudience), locale: input.generation.businessContext.locale.trim(),
        logoObjectReference: textOrNull(input.generation.businessContext.logoObjectReference),
      },
    },
  });
}
