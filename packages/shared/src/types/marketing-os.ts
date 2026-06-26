import { z } from "zod";
import { PlatformSchema, type Platform } from "./index";

export const IndustrySchema = z.enum([
  "florist",
  "wedding",
  "restaurant",
  "retail",
  "beauty",
  "real_estate",
  "phone_buyback",
  "b2b_saas",
  "education",
  "general",
]);
export type Industry = z.infer<typeof IndustrySchema>;

export const StrategyAudienceSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  location: z.string().optional(),
  interests: z.array(z.string()).default([]),
  buyingIntent: z.string().optional(),
  painPoints: z.array(z.string()).default([]),
  desiredOutcome: z.string().optional(),
});
export type StrategyAudience = z.infer<typeof StrategyAudienceSchema>;

export const StrategyHashtagsSchema = z.object({
  industry: z.array(z.string()).default([]),
  local: z.array(z.string()).default([]),
  trending: z.array(z.string()).default([]),
  seo: z.array(z.string()).default([]),
});
export type StrategyHashtags = z.infer<typeof StrategyHashtagsSchema>;

export const StrategyPlanSchema = z.object({
  industry: z.string(),
  businessType: z.string(),
  product: z.string(),
  marketingGoal: z.string(),
  marketingAngle: z.string(),
  brandPersonality: z.array(z.string()).default([]),
  tone: z.string(),
  videoStyle: z.string(),
  audience: StrategyAudienceSchema,
  customerJourney: z.string(),
  platformPriority: z.array(z.string()),
  ctaStrategy: z.string(),
  keywords: z.array(z.string()).default([]),
  hashtags: StrategyHashtagsSchema,
  confidence: z.number().min(0).max(1).default(0.85),
});
export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;

/** Summarize audience object for downstream copy/CEO prompts. */
export function strategyAudienceSummary(plan: StrategyPlan): string {
  const a = plan.audience;
  const parts = [
    a.age,
    a.gender,
    a.location,
    a.interests.length ? a.interests.join(", ") : undefined,
    a.buyingIntent,
    a.desiredOutcome,
  ].filter(Boolean);
  return parts.join(" · ") || plan.product || "General audience";
}

export function strategyPainPoints(plan: StrategyPlan): string[] {
  return plan.audience.painPoints ?? [];
}

export function strategyObjectives(plan: StrategyPlan): string[] {
  const goals = [plan.marketingGoal].filter(Boolean);
  if (plan.customerJourney) goals.push(plan.customerJourney);
  return goals;
}

const PLATFORM_NAME_TO_ID: Record<string, Platform> = {
  tiktok: "tiktok",
  instagram: "instagram",
  xiaohongshu: "xiaohongshu",
  douyin: "douyin",
  小红书: "xiaohongshu",
  抖音: "douyin",
};

/** Map strategy platform labels to known Platform ids for rendering/copy mix. */
export function resolveStrategyPlatforms(
  plan: StrategyPlan,
  fallbackPlatforms: string[] = []
): Platform[] {
  const fromPlan = plan.platformPriority
    .map((p) => {
      const key = p.toLowerCase().replace(/\s+/g, "");
      return PLATFORM_NAME_TO_ID[key] ?? (PLATFORM_NAME_TO_ID[p.toLowerCase()] as Platform | undefined);
    })
    .filter((p): p is Platform => Boolean(p));

  const unique = [...new Set(fromPlan)];
  if (unique.length) return unique;

  const fromFallback = fallbackPlatforms.filter((p): p is Platform =>
    (PlatformSchema.options as readonly string[]).includes(p)
  );
  return fromFallback.length ? fromFallback : ["tiktok"];
}

/** Map free-form industry label to internal Industry enum for knowledge seeds. */
export function resolveStrategyIndustryEnum(
  plan: StrategyPlan,
  fallback: Industry = "general"
): Industry {
  const text = `${plan.industry} ${plan.businessType} ${plan.product}`.toLowerCase();
  if (/erp|saas|software|b2b|企业|进销存/.test(text)) return "b2b_saas";
  if (/wedding|婚|新娘|婚车/.test(text)) return "wedding";
  if (/florist|花|花艺|花束/.test(text)) return "florist";
  if (/restaurant|caf[eé]|餐|美食|烘焙|bakery/.test(text)) return "restaurant";
  if (/retail|零售|shop|store|fashion|服饰/.test(text)) return "retail";
  if (/beauty|美|护肤|化妆|salon/.test(text)) return "beauty";
  if (/real.?estate|property|房|地产/.test(text)) return "real_estate";
  if (/phone|mobile|回收|buyback/.test(text)) return "phone_buyback";
  if (/education|培训|课程|school/.test(text)) return "education";
  if ((IndustrySchema.options as readonly string[]).includes(plan.industry)) {
    return plan.industry as Industry;
  }
  return fallback;
}

