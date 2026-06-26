import type {
  MarketingCaptions,
  MarketingContentPackage,
  PlatformMarketingAsset,
} from "./types/marketing-os";
import type { MarketingPlatformId } from "./marketing-dashboard";
import {
  pickCtaText,
  pickHookText,
  pickPlatformCaption,
  type MarketingPackLocale,
} from "./marketing-pack-locale";
import { platformAssetToCaption } from "./marketing-dashboard";

/** Display-layer localization — does not mutate stored package. */
export function localizeMarketingPackage(
  pkg: MarketingContentPackage,
  locale: MarketingPackLocale
): MarketingContentPackage {
  if (locale === "zh") return pkg;

  const hooks = pkg.hooks.map((h) => ({
    ...h,
    text: pickHookText(h, locale) || h.text,
    type: h.type,
  }));

  const cta = pkg.cta.map((c) => ({
    ...c,
    text: pickCtaText(c, locale) || c.text,
    style: c.style,
  }));

  const captions = { ...pkg.captions };
  for (const key of Object.keys(captions) as (keyof MarketingCaptions)[]) {
    const localized = pickPlatformCaption(pkg, key, locale);
    if (localized) (captions as Record<string, string>)[key] = localized;
  }

  const platformAssets: Partial<Record<MarketingPlatformId, PlatformMarketingAsset>> = {};
  if (pkg.platformAssets && Object.keys(pkg.platformAssets).length > 0) {
    for (const [id, asset] of Object.entries(pkg.platformAssets)) {
      if (!asset) continue;
      const cap = pickPlatformCaption(pkg, id as keyof MarketingCaptions, locale);
      platformAssets[id as MarketingPlatformId] = {
        ...asset,
        caption: cap || asset.caption,
        hook: asset.hook,
        title: asset.title,
        description: asset.description,
        cta: asset.cta,
        hashtags: asset.hashtags,
      };
    }
  } else {
    for (const key of Object.keys(captions) as (keyof MarketingCaptions)[]) {
      const cap = captions[key]?.trim();
      if (!cap) continue;
      platformAssets[key as MarketingPlatformId] = {
        caption: cap,
        cta: "",
        hashtags: [],
      };
    }
  }

  return {
    ...pkg,
    hooks,
    cta,
    captions,
    platformAssets,
  };
}

export function localizedPlatformDisplayText(asset: PlatformMarketingAsset): string {
  return platformAssetToCaption(asset);
}
