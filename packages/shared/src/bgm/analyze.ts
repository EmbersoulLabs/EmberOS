import type { CampaignMarketingGoal, ContentStyle, VoicePreset } from "../campaign-brief";
import type { Platform } from "../types/index";

/** Input context for BGM analysis and recommendation. */
export interface BgmRecommendContext {
  userPreference?: string | null;
  industry?: string | null;
  campaignGoal?: CampaignMarketingGoal | null;
  contentStyle?: ContentStyle | null;
  voicePreset?: VoicePreset | null;
  campaignBrief?: string | null;
  goal?: string | null;
  visionHooks?: string[];
  platform?: Platform | null;
  videoArchetype?: VideoContentArchetype | null;
  clipVariant?: string | null;
  pacing?: "slow" | "medium" | "fast" | null;
  energyLevel?: BgmEnergyLevel | null;
  emotionalTone?: BgmEmotionalTone | null;
  excludeTrackIds?: string[];
}

/** Detected energy for auto-mix and track matching. */
export const BGM_ENERGY_LEVELS = ["low", "medium", "high"] as const;
export type BgmEnergyLevel = (typeof BGM_ENERGY_LEVELS)[number];

/** Marketing emotional tone inferred from business + content. */
export const BGM_EMOTIONAL_TONES = [
  "professional",
  "luxury",
  "elegant",
  "relaxing",
  "romantic",
  "inspirational",
  "premium",
  "playful",
  "exciting",
] as const;
export type BgmEmotionalTone = (typeof BGM_EMOTIONAL_TONES)[number];

/** Video Studio content archetype — drives BGM variation across multiplied outputs. */
export const VIDEO_CONTENT_ARCHETYPES = [
  "sales",
  "story",
  "educational",
  "engagement",
  "trend",
] as const;
export type VideoContentArchetype = (typeof VIDEO_CONTENT_ARCHETYPES)[number];

export interface BgmContentAnalysis {
  energyLevel: BgmEnergyLevel;
  emotionalTone: BgmEmotionalTone;
  contentType: VideoContentArchetype;
  industry: string | null;
  pacing: "slow" | "medium" | "fast";
  platformFit: Platform | null;
}