/** Accept new or legacy strategy JSON stored on tasks/campaigns. */
export function normalizeStrategyPlan(raw: unknown, seed?: Partial<StrategyPlan>): StrategyPlan {
  const parsed = StrategyPlanSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const legacy = raw as Record<string, unknown> | null;
  if (legacy && typeof legacy.marketingAngle === "string") {
    const painPoints = Array.isArray(legacy.painPoints)
      ? (legacy.painPoints as string[])
      : [];
    return StrategyPlanSchema.parse({
      industry: String(legacy.industry ?? seed?.industry ?? "general"),
      businessType: seed?.businessType ?? "",
      product: seed?.product ?? "",
      marketingGoal:
        (Array.isArray(legacy.objectives) ? legacy.objectives[0] : undefined) ??
        seed?.marketingGoal ??
        "Brand Awareness",
      marketingAngle: legacy.marketingAngle,
      brandPersonality: seed?.brandPersonality ?? [],
      tone: seed?.tone ?? "Professional",
      videoStyle: seed?.videoStyle ?? "Product Showcase",
      audience: {
        painPoints,
        desiredOutcome: typeof legacy.targetAudience === "string" ? legacy.targetAudience : undefined,
        interests: [],
      },
      customerJourney: seed?.customerJourney ?? "Awareness",
      platformPriority: Array.isArray(legacy.platformPriority)
        ? (legacy.platformPriority as string[])
        : (seed?.platformPriority ?? []),
      ctaStrategy: String(legacy.ctaStrategy ?? seed?.ctaStrategy ?? "Learn More"),
      keywords: seed?.keywords ?? [],
      hashtags: seed?.hashtags ?? { industry: [], local: [], trending: [], seo: [] },
      confidence: typeof legacy.confidence === "number" ? legacy.confidence : 0.75,
    });
  }

  return StrategyPlanSchema.parse({
    industry: seed?.industry ?? "general",
    businessType: seed?.businessType ?? "",
    product: seed?.product ?? "",
    marketingGoal: seed?.marketingGoal ?? "Brand Awareness",
    marketingAngle: seed?.marketingAngle ?? "Show real value",
    brandPersonality: seed?.brandPersonality ?? [],
    tone: seed?.tone ?? "Professional",
    videoStyle: seed?.videoStyle ?? "Product Showcase",
    audience: seed?.audience ?? { painPoints: [], interests: [] },
    customerJourney: seed?.customerJourney ?? "Awareness",
    platformPriority: seed?.platformPriority ?? [],
    ctaStrategy: seed?.ctaStrategy ?? "Learn More",
    keywords: seed?.keywords ?? [],
    hashtags: seed?.hashtags ?? { industry: [], local: [], trending: [], seo: [] },
    confidence: seed?.confidence ?? 0.65,
  });
}

export const HookTypeSchema = z.enum(["curiosity", "problem", "emotional", "offer"]);
export type HookType = z.infer<typeof HookTypeSchema>;

export const HookItemSchema = z.object({
  id: z.string(),
  type: HookTypeSchema,
  text: z.string(),
  rationale: z.string().optional(),
});
export type HookItem = z.infer<typeof HookItemSchema>;

export const HookSetSchema = z.object({
  hooks: z.array(HookItemSchema),
  recommendedHookId: z.string().optional(),
});
export type HookSet = z.infer<typeof HookSetSchema>;

export const MarketingScoreSchema = z.object({
  overallScore: z.number().min(0).max(100),
  hookScore: z.number().min(0).max(100),
  visualScore: z.number().min(0).max(100),
  copyScore: z.number().min(0).max(100),
  ctaScore: z.number().min(0).max(100),
  platformFitScore: z.number().min(0).max(100),
  improvements: z.array(z.string()),
  scoredAt: z.string(),
});
export type MarketingScore = z.infer<typeof MarketingScoreSchema>;

export const KnowledgeSnippetSchema = z.object({
  category: z.enum(["hook", "cta", "angle", "template"]),
  hookType: HookTypeSchema.optional(),
  text: z.string(),
  locale: z.string().default("zh-CN"),
});
export type KnowledgeSnippet = z.infer<typeof KnowledgeSnippetSchema>;

export const VoiceScriptsSchema = z.object({
  "15s": z.string().default(""),
  "30s": z.string().default(""),
  "60s": z.string().default(""),
});
export type VoiceScripts = z.infer<typeof VoiceScriptsSchema>;

export const SubtitleTimelineSegmentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  text: z.string(),
  role: z.string().optional(),
});
export type SubtitleTimelineSegment = z.infer<typeof SubtitleTimelineSegmentSchema>;

export const MarketingCaptionsSchema = z.object({
  tiktok: z.string().default(""),
  instagram: z.string().default(""),
  facebook: z.string().default(""),
  linkedin: z.string().default(""),
  xiaohongshu: z.string().default(""),
  youtubeShorts: z.string().default(""),
  googleBusiness: z.string().default(""),
});
export type MarketingCaptions = z.infer<typeof MarketingCaptionsSchema>;

export const ContentHookItemSchema = z.object({
  text: z.string(),
  type: z.string(),
});
export type ContentHookItem = z.infer<typeof ContentHookItemSchema>;

export const ContentCtaItemSchema = z.object({
  text: z.string(),
  style: z.string().optional(),
});
export type ContentCtaItem = z.infer<typeof ContentCtaItemSchema>;

