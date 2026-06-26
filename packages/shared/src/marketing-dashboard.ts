import type {
  MarketingCaptions,
  MarketingContentPackage,
  StrategyPlan,
  PlatformMarketingAsset,
  MarketingAnalysis,
  ContentStrategyBrief,
  SeoPack,
  HashtagPack,
} from "./types/marketing-os";

export type { PlatformMarketingAsset, MarketingAnalysis, ContentStrategyBrief, SeoPack, HashtagPack };
export {
  MarketingAnalysisSchema,
  ContentStrategyBriefSchema,
  SeoPackSchema,
  HashtagPackSchema,
  PlatformMarketingAssetSchema,
} from "./types/marketing-os";

/** Platform ids for rich marketing assets (extensible registry). */
export const MARKETING_PLATFORM_IDS = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "threads",
  "youtubeShorts",
  "googleBusiness",
] as const;

export type MarketingPlatformId = (typeof MARKETING_PLATFORM_IDS)[number];

export interface MarketingPlatformDef {
  id: MarketingPlatformId;
  label: string;
  icon: string;
  accent: "blue" | "teal" | "navy" | "amber";
  /** Short expert persona — guides LLM tone, not shown as copy. */
  expertPersona: string;
  requiredFields: readonly string[];
}

export const MARKETING_PLATFORMS: Record<MarketingPlatformId, MarketingPlatformDef> = {
  facebook: {
    id: "facebook",
    label: "Facebook",
    icon: "f",
    accent: "blue",
    expertPersona: "Community storyteller — longer narrative, warm, social proof",
    requiredFields: ["caption", "cta"],
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    icon: "in",
    accent: "navy",
    expertPersona: "B2B educator — authority, insights, professional tone",
    requiredFields: ["caption", "cta"],
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    icon: "红",
    accent: "teal",
    expertPersona: "Lifestyle curator — emoji, line breaks, search-friendly, aspirational",
    requiredFields: ["caption", "hashtags", "cta"],
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    icon: "ig",
    accent: "teal",
    expertPersona: "Visual poet — short, emotional, emoji-light, scroll-stopping hook",
    requiredFields: ["caption", "cta"],
  },
  threads: {
    id: "threads",
    label: "Threads",
    icon: "@",
    accent: "blue",
    expertPersona: "Conversationalist — opinion-led, casual, debate-friendly",
    requiredFields: ["caption", "hook"],
  },
  googleBusiness: {
    id: "googleBusiness",
    label: "Google Business",
    icon: "G",
    accent: "navy",
    expertPersona: "Local SEO specialist — service keywords, call-now, trust signals",
    requiredFields: ["caption", "cta"],
  },
  youtubeShorts: {
    id: "youtubeShorts",
    label: "YouTube Shorts",
    icon: "▶",
    accent: "blue",
    expertPersona: "Short-form video SEO — title, hook, description, hashtags",
    requiredFields: ["title", "hook", "description", "hashtags"],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    icon: "♪",
    accent: "teal",
    expertPersona: "Trend native — punchy hook, trending CTA, native slang",
    requiredFields: ["caption", "hook", "cta"],
  },
};

/** Future AI module slots — plug-in registry (no hardcoded UI). */
export const MARKETING_MODULE_SLOTS = [
  "trendAnalysis",
  "competitorAnalysis",
  "weeklyPlanner",
  "campaignPlanner",
  "seoOptimizer",
  "abTesting",
  "analytics",
  "publishingScheduler",
  "marketingCalendar",
] as const;

export type MarketingModuleSlot = (typeof MARKETING_MODULE_SLOTS)[number];

export type PlatformMarketingAssets = Partial<Record<MarketingPlatformId, PlatformMarketingAsset>>;

/** Flatten rich asset → legacy caption string for render/export pipelines. */
export function platformAssetToCaption(asset: PlatformMarketingAsset): string {
  const tags = asset.hashtags
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
  return [asset.title, asset.hook, asset.caption, asset.description, tags, asset.cta]
    .filter((p) => p?.trim())
    .join("\n\n")
    .trim();
}

