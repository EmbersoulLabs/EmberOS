import type { StrategyPlan } from "./types/marketing-os";
import type { VisionAnalysis } from "./types";
import type { ContentLocale } from "./content-locale";
import { isChineseText } from "./subtitle-text";

type VisionLike = Pick<VisionAnalysis, "products" | "subjects" | "scenes"> &
  Partial<Pick<VisionAnalysis, "transcriptSummary">>;

export interface ResolveContentSubjectOptions {
  goal?: string;
  /** User-written brief / description (preferred over campaign label). */
  userNotes?: string;
  campaignBrief?: string;
  videoAnalysis?: string;
  /** Internal project label — last resort when no description and no asset signal. */
  campaignName?: string;
  locale?: ContentLocale;
}

const GENERIC_VISION_TERMS = new Set([
  "product",
  "营销素材",
  "marketing asset",
  "产品展示",
  "product showcase",
  "场景氛围",
  "brand scene",
  "品牌内容",
  "your content",
  "这款产品",
  "this product",
  "produk ini",
]);

// Generic vocabulary used by the vision fallback templates. When a candidate is
// composed almost entirely of these tokens (plus filler/punctuation), it carries
// no real asset signal — even if the exact joined string isn't in the set above.
const GENERIC_TOKENS = [
  "营销素材",
  "产品展示",
  "产品",
  "商品",
  "展示",
  "实拍",
  "画面",
  "场景",
  "氛围",
  "环境",
  "内容",
  "镜头",
  "品牌",
  "marketing asset",
  "product showcase",
  "product",
  "showcase",
  "scene",
  "content",
  "footage",
  "brand",
];

// Connectors / filler that don't add meaning when measuring residue.
const FILLER_PATTERN = /[\s、,，。.|/&和与及的了在中实拍-]/g;

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

export function isGenericVisionText(text: string): boolean {
  const candidate = normalizeLabel(text);
  if (!candidate) return true;
  const lower = candidate.toLowerCase();
  if (GENERIC_VISION_TERMS.has(lower)) return true;
  // Strip every generic token, then filler; if almost nothing meaningful
  // remains, the candidate is a generic placeholder.
  let residue = lower;
  for (const token of GENERIC_TOKENS) {
    if (!token) continue;
    residue = residue.split(token).join("");
  }
  residue = residue.replace(FILLER_PATTERN, "");
  return residue.length < 3;
}

function collectDescriptionCandidates(options?: ResolveContentSubjectOptions): string[] {
  return [options?.userNotes, options?.campaignBrief, options?.videoAnalysis?.slice(0, 80)]
    .map(normalizeLabel)
    .filter(Boolean);
}

function collectVisionCandidates(vision: VisionLike, locale: ContentLocale): string[] {
  const meaningfulSubjects = vision.subjects.filter(
    (s: string) => s !== "product" && !isGenericVisionText(s)
  );
  return [
    vision.products[0]?.name,
    meaningfulSubjects.join(locale === "zh" ? "、" : " "),
    vision.scenes[0]?.description?.slice(0, 80),
    vision.transcriptSummary?.slice(0, 80),
  ]
    .map(normalizeLabel)
    .filter(Boolean);
}

/** True when vision carries non-generic asset-derived signal. */
export function hasSubstantiveVision(vision: VisionLike): boolean {
  return collectVisionCandidates(vision, "en").some(
    (item) => !isGenericVisionText(item) && !isCampaignLabel(item, undefined)
  );
}

function genericSubject(locale: ContentLocale): string {
  return locale === "zh" ? "这款产品" : locale === "ms" ? "produk ini" : "this product";
}

function pickCandidate(
  candidates: string[],
  campaignName?: string
): string | undefined {
  for (const candidate of candidates) {
    if (isCampaignLabel(candidate, campaignName)) continue;
    if (isGenericVisionText(candidate)) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Derive the primary subject for copy.
 * Priority: asset/vision → description/brief → goal → campaign label (only if nothing else).
 */
export function resolveContentSubject(
  vision: VisionLike,
  options?: ResolveContentSubjectOptions
): string {
  const locale =
    options?.locale ??
    (isChineseText(
      `${options?.goal ?? ""}${options?.userNotes ?? ""}${options?.campaignBrief ?? ""}${vision.transcriptSummary ?? ""}`
    )
      ? "zh"
      : "en");
  const campaignName = options?.campaignName;
  const description = collectDescriptionCandidates(options);
  const goal = normalizeLabel(options?.goal);
  const hasAssets = hasSubstantiveVision(vision);

  const fromAssets = hasAssets
    ? pickCandidate(collectVisionCandidates(vision, locale), campaignName)
    : undefined;
  if (fromAssets) return fromAssets;

  const fromDescription = pickCandidate(description, campaignName);
  if (fromDescription) return fromDescription;

  if (goal && !isCampaignLabel(goal, campaignName)) return goal;

  if (!hasAssets && !description.length && !goal) {
    const cn = normalizeLabel(campaignName);
    if (cn) return cn;
  }

  return genericSubject(locale);
}

/** After vision, replace strategy.product when it was inferred from the campaign label. */
export function alignStrategyWithVision(
  strategy: StrategyPlan,
  vision: VisionLike,
  options?: ResolveContentSubjectOptions
): StrategyPlan {
  const subject = resolveContentSubject(vision, options);
  const productLooksLikeLabel =
    !strategy.product.trim() ||
    isCampaignLabel(strategy.product, options?.campaignName) ||
    isGenericVisionText(strategy.product);

  if (!productLooksLikeLabel) return strategy;

  const keywords = strategy.keywords.some((k: string) =>
    isCampaignLabel(k, options?.campaignName)
  )
    ? [subject, ...strategy.keywords.filter((k: string) => !isCampaignLabel(k, options?.campaignName))]
    : strategy.keywords;

  return { ...strategy, product: subject, keywords };
}