function contextText(ctx: BgmRecommendContext): string {
  return [
    ctx.campaignBrief,
    ctx.goal,
    ctx.industry,
    ...(ctx.visionHooks ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function inferIndustry(text: string): string | null {
  if (/花|鲜花|花艺|玫瑰|bouquet|florist|flower/i.test(text)) return "florist";
  if (/咖啡|coffee|café|cafe|咖啡店/i.test(text)) return "cafe";
  if (/餐|美食|餐厅|restaurant|food/i.test(text)) return "restaurant";
  if (/宠物|pet|grooming/i.test(text)) return "pet";
  if (/房产|楼盘|property|real estate/i.test(text)) return "real_estate";
  if (/教育|课程|education|tutorial/i.test(text)) return "education";
  if (/美|美甲|beauty|salon|护肤|美容/i.test(text)) return "beauty";
  if (/零售|retail|shop|store|促销/i.test(text)) return "retail";
  if (/科技|tech|saas|software/i.test(text)) return "tech";
  return null;
}

export function archetypeFromClipVariant(
  variant?: "overall" | "hook" | "product" | "story" | "cta" | string | null
): VideoContentArchetype {
  switch (variant) {
    case "hook":
      return "engagement";
    case "product":
      return "sales";
    case "story":
      return "story";
    case "cta":
      return "sales";
    case "overall":
    default:
      return "engagement";
  }
}

function pacingFromArchetype(archetype: VideoContentArchetype): "slow" | "medium" | "fast" {
  switch (archetype) {
    case "trend":
    case "engagement":
    case "sales":
      return "fast";
    case "educational":
      return "medium";
    case "story":
      return "slow";
    default:
      return "medium";
  }
}

function energyFromArchetype(
  archetype: VideoContentArchetype,
  platform?: Platform | null
): BgmEnergyLevel {
  if (archetype === "trend" || archetype === "engagement") return "high";
  if (archetype === "sales") return "high";
  if (archetype === "story") return "medium";
  if (platform === "tiktok" || platform === "douyin") return "medium";
  return "medium";
}

function toneFromIndustryAndArchetype(
  industry: string | null,
  archetype: VideoContentArchetype,
  contentStyle?: ContentStyle | null
): BgmEmotionalTone {
  if (contentStyle === "luxury_brand" || industry === "florist" || industry === "beauty") {
    return archetype === "sales" ? "elegant" : "luxury";
  }
  if (industry === "cafe" || industry === "restaurant") {
    return archetype === "sales" ? "playful" : "relaxing";
  }
  if (industry === "retail") return archetype === "sales" ? "exciting" : "premium";
  if (archetype === "educational") return "inspirational";
  if (archetype === "story") return "inspirational";
  if (archetype === "engagement" || archetype === "trend") return "exciting";
  if (archetype === "sales") return "premium";
  return "professional";
}

function archetypeFromGoal(goal?: CampaignMarketingGoal | null): VideoContentArchetype | null {
  switch (goal) {
    case "more_sales":
    case "more_leads":
      return "sales";
    case "more_engagement":
      return "engagement";
    case "more_views":
      return "trend";
    case "brand_awareness":
      return "story";
    default:
      return null;
  }
}

/** Infer BGM analysis dimensions from campaign + video context (no LLM). */
export function analyzeBgmContext(ctx: BgmRecommendContext): BgmContentAnalysis {
  const text = contextText(ctx);
  const industry = inferIndustry(text) ?? ctx.industry?.toLowerCase() ?? null;
  const contentType =
    ctx.videoArchetype ??
    archetypeFromGoal(ctx.campaignGoal) ??
    archetypeFromClipVariant(ctx.clipVariant);

  const pacing = ctx.pacing ?? pacingFromArchetype(contentType);
  const energyLevel = ctx.energyLevel ?? energyFromArchetype(contentType, ctx.platform);
  const emotionalTone =
    ctx.emotionalTone ?? toneFromIndustryAndArchetype(industry, contentType, ctx.contentStyle);

  return {
    energyLevel,
    emotionalTone,
    contentType,
    industry,
    pacing,
    platformFit: ctx.platform ?? null,
  };
}

/** Preferred track IDs per industry + archetype (royalty-free library). */
export const BGM_ARCHETYPE_TRACK_POOL: Record<
  string,
  Partial<Record<VideoContentArchetype, string[]>>
> = {
  florist: {
    sales: ["retail_upbeat", "luxury_soft_piano", "emotional_warm"],
    story: ["emotional_warm", "luxury_strings", "retail_upbeat"],
    educational: ["inspirational_uplift", "luxury_piano", "luxury_soft_piano"],
    engagement: ["cafe_upbeat", "florist_soft", "emotional_warm"],
    trend: ["upbeat_energy", "retail_upbeat"],
  },
  cafe: {
    sales: ["cafe_upbeat", "retail_upbeat", "lifestyle_acoustic"],
    story: ["lifestyle_acoustic", "emotional_warm", "coffeehouse_calm"],
    educational: ["lifestyle_acoustic", "inspirational_uplift"],
    engagement: ["cafe_upbeat", "upbeat_energy"],
    trend: ["upbeat_energy", "retail_promotion"],
  },
  beauty: {
    sales: ["retail_upbeat", "modern_luxury_pop", "emotional_warm"],
    story: ["emotional_warm", "luxury_strings", "retail_upbeat"],
    educational: ["modern_luxury_pop", "inspirational_uplift"],
    engagement: ["cafe_upbeat", "modern_luxury_pop"],
    trend: ["upbeat_energy", "retail_upbeat"],
  },
  retail: {
    sales: ["retail_upbeat", "retail_promotion", "upbeat_energy"],
    story: ["lifestyle_acoustic", "emotional_warm", "storytelling_narrative"],
    educational: ["inspirational_uplift", "corporate_inspirational"],
    engagement: ["upbeat_energy", "cafe_upbeat"],
    trend: ["upbeat_energy", "retail_promotion"],
  },
  default: {
    sales: ["retail_upbeat", "luxury_soft_piano", "emotional_warm"],
    story: ["emotional_warm", "luxury_strings", "retail_upbeat"],
    educational: ["inspirational_uplift", "lifestyle_acoustic", "luxury_soft_piano"],
    engagement: ["cafe_upbeat", "luxury_soft_piano", "emotional_warm"],
    trend: ["upbeat_energy", "retail_upbeat"],
  },
};

export function trackPoolForAnalysis(analysis: BgmContentAnalysis): string[] {
  const key = analysis.industry && BGM_ARCHETYPE_TRACK_POOL[analysis.industry]
    ? analysis.industry
    : "default";
  const pool = BGM_ARCHETYPE_TRACK_POOL[key]![analysis.contentType] ??
    BGM_ARCHETYPE_TRACK_POOL.default![analysis.contentType]!;
  return pool;
}
