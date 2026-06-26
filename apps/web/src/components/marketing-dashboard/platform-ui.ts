import type { MarketingPlatformId } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

export function platformLabelKey(id: MarketingPlatformId): TranslationKey {
  return `marketing.platform.${id}` as TranslationKey;
}

export function platformEmphasisKeys(id: MarketingPlatformId): {
  tagline: TranslationKey;
  chips: [TranslationKey, TranslationKey, TranslationKey];
} {
  return {
    tagline: `marketing.emphasis.${id}.tagline` as TranslationKey,
    chips: [
      `marketing.emphasis.${id}.c1` as TranslationKey,
      `marketing.emphasis.${id}.c2` as TranslationKey,
      `marketing.emphasis.${id}.c3` as TranslationKey,
    ],
  };
}