/** Sync legacy captions map from platformAssets (threads stays assets-only). */
export function syncCaptionsFromPlatformAssets(
  assets: PlatformMarketingAssets
): Partial<MarketingCaptions> {
  const out: Partial<MarketingCaptions> = {};
  for (const id of MARKETING_PLATFORM_IDS) {
    if (id === "threads") continue;
    const asset = assets[id];
    if (asset) {
      const cap = platformAssetToCaption(asset);
      if (cap) (out as Record<string, string>)[id] = cap;
    }
  }
  return out;
}

/** Build platformAssets from legacy flat captions (backward compat). */
export function platformAssetsFromCaptions(
  captions: MarketingCaptions
): PlatformMarketingAssets {
  const assets: PlatformMarketingAssets = {};
  for (const id of MARKETING_PLATFORM_IDS) {
    if (id === "threads") continue;
    const cap = captions[id as keyof MarketingCaptions]?.trim();
    if (cap) assets[id] = { caption: cap, cta: "", hashtags: [] };
  }
  return assets;
}

export function deriveAnalysisFromPackage(
  pkg: MarketingContentPackage,
  strategy?: StrategyPlan
): MarketingAnalysis {
  const base = pkg.consistencyScore ?? 78;
  const hookAvg = pkg.hooks.length ? Math.min(100, base + 4) : base;
  return {
    marketingScore: base,
    hookScore: hookAvg,
    seoScore: Math.min(100, base - 2 + (strategy?.keywords.length ?? 0)),
    emotionalScore: Math.min(100, base + 2),
    conversionScore: Math.min(100, base - 4 + pkg.cta.length),
    estimatedCtr: pkg.analysis?.estimatedCtr ?? "2.4% – 4.1%",
    estimatedEngagement: pkg.postingRecommendation?.estimatedEngagement ?? "Medium–High",
    estimatedConversion: pkg.analysis?.estimatedConversion ?? "1.2% – 2.8%",
  };
}

export function deriveStrategyBrief(
  pkg: MarketingContentPackage,
  strategy?: StrategyPlan
): ContentStrategyBrief {
  if (pkg.strategyBrief) return pkg.strategyBrief;
  return {
    primaryGoal: strategy?.marketingGoal ?? pkg.postingRecommendation?.idealAudience ?? "Brand awareness",
    targetAudience: strategy?.audience
      ? [
          strategy.audience.age,
          strategy.audience.location,
          strategy.audience.interests?.join(", "),
        ]
          .filter(Boolean)
          .join(" · ")
      : (pkg.postingRecommendation?.idealAudience ?? "Target customers"),
    contentAngle: strategy?.marketingAngle ?? pkg.hooks[0]?.text ?? "",
    painPoint: strategy?.audience.painPoints?.[0] ?? "",
    desiredEmotion: strategy?.tone ?? "Trust & desire",
    ctaStrategy: strategy?.ctaStrategy ?? pkg.cta[0]?.text ?? "Learn more",
  };
}

export function resolvePlatformAssets(pkg: MarketingContentPackage): PlatformMarketingAssets {
  if (pkg.platformAssets && Object.keys(pkg.platformAssets).length > 0) {
    return pkg.platformAssets;
  }
  return platformAssetsFromCaptions(pkg.captions);
}

export function resolveHashtagPack(
  pkg: MarketingContentPackage,
  strategy?: StrategyPlan
): HashtagPack {
  if (pkg.hashtagPack) return pkg.hashtagPack;
  const h = strategy?.hashtags;
  return {
    highVolume: h?.trending ?? [],
    mediumVolume: h?.seo ?? [],
    local: h?.local ?? [],
    brand: [],
    industry: h?.industry ?? [],
  };
}

export function resolveSeoPack(pkg: MarketingContentPackage, strategy?: StrategyPlan): SeoPack {
  if (pkg.seo) return pkg.seo;
  const kw = strategy?.keywords ?? [];
  return {
    primaryKeywords: kw.slice(0, 3),
    secondaryKeywords: kw.slice(3, 8),
    longTailKeywords: kw.slice(8, 12),
    localKeywords: strategy?.hashtags.local ?? [],
    searchIntent: strategy?.marketingGoal ?? "",
  };
}
