import type { MarketingPackLocale } from "./marketing-pack-locale";
import type { MarketingPlatformId } from "./marketing-dashboard";

const CAPTION_PLATFORM_IDS = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "youtubeShorts",
  "googleBusiness",
] as const;
import {
  normalizeMarketingContentPackage,
  type MarketingCaptions,
  type MarketingContentPackage,
  type PlatformMarketingAsset,
} from "./types/marketing-os";
import type { StepProgress } from "./types/index";

const CAPTION_PLATFORMS = new Set<string>(CAPTION_PLATFORM_IDS);

export function isTaskBudgetExhausted(
  costUsd: string | number | null | undefined,
  budgetUsd: string | number | null | undefined
): boolean {
  const spent = typeof costUsd === "number" ? costUsd : Number(costUsd ?? "0");
  const budget = typeof budgetUsd === "number" ? budgetUsd : Number(budgetUsd ?? "0.5");
  if (!Number.isFinite(spent) || !Number.isFinite(budget)) return true;
  return spent >= budget;
}

export function readMarketingPackRevision(progress: StepProgress | null | undefined): number {
  const step = progress?.content_generate as { contentRevision?: unknown } | undefined;
  const revision = step?.contentRevision;
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

export function marketingPackLocalesMatch(stored: number, expected: number): boolean {
  return stored === expected;
}

/**
 * In-memory stand-in for the row-lock compare-and-swap used by the PATCH/regenerate routes.
 * A stale expected revision conflicts. The winner's package is the one that commits.
 */
export function commitMarketingPackRevision<T>(
  state: { revision: number; value: T },
  expectedRevision: number,
  nextValue: T
): { conflict: true; state: { revision: number; value: T } } | { conflict: false; state: { revision: number; value: T } } {
  if (!marketingPackLocalesMatch(state.revision, expectedRevision)) {
    return { conflict: true, state };
  }
  return {
    conflict: false,
    state: { revision: state.revision + 1, value: nextValue },
  };
}

function captionKey(platformId: MarketingPlatformId): keyof MarketingCaptions | null {
  return CAPTION_PLATFORMS.has(platformId) ? (platformId as keyof MarketingCaptions) : null;
}

function writeLocaleCaption(
  existing: MarketingContentPackage,
  platformId: MarketingPlatformId,
  asset: PlatformMarketingAsset,
  locale: MarketingPackLocale
): MarketingContentPackage {
  const target: MarketingPackLocale = platformId === "xiaohongshu" ? "zh" : locale;
  const key = captionKey(platformId);
  const captions = { ...existing.captions };
  const captionsEn = { ...(existing.captionsEn ?? {}) };
  const captionsMs = { ...(existing.captionsMs ?? {}) };
  const assets = { ...(existing.platformAssets ?? {}) };

  if (target === "zh") {
    if (key) captions[key] = asset.caption;
    const prev = assets[platformId] ?? { caption: "", cta: "", hashtags: [] };
    assets[platformId] = { ...prev, ...asset, caption: asset.caption };
  } else if (target === "en") {
    if (key) captionsEn[key] = asset.caption;
  } else if (key) {
    captionsMs[key] = asset.caption;
  }

  const normalized = normalizeMarketingContentPackage({
    ...existing,
    captions,
    captionsEn,
    captionsMs,
    platformAssets: assets,
  });
  if (!normalized) {
    throw new Error("Invalid marketing pack");
  }
  // Normalize folds hook, hashtags, and CTA into the Chinese caption map.
  // A locale save must keep the caption written above, not that joined copy.
  return {
    ...normalized,
    captions,
    captionsEn,
    captionsMs,
    platformAssets: assets,
  };
}

/** Update one platform in one locale. Other locales and platforms stay as stored. */
export function applyPlatformLocaleEdit(
  existing: MarketingContentPackage,
  platformId: MarketingPlatformId,
  asset: PlatformMarketingAsset,
  locale: MarketingPackLocale
): MarketingContentPackage {
  return writeLocaleCaption(existing, platformId, asset, locale);
}

/** Store a regenerated asset in the requested locale only. */
export function applyPlatformRegeneration(
  existing: MarketingContentPackage,
  platformId: MarketingPlatformId,
  asset: PlatformMarketingAsset,
  locale: MarketingPackLocale
): MarketingContentPackage {
  return writeLocaleCaption(existing, platformId, asset, locale);
}

export function attachMarketingPackRevision(
  progress: StepProgress,
  contentPackage: MarketingContentPackage,
  nextRevision: number
): StepProgress {
  const current = progress.content_generate;
  return {
    ...progress,
    content_generate: {
      status: current?.status ?? "completed",
      startedAt: current?.startedAt,
      completedAt: current?.completedAt ?? new Date().toISOString(),
      output: contentPackage,
      contentRevision: nextRevision,
    },
  };
}
