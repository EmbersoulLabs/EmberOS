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
  textEn: z.string().optional(),
  textMs: z.string().optional(),
  type: z.string(),
});
export type ContentHookItem = z.infer<typeof ContentHookItemSchema>;

export const ContentCtaItemSchema = z.object({
  text: z.string(),
  textEn: z.string().optional(),
  textMs: z.string().optional(),
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

export const MarketingAnalysisSchema = z.object({
  marketingScore: z.number().min(0).max(100),
  hookScore: z.number().min(0).max(100),
  seoScore: z.number().min(0).max(100),
  emotionalScore: z.number().min(0).max(100),
  conversionScore: z.number().min(0).max(100),
  estimatedCtr: z.string(),
  estimatedEngagement: z.string(),
  estimatedConversion: z.string(),
});
export type MarketingAnalysis = z.infer<typeof MarketingAnalysisSchema>;

export const ContentStrategyBriefSchema = z.object({
  primaryGoal: z.string(),
  targetAudience: z.string(),
  contentAngle: z.string(),
  painPoint: z.string(),
  desiredEmotion: z.string(),
  ctaStrategy: z.string(),
});
export type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;

export const SeoPackSchema = z.object({
  primaryKeywords: z.array(z.string()).default([]),
  secondaryKeywords: z.array(z.string()).default([]),
  longTailKeywords: z.array(z.string()).default([]),
  localKeywords: z.array(z.string()).default([]),
  searchIntent: z.string().default(""),
});
export type SeoPack = z.infer<typeof SeoPackSchema>;

export const HashtagPackSchema = z.object({
  highVolume: z.array(z.string()).default([]),
  mediumVolume: z.array(z.string()).default([]),
  local: z.array(z.string()).default([]),
  brand: z.array(z.string()).default([]),
  industry: z.array(z.string()).default([]),
});
export type HashtagPack = z.infer<typeof HashtagPackSchema>;

export const PlatformMarketingAssetSchema = z.object({
  caption: z.string().default(""),
  hook: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  hashtags: z.array(z.string()).default([]),
  cta: z.string().default(""),
  formatStyle: z.string().optional(),
});
export type PlatformMarketingAsset = z.infer<typeof PlatformMarketingAssetSchema>;

export const MarketingContentPackageSchema = z.object({
  voiceScripts: VoiceScriptsSchema,
  /** English voice scripts for on-screen 中英 subtitles (populated when primary content is Chinese). */
  voiceScriptsEn: VoiceScriptsSchema.optional(),
  /** Chinese voice scripts for on-screen 中英 subtitles (populated when primary content is English). */
  voiceScriptsZh: VoiceScriptsSchema.optional(),
  subtitleTimeline: z.array(SubtitleTimelineSegmentSchema).default([]),
  captions: MarketingCaptionsSchema,
  captionsEn: MarketingCaptionsSchema.optional(),
  captionsMs: MarketingCaptionsSchema.optional(),
  hooks: z.array(ContentHookItemSchema).min(1),
  cta: z.array(ContentCtaItemSchema).min(1),
  voiceStyle: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  broll: z.array(z.string()).default([]),
  musicMood: z.string(),
  effects: z.array(z.string()).default([]),
  postingRecommendation: PostingRecommendationSchema,
  consistencyScore: z.number().min(0).max(100).default(85),
  /** AI marketing analysis dashboard scores. */
  analysis: MarketingAnalysisSchema.optional(),
  /** Content strategy brief for dashboard. */
  strategyBrief: ContentStrategyBriefSchema.optional(),
  /** English / Malay translations of strategyBrief (when primary is Chinese). */
  strategyBriefEn: ContentStrategyBriefSchema.optional(),
  strategyBriefMs: ContentStrategyBriefSchema.optional(),
  /** Platform-specific rich assets — each platform unique copy. */
  platformAssets: z.record(PlatformMarketingAssetSchema).optional(),
  seo: SeoPackSchema.optional(),
  hashtagPack: HashtagPackSchema.optional(),
  /** Actionable AI suggestions (short bullets). */
  aiSuggestions: z.array(z.string()).default([]),
});
export type MarketingContentPackage = z.infer<typeof MarketingContentPackageSchema>;

function parseCaptionBlock(raw: Record<string, unknown>): MarketingCaptions {
  return {
    tiktok: String(raw.tiktok ?? ""),
    instagram: String(raw.instagram ?? ""),
    facebook: String(raw.facebook ?? ""),
    linkedin: String(raw.linkedin ?? ""),
    xiaohongshu: String(raw.xiaohongshu ?? ""),
    youtubeShorts: String(raw.youtubeShorts ?? raw.youtube ?? ""),
    googleBusiness: String(raw.googleBusiness ?? raw.google ?? ""),
  };
}

function captionFromPlatformAsset(asset: PlatformMarketingAsset): string {
  const tags = asset.hashtags
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
  return [asset.title, asset.hook, asset.caption, asset.description, tags, asset.cta]
    .filter((p) => p?.trim())
    .join("\n\n")
    .trim();
}

function mergeCaptionsFromPlatformAssets(
  captions: MarketingCaptions,
  assets: Record<string, PlatformMarketingAsset>
): MarketingCaptions {
  const merged = { ...captions };
  for (const [id, asset] of Object.entries(assets)) {
    if (id === "threads") continue;
    const cap = captionFromPlatformAsset(asset);
    if (cap && id in merged) {
      (merged as Record<string, string>)[id] = cap;
    }
  }
  return merged;
}

function parseLocalizedItemText(value: unknown): {
  text: string;
  textEn?: string;
  textMs?: string;
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tri = value as { zh?: string; en?: string; ms?: string };
    if ("zh" in tri || "en" in tri || "ms" in tri) {
      return {
        text: String(tri.zh ?? tri.en ?? tri.ms ?? "").trim(),
        textEn: tri.en?.trim() || undefined,
        textMs: tri.ms?.trim() || undefined,
      };
    }
  }
  return { text: String(value ?? "").trim() };
}

/** Normalize LLM hooks/cta that may arrive as plain strings. */
export function normalizeMarketingContentPackage(raw: unknown): MarketingContentPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  // LLMs (especially gpt-4o-mini) sometimes return hooks as an object or use
  // non-standard field names. Normalize to array first.
  const hooksInput: unknown[] = Array.isArray(data.hooks)
    ? data.hooks
    : data.hooks && typeof data.hooks === "object"
      ? Object.values(data.hooks as Record<string, unknown>)
      : [];
  const hooks = hooksInput
    .map((h) => {
      if (typeof h === "string") return { text: h, type: "curiosity" };
      if (h && typeof h === "object") {
        const item = h as Record<string, unknown>;
        // Accept text / hookText / content / message as the hook body.
        const rawText = item.text ?? item.hookText ?? item.content ?? item.message ?? item.hook ?? "";
        const localized = parseLocalizedItemText(rawText);
        if (!localized.text) return null;
        return {
          text: localized.text,
          textEn: String(item.textEn ?? "").trim() || localized.textEn,
          textMs: String(item.textMs ?? "").trim() || localized.textMs,
          type: String(item.type ?? item.hookType ?? item.kind ?? "curiosity"),
        };
      }
      return null;
    })
    .filter((h): h is ContentHookItem => Boolean(h?.text?.trim()));

  const ctaInput: unknown[] = Array.isArray(data.cta)
    ? data.cta
    : data.cta && typeof data.cta === "object"
      ? Object.values(data.cta as Record<string, unknown>)
      : [];
  const cta = ctaInput
    .map((c): ContentCtaItem | null => {
      if (typeof c === "string") return { text: c };
      if (c && typeof c === "object") {
        const item = c as Record<string, unknown>;
        const rawText = item.text ?? item.ctaText ?? item.content ?? item.message ?? "";
        const localized = parseLocalizedItemText(rawText);
        const text = localized.text || String(rawText ?? "").trim();
        if (!text) return null;
        const base = {
          text,
          textEn: String(item.textEn ?? "").trim() || localized.textEn,
          textMs: String(item.textMs ?? "").trim() || localized.textMs,
        };
        return item.style ? { ...base, style: String(item.style) } : base;
      }
      return null;
    })
    .filter((c): c is ContentCtaItem => c !== null);

  const voiceScriptsRaw = (data.voiceScripts ?? {}) as Record<string, unknown>;
  const voiceScriptsEnRaw = (data.voiceScriptsEn ?? {}) as Record<string, unknown>;
  const voiceScriptsZhRaw = (data.voiceScriptsZh ?? {}) as Record<string, unknown>;
  const captionsRaw = (data.captions ?? {}) as Record<string, unknown>;
  const captionsEnRaw = (data.captionsEn ?? {}) as Record<string, unknown>;
  const captionsMsRaw = (data.captionsMs ?? {}) as Record<string, unknown>;
  const postingRaw = (data.postingRecommendation ?? {}) as Record<string, unknown>;
  const analysisRaw = (data.analysis ?? {}) as Record<string, unknown>;
  const strategyBriefRaw = (data.strategyBrief ?? {}) as Record<string, unknown>;
  const strategyBriefEnRaw = (data.strategyBriefEn ?? {}) as Record<string, unknown>;
  const strategyBriefMsRaw = (data.strategyBriefMs ?? {}) as Record<string, unknown>;
  const platformAssetsRaw = (data.platformAssets ?? {}) as Record<string, unknown>;
  const seoRaw = (data.seo ?? {}) as Record<string, unknown>;
  const hashtagRaw = (data.hashtagPack ?? data.hashtags ?? {}) as Record<string, unknown>;

  const parsePlatformAssets = (): Record<string, PlatformMarketingAsset> | undefined => {
    if (!platformAssetsRaw || typeof platformAssetsRaw !== "object") return undefined;
    const out: Record<string, PlatformMarketingAsset> = {};
    for (const [key, val] of Object.entries(platformAssetsRaw)) {
      if (!val || typeof val !== "object") continue;
      const a = val as Record<string, unknown>;
      out[key] = {
        caption: String(a.caption ?? ""),
        hook: a.hook ? String(a.hook) : undefined,
        title: a.title ? String(a.title) : undefined,
        description: a.description ? String(a.description) : undefined,
        hashtags: Array.isArray(a.hashtags) ? (a.hashtags as string[]) : [],
        cta: String(a.cta ?? ""),
        formatStyle: a.formatStyle ? String(a.formatStyle) : undefined,
      };
    }
    return Object.keys(out).length ? out : undefined;
  };

  const parseStrategyBriefBlock = (raw: Record<string, unknown>) =>
    raw.primaryGoal || raw.contentAngle
      ? {
          primaryGoal: String(raw.primaryGoal ?? ""),
          targetAudience: String(raw.targetAudience ?? ""),
          contentAngle: String(raw.contentAngle ?? ""),
          painPoint: String(raw.painPoint ?? ""),
          desiredEmotion: String(raw.desiredEmotion ?? ""),
          ctaStrategy: String(raw.ctaStrategy ?? ""),
        }
      : undefined;

  const platformAssets = parsePlatformAssets();
  const captionsFromAssets = platformAssets
    ? mergeCaptionsFromPlatformAssets(parseCaptionBlock(captionsRaw), platformAssets)
    : parseCaptionBlock(captionsRaw);

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
    voiceScriptsZh: {
      "15s": String(voiceScriptsZhRaw["15s"] ?? voiceScriptsZhRaw["15S"] ?? ""),
      "30s": String(voiceScriptsZhRaw["30s"] ?? voiceScriptsZhRaw["30S"] ?? ""),
      "60s": String(voiceScriptsZhRaw["60s"] ?? voiceScriptsZhRaw["60S"] ?? ""),
    },
    subtitleTimeline: Array.isArray(data.subtitleTimeline) ? data.subtitleTimeline : [],
    captions: captionsFromAssets,
    captionsEn: Object.keys(captionsEnRaw).length ? parseCaptionBlock(captionsEnRaw) : undefined,
    captionsMs: Object.keys(captionsMsRaw).length ? parseCaptionBlock(captionsMsRaw) : undefined,
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
    analysis:
      typeof analysisRaw.marketingScore === "number"
        ? {
            marketingScore: analysisRaw.marketingScore as number,
            hookScore: Number(analysisRaw.hookScore ?? analysisRaw.marketingScore),
            seoScore: Number(analysisRaw.seoScore ?? 75),
            emotionalScore: Number(analysisRaw.emotionalScore ?? 80),
            conversionScore: Number(analysisRaw.conversionScore ?? 72),
            estimatedCtr: String(analysisRaw.estimatedCtr ?? "2.4% – 4.1%"),
            estimatedEngagement: String(analysisRaw.estimatedEngagement ?? "Medium–High"),
            estimatedConversion: String(analysisRaw.estimatedConversion ?? "1.2% – 2.8%"),
          }
        : undefined,
    strategyBrief: parseStrategyBriefBlock(strategyBriefRaw),
    strategyBriefEn: parseStrategyBriefBlock(strategyBriefEnRaw),
    strategyBriefMs: parseStrategyBriefBlock(strategyBriefMsRaw),
    platformAssets,
    seo:
      Array.isArray(seoRaw.primaryKeywords) || seoRaw.searchIntent
        ? {
            primaryKeywords: Array.isArray(seoRaw.primaryKeywords) ? (seoRaw.primaryKeywords as string[]) : [],
            secondaryKeywords: Array.isArray(seoRaw.secondaryKeywords) ? (seoRaw.secondaryKeywords as string[]) : [],
            longTailKeywords: Array.isArray(seoRaw.longTailKeywords) ? (seoRaw.longTailKeywords as string[]) : [],
            localKeywords: Array.isArray(seoRaw.localKeywords) ? (seoRaw.localKeywords as string[]) : [],
            searchIntent: String(seoRaw.searchIntent ?? ""),
          }
        : undefined,
    hashtagPack:
      Array.isArray(hashtagRaw.highVolume) || Array.isArray(hashtagRaw.industry)
        ? {
            highVolume: Array.isArray(hashtagRaw.highVolume) ? (hashtagRaw.highVolume as string[]) : [],
            mediumVolume: Array.isArray(hashtagRaw.mediumVolume) ? (hashtagRaw.mediumVolume as string[]) : [],
            local: Array.isArray(hashtagRaw.local) ? (hashtagRaw.local as string[]) : [],
            brand: Array.isArray(hashtagRaw.brand) ? (hashtagRaw.brand as string[]) : [],
            industry: Array.isArray(hashtagRaw.industry) ? (hashtagRaw.industry as string[]) : [],
          }
        : undefined,
    aiSuggestions: Array.isArray(data.aiSuggestions) ? (data.aiSuggestions as string[]) : [],
  };

  // If the LLM produced no hooks/cta, synthesize minimal entries from voiceScripts so
  // the package doesn't fall through to the static template fallback.
  const finalHooks: ContentHookItem[] =
    hooks.length > 0
      ? hooks
      : (() => {
          const script = candidate.voiceScripts["15s"] || candidate.voiceScripts["30s"] || "";
          return script ? [{ text: script.slice(0, 100), type: "curiosity" }] : [];
        })();
  const finalCta: ContentCtaItem[] = cta.length > 0 ? cta : [{ text: "Follow for more" }];

  const parsed = MarketingContentPackageSchema.safeParse({ ...candidate, hooks: finalHooks, cta: finalCta });
  return parsed.success ? parsed.data : null;
}
