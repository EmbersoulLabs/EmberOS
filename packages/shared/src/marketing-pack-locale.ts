import type { ContentCtaItem, ContentHookItem, MarketingCaptions, MarketingContentPackage } from "./types/marketing-os";
import { isChineseText } from "./subtitle-text";

/** Language tab for marketing pack copy (hooks, CTAs, captions) — independent of UI locale. */
export type MarketingPackLocale = "zh" | "en" | "ms";

export const MARKETING_PACK_LOCALES: MarketingPackLocale[] = ["zh", "en", "ms"];

export function isMarketingPackTranslationValid(
  text: string | undefined,
  locale: MarketingPackLocale
): boolean {
  if (!text?.trim()) return false;
  if (locale === "zh") return true;
  return !isChineseText(text);
}

export function pickHookText(hook: ContentHookItem, locale: MarketingPackLocale): string {
  if (locale === "zh") return hook.text;
  if (locale === "en") {
    const en = hook.textEn?.trim();
    if (en && isMarketingPackTranslationValid(en, "en")) return en;
    return "";
  }
  const ms = hook.textMs?.trim();
  if (ms && isMarketingPackTranslationValid(ms, "ms")) return ms;
  const en = hook.textEn?.trim();
  if (en && isMarketingPackTranslationValid(en, "en")) return en;
  return "";
}

export function pickCtaText(cta: ContentCtaItem, locale: MarketingPackLocale): string {
  if (locale === "zh") return cta.text;
  if (locale === "en") {
    const en = cta.textEn?.trim();
    if (en && isMarketingPackTranslationValid(en, "en")) return en;
    return "";
  }
  const ms = cta.textMs?.trim();
  if (ms && isMarketingPackTranslationValid(ms, "ms")) return ms;
  const en = cta.textEn?.trim();
  if (en && isMarketingPackTranslationValid(en, "en")) return en;
  return "";
}

export function pickPlatformCaption(
  pkg: MarketingContentPackage,
  platform: keyof MarketingCaptions,
  locale: MarketingPackLocale
): string {
  // Xiaohongshu (小红书) is a Chinese-first platform — always show Chinese copy
  // regardless of the UI/pack locale.
  if (platform === "xiaohongshu") {
    return (
      pkg.captions.xiaohongshu?.trim() ||
      pkg.captionsEn?.xiaohongshu?.trim() ||
      pkg.captionsMs?.xiaohongshu?.trim() ||
      ""
    );
  }
  if (locale === "zh") {
    return pkg.captions[platform]?.trim() || pkg.captionsEn?.[platform]?.trim() || "";
  }
  if (locale === "en") {
    const en = pkg.captionsEn?.[platform]?.trim();
    if (en && isMarketingPackTranslationValid(en, "en")) return en;
    return "";
  }
  const ms = pkg.captionsMs?.[platform]?.trim();
  if (ms && isMarketingPackTranslationValid(ms, "ms")) return ms;
  const en = pkg.captionsEn?.[platform]?.trim();
  if (en && isMarketingPackTranslationValid(en, "en")) return en;
  return "";
}

export function isMarketingPackLocaleReady(
  pkg: MarketingContentPackage,
  locale: MarketingPackLocale
): boolean {
  if (locale === "zh") return true;
  const hooksOk = pkg.hooks.slice(0, 5).every((h) => {
    if (locale === "en") return isMarketingPackTranslationValid(h.textEn, "en");
    return (
      isMarketingPackTranslationValid(h.textMs, "ms") ||
      isMarketingPackTranslationValid(h.textEn, "en")
    );
  });
  if (!hooksOk) return false;
  const ctaOk = pkg.cta.slice(0, 5).every((c) => {
    if (locale === "en") return isMarketingPackTranslationValid(c.textEn, "en");
    return (
      isMarketingPackTranslationValid(c.textMs, "ms") ||
      isMarketingPackTranslationValid(c.textEn, "en")
    );
  });
  if (!ctaOk) return false;
  for (const key of Object.keys(pkg.captions) as (keyof MarketingCaptions)[]) {
    // Xiaohongshu stays Chinese by design — never blocks translation readiness.
    if (key === "xiaohongshu") continue;
    if (!pkg.captions[key]?.trim()) continue;
    const cap = pickPlatformCaption(pkg, key, locale);
    if (!isMarketingPackTranslationValid(cap, locale === "ms" ? "ms" : "en")) return false;
  }
  return true;
}

export function isMarketingPackFullyTranslated(pkg: MarketingContentPackage): boolean {
  return isMarketingPackLocaleReady(pkg, "en") && isMarketingPackLocaleReady(pkg, "ms");
}
