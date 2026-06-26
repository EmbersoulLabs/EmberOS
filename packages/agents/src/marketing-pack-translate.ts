import type { MarketingCaptions, MarketingContentPackage } from "@ceo-agent/shared";
import {
  isMarketingPackFullyTranslated,
} from "@ceo-agent/shared";
import { callJsonModel } from "./llm";

const CAPTION_KEYS: (keyof MarketingCaptions)[] = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "youtubeShorts",
  "googleBusiness",
];

type TranslationBatch = {
  hooksEn: string[];
  hooksMs: string[];
  ctaEn: string[];
  ctaMs: string[];
  captionsEn: MarketingCaptions;
  captionsMs: MarketingCaptions;
};

function mergeTranslations(
  pkg: MarketingContentPackage,
  batch: TranslationBatch
): MarketingContentPackage {
  const hooks = pkg.hooks.map((hook, i) => ({
    ...hook,
    textEn: batch.hooksEn[i]?.trim() || hook.textEn,
    textMs: batch.hooksMs[i]?.trim() || hook.textMs,
  }));

  const cta = pkg.cta.map((item, i) => ({
    ...item,
    textEn: batch.ctaEn[i]?.trim() || item.textEn,
    textMs: batch.ctaMs[i]?.trim() || item.textMs,
  }));

  return {
    ...pkg,
    hooks,
    cta,
    captionsEn: { ...pkg.captionsEn, ...batch.captionsEn },
    captionsMs: { ...pkg.captionsMs, ...batch.captionsMs },
  };
}

/** Fill textEn / textMs / captionsEn / captionsMs when the content agent omitted them. */
export async function enrichMarketingPackTranslations(
  pkg: MarketingContentPackage
): Promise<{ contentPackage: MarketingContentPackage; usage: { input: number; output: number; costUsd: number } }> {
  if (isMarketingPackFullyTranslated(pkg)) {
    return { contentPackage: pkg, usage: { input: 0, output: 0, costUsd: 0 } };
  }

  const payload = {
    hooks: pkg.hooks.map((h) => h.text),
    cta: pkg.cta.map((c) => c.text),
    captions: Object.fromEntries(
      CAPTION_KEYS.filter((k) => pkg.captions[k]?.trim()).map((k) => [k, pkg.captions[k]])
    ),
  };

  const { result, usage } = await callJsonModel<TranslationBatch>(
    `You translate short-form marketing copy for Malaysia/Southeast Asia brands.
Return natural English (en) and Bahasa Malaysia (ms) versions.
Keep brand names, numbers, hashtags, and platform handles unchanged.
Do not mix Chinese characters into en/ms fields.
Array lengths must match the input hooks and cta arrays.`,
    JSON.stringify(payload),
    `{ hooksEn: string[], hooksMs: string[], ctaEn: string[], ctaMs: string[], captionsEn: { tiktok?, instagram?, facebook?, linkedin?, xiaohongshu?, youtubeShorts?, googleBusiness? }, captionsMs: same keys }`
  );

  return { contentPackage: mergeTranslations(pkg, result), usage };
}
