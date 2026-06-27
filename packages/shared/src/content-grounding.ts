import { isInternalPromptLeak } from "./campaign-brief";
import { hasSubstantiveVision, isTemplatedVisionFallback } from "./content-subject";
import type { VisionAnalysis } from "./types";

export interface ContentGroundingAssessment {
  /** Points subtracted from default marketing scores (0–45). */
  scorePenalty: number;
  /** Copy/strategy is not grounded in uploaded assets or user brief. */
  isUngrounded: boolean;
  reasons: string[];
}

type VisionGrounding = Pick<
  VisionAnalysis,
  "products" | "subjects" | "scenes" | "confidence" | "transcriptSummary"
>;

export function assessContentGrounding(opts: {
  vision?: VisionGrounding;
  campaignName?: string;
  strategyProduct?: string;
  strategyAngle?: string;
  keywords?: string[];
  hasUserDescription?: boolean;
}): ContentGroundingAssessment {
  const reasons: string[] = [];
  let penalty = 0;

  if (!opts.vision) {
    penalty += 30;
    reasons.push("no_vision");
  } else if (isTemplatedVisionFallback(opts.vision)) {
    penalty += 28;
    reasons.push("vision_template_fallback");
  } else if (!hasSubstantiveVision(opts.vision, opts.campaignName)) {
    penalty += 22;
    reasons.push("vision_not_substantive");
  }

  if (isInternalPromptLeak(opts.strategyAngle)) {
    penalty += 18;
    reasons.push("strategy_internal_prompt");
  }

  if (opts.strategyProduct?.toLowerCase().includes("showcase with product styling")) {
    penalty += 8;
    reasons.push("generic_showcase_template");
  }

  if ((opts.keywords ?? []).some((k) => isInternalPromptLeak(k))) {
    penalty += 12;
    reasons.push("leaked_keywords");
  }

  if (opts.hasUserDescription) {
    penalty = Math.max(0, penalty - 8);
  }

  penalty = Math.min(45, penalty);
  return {
    scorePenalty: penalty,
    isUngrounded: penalty >= 20,
    reasons,
  };
}

export interface MarketingAnalysisScores {
  marketingScore: number;
  hookScore: number;
  seoScore: number;
  emotionalScore: number;
  conversionScore: number;
}

/** Lower inflated scores when content is not grounded in real asset analysis. */
export function applyGroundingToAnalysisScores(
  scores: MarketingAnalysisScores,
  penalty: number,
  hardCapWhenUngrounded = 45
): MarketingAnalysisScores {
  const adjust = (n: number) => Math.max(22, n - penalty);
  const adjusted = {
    marketingScore: adjust(scores.marketingScore),
    hookScore: adjust(scores.hookScore),
    seoScore: adjust(scores.seoScore),
    emotionalScore: adjust(scores.emotionalScore),
    conversionScore: adjust(scores.conversionScore),
  };
  if (penalty < 20) return adjusted;
  const cap = (n: number) => Math.min(n, hardCapWhenUngrounded);
  return {
    marketingScore: cap(adjusted.marketingScore),
    hookScore: cap(adjusted.hookScore),
    seoScore: cap(adjusted.seoScore),
    emotionalScore: cap(adjusted.emotionalScore),
    conversionScore: cap(adjusted.conversionScore),
  };
}

export function groundingWarningSuggestion(locale: "zh" | "en" | "ms"): string {
  if (locale === "zh") {
    return "文案未基于上传素材生成（自动画面分析失败）— 请补充 description 或重新运行";
  }
  if (locale === "ms") {
    return "Kandungan tidak berpandukan media dimuat naik — tambah penerangan atau jalankan semula";
  }
  return "Content is not grounded in your uploaded media — add a description or re-run after asset analysis succeeds";
}
