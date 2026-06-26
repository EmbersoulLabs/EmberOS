import type { ContentCtaItem, ContentHookItem, MarketingCaptions, MarketingContentPackage } from "./types/marketing-os";

/** Language tab for marketing pack copy (hooks, CTAs, captions) — independent of UI locale. */
export type MarketingPackLocale = "zh" | "en" | "ms";

export const MARKETING_PACK_LOCALES: MarketingPackLocale[] = ["zh", "en", "ms"];

export function pickHookText(hook: ContentHookItem, locale: MarketingPackLocale): string {
  if (locale === "en") return hook.textEn?.trim() || hook.text;
  if (locale === "ms") return hook.textMs?.trim() || hook.textEn?.trim() || hook.text;
  return hook.text;
}

export function pickCtaText(cta: ContentCtaItem, locale: MarketingPackLocale): string {
  if (locale === "en") return cta.textEn?.trim() || cta.text;
  if (locale === "ms") return cta.textMs?.trim() || cta.textEn?.trim() || cta.text;
  return cta.text;
}

export function pickPlatformCaption(
  pkg: MarketingContentPackage,
  platform: keyof MarketingCaptions,
  locale: MarketingPackLocale
): string {
  if (locale === "en") {
    return pkg.captionsEn?.[platform]?.trim() || pkg.captions[platform]?.trim() || "";
  }
  if (locale === "ms") {
    return (
      pkg.captionsMs?.[platform]?.trim() ||
      pkg.captionsEn?.[platform]?.trim() ||
      pkg.captions[platform]?.trim() ||
      ""
    );
  }
  return pkg.captions[platform]?.trim() || pkg.captionsEn?.[platform]?.trim() || "";
}