export const PostingRecommendationSchema = z.object({
  bestPostingTime: z.string(),
  bestPlatform: z.string(),
  idealAudience: z.string(),
  estimatedEngagement: z.string(),
});
export type PostingRecommendation = z.infer<typeof PostingRecommendationSchema>;

export const MarketingContentPackageSchema = z.object({
  voiceScripts: VoiceScriptsSchema,
  /** English voice scripts for on-screen 中英 subtitles (required when primary content is Chinese). */
  voiceScriptsEn: VoiceScriptsSchema.optional(),
  subtitleTimeline: z.array(SubtitleTimelineSegmentSchema).default([]),
  captions: MarketingCaptionsSchema,
  hooks: z.array(ContentHookItemSchema).min(1),
  cta: z.array(ContentCtaItemSchema).min(1),
  voiceStyle: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  broll: z.array(z.string()).default([]),
  musicMood: z.string(),
  effects: z.array(z.string()).default([]),
  postingRecommendation: PostingRecommendationSchema,
  consistencyScore: z.number().min(0).max(100).default(85),
});
export type MarketingContentPackage = z.infer<typeof MarketingContentPackageSchema>;

/** Normalize LLM hooks/cta that may arrive as plain strings. */
export function normalizeMarketingContentPackage(raw: unknown): MarketingContentPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const hooksRaw = Array.isArray(data.hooks) ? data.hooks : [];
  const hooks = hooksRaw
    .map((h, i) => {
      if (typeof h === "string") return { text: h, type: "curiosity" };
      if (h && typeof h === "object" && "text" in h) {
        const item = h as { text?: string; type?: string };
        return { text: String(item.text ?? ""), type: String(item.type ?? "curiosity") };
      }
      return null;
    })
    .filter((h): h is ContentHookItem => Boolean(h?.text?.trim()));

  const ctaRaw = Array.isArray(data.cta) ? data.cta : [];
  const cta = ctaRaw
    .map((c): ContentCtaItem | null => {
      if (typeof c === "string") return { text: c };
      if (c && typeof c === "object" && "text" in c) {
        const item = c as { text?: string; style?: string };
        const text = String(item.text ?? "").trim();
        if (!text) return null;
        return item.style ? { text, style: item.style } : { text };
      }
      return null;
    })
    .filter((c): c is ContentCtaItem => c !== null);

  const voiceScriptsRaw = (data.voiceScripts ?? {}) as Record<string, unknown>;
  const voiceScriptsEnRaw = (data.voiceScriptsEn ?? {}) as Record<string, unknown>;
  const captionsRaw = (data.captions ?? {}) as Record<string, unknown>;
  const postingRaw = (data.postingRecommendation ?? {}) as Record<string, unknown>;

  const candidate = {
    voiceScripts: {
      "15s": String(voiceScriptsRaw["15s"] ?? voiceScriptsRaw["15S"] ?? ""),
      "30s": String(voiceScriptsRaw["30s"] ?? voiceScriptsRaw["30S"] ?? ""),
      "60s": String(voiceScriptsRaw["60s"] ?? voiceScriptsRaw["60S"] ?? ""),
    },
    voiceScriptsEn: {
      "15s": String(voiceScriptsEnRaw["15s"] ?? voiceScriptsEnRaw["15S"] ?? ""),
      "30s": String(voiceScriptsEnRaw["30s"] ?? voiceScriptsEnRaw["30S"] ?? ""),
      "60s": String(voiceScriptsEnRaw["60s"] ?? voiceScriptsEnRaw["60S"] ?? ""),
    },
    subtitleTimeline: Array.isArray(data.subtitleTimeline) ? data.subtitleTimeline : [],
    captions: {
      tiktok: String(captionsRaw.tiktok ?? ""),
      instagram: String(captionsRaw.instagram ?? ""),
      facebook: String(captionsRaw.facebook ?? ""),
      linkedin: String(captionsRaw.linkedin ?? ""),
      xiaohongshu: String(captionsRaw.xiaohongshu ?? ""),
      youtubeShorts: String(captionsRaw.youtubeShorts ?? captionsRaw.youtube ?? ""),
      googleBusiness: String(captionsRaw.googleBusiness ?? captionsRaw.google ?? ""),
    },
    hooks,
    cta,
    voiceStyle:
      data.voiceStyle && typeof data.voiceStyle === "object"
        ? (data.voiceStyle as Record<string, string | string[]>)
        : {},
    broll: Array.isArray(data.broll) ? (data.broll as string[]) : [],
    musicMood: String(data.musicMood ?? ""),
    effects: Array.isArray(data.effects) ? (data.effects as string[]) : [],
    postingRecommendation: {
      bestPostingTime: String(postingRaw.bestPostingTime ?? ""),
      bestPlatform: String(postingRaw.bestPlatform ?? ""),
      idealAudience: String(postingRaw.idealAudience ?? ""),
      estimatedEngagement: String(postingRaw.estimatedEngagement ?? ""),
    },
    consistencyScore: typeof data.consistencyScore === "number" ? data.consistencyScore : 85,
  };

  const parsed = MarketingContentPackageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
