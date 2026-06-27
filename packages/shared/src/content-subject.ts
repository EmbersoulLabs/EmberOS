import type { StrategyPlan } from "./types/marketing-os";
import type { VisionAnalysis } from "./types";
import type { ContentLocale } from "./content-locale";
import { isChineseText } from "./subtitle-text";

type VisionLike = Pick<VisionAnalysis, "products" | "subjects" | "scenes"> &
  Partial<Pick<VisionAnalysis, "transcriptSummary">>;

export interface ResolveContentSubjectOptions {
  goal?: string;
  /** Internal project label — must not become copy when vision/goal exist. */
  campaignName?: string;
  locale?: ContentLocale;
}

function normalizeLabel(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** True when text is essentially the campaign label, not substantive content. */
export function isCampaignLabel(text: string, campaignName?: string): boolean {
  const label = normalizeLabel(campaignName);
  const candidate = normalizeLabel(text);
  if (!label || !candidate) return false;
  if (candidate === label) return true;
  if (candidate.length <= label.length + 2 && candidate.includes(label)) return true;
  return false;
}

/** Derive the primary subject for copy from vision analysis, not the campaign label. */
export function resolveContentSubject(
  vision: VisionLike,
  options?: ResolveContentSubjectOptions
): string {
  const locale =
    options?.locale ?? (isChineseText(`${options?.goal ?? ""}${vision.transcriptSummary ?? ""}`) ? "zh" : "en");
  const campaignName = options?.campaignName;

  const candidates = [
    vision.products[0]?.name,
    vision.subjects.filter((s: string) => s !== "product").join(locale === "zh" ? "、" : " "),
    vision.scenes[0]?.description?.slice(0, 48),
    vision.transcriptSummary?.slice(0, 48),
    options?.goal,
  ]
    .map((c) => normalizeLabel(c))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!isCampaignLabel(candidate, campaignName)) return candidate;
  }

  return locale === "zh" ? "这款产品" : locale === "ms" ? "produk ini" : "this product";
}

/** After vision, replace strategy.product when it was inferred from the campaign label. */
export function alignStrategyWithVision(
  strategy: StrategyPlan,
  vision: VisionLike,
  options?: ResolveContentSubjectOptions
): StrategyPlan {
  const subject = resolveContentSubject(vision, options);
  const productLooksLikeLabel =
    !strategy.product.trim() || isCampaignLabel(strategy.product, options?.campaignName);

  if (!productLooksLikeLabel) return strategy;

  const keywords = strategy.keywords.some((k: string) => isCampaignLabel(k, options?.campaignName))
    ? [subject, ...strategy.keywords.filter((k: string) => !isCampaignLabel(k, options?.campaignName))]
    : strategy.keywords;

  return { ...strategy, product: subject, keywords };
}
