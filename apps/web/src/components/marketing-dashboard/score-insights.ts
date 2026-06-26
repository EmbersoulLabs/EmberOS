import type { MarketingContentPackage, SeoPack, ContentStrategyBrief, MarketingAnalysis } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

export type ScoreDimension = "hook" | "seo" | "emotional" | "conversion";

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

const GENERIC_KEYS: Record<ScoreDimension, TranslationKey[]> = {
  hook: [
    "marketing.insight.generic.hook.1",
    "marketing.insight.generic.hook.2",
    "marketing.insight.generic.hook.3",
  ],
  seo: [
    "marketing.insight.generic.seo.1",
    "marketing.insight.generic.seo.2",
    "marketing.insight.generic.seo.3",
  ],
  emotional: [
    "marketing.insight.generic.emotional.1",
    "marketing.insight.generic.emotional.2",
    "marketing.insight.generic.emotional.3",
  ],
  conversion: [
    "marketing.insight.generic.conversion.1",
    "marketing.insight.generic.conversion.2",
    "marketing.insight.generic.conversion.3",
  ],
};

export function deriveScoreInsights(
  dimension: ScoreDimension,
  value: number,
  ctx: {
    analysis: MarketingAnalysis;
    seo: SeoPack;
    brief: ContentStrategyBrief;
    pkg: MarketingContentPackage;
  },
  t: TranslateFn
): string[] {
  const tips: string[] = [];
  const { seo, brief, pkg } = ctx;

  if (value >= 85) {
    tips.push(t("marketing.score.strong"));
    return tips;
  }

  if (dimension === "hook") {
    if (value < 75) tips.push(t("marketing.insight.hook.low"));
    if (!pkg.hooks.length) tips.push(t("marketing.insight.hook.none"));
    else if (pkg.hooks[0]?.text && pkg.hooks[0].text.length > 80)
      tips.push(t("marketing.insight.hook.long"));
  }

  if (dimension === "seo") {
    if (value < 80) tips.push(t("marketing.insight.seo.low", { score: value }));
    if (!seo.localKeywords.length) tips.push(t("marketing.insight.seo.noLocal"));
    if (seo.primaryKeywords.length < 2) tips.push(t("marketing.insight.seo.fewPrimary"));
    if (!seo.searchIntent?.trim()) tips.push(t("marketing.insight.seo.noIntent"));
    if (seo.longTailKeywords.length < 2) tips.push(t("marketing.insight.seo.thinLongTail"));
  }

  if (dimension === "emotional") {
    if (value < 78) tips.push(t("marketing.insight.emotional.low"));
    if (!brief.painPoint?.trim()) tips.push(t("marketing.insight.emotional.noPain"));
    if (!brief.desiredEmotion?.trim()) tips.push(t("marketing.insight.emotional.noEmotion"));
  }

  if (dimension === "conversion") {
    if (value < 78) tips.push(t("marketing.insight.conversion.low"));
    if (pkg.cta.length < 2) tips.push(t("marketing.insight.conversion.fewCta"));
    if (!brief.ctaStrategy?.trim()) tips.push(t("marketing.insight.conversion.noStrategy"));
  }

  const fromAi = pkg.aiSuggestions?.slice(0, 2) ?? [];
  tips.push(...fromAi);

  if (tips.length < 2) {
    for (const key of GENERIC_KEYS[dimension]) {
      if (tips.length >= 3) break;
      tips.push(t(key));
    }
  }

  return [...new Set(tips)].slice(0, 4);
}

export function defaultSuggestions(t: TranslateFn): string[] {
  return [
    t("marketing.suggestions.1"),
    t("marketing.suggestions.2"),
    t("marketing.suggestions.3"),
    t("marketing.suggestions.4"),
    t("marketing.suggestions.5"),
  ];
}

export function scoreQualityKey(score: number): TranslationKey {
  if (score >= 90) return "marketing.score.quality.excellent";
  if (score >= 80) return "marketing.score.quality.great";
  if (score >= 70) return "marketing.score.quality.good";
  if (score >= 60) return "marketing.score.quality.fair";
  return "marketing.score.quality.needsWork";
}
