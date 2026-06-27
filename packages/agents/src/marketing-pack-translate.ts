import type { MarketingCaptions, MarketingContentPackage } from "@ceo-agent/shared";
import {
  isChineseText,
  isMarketingPackFullyTranslated,
} from "@ceo-agent/shared";
import { callJsonModel } from "./llm";

/** English voice scripts are needed for 中英 (bilingual) subtitles when the primary script is Chinese. */
function needsEnglishVoiceScripts(pkg: MarketingContentPackage): boolean {
  const primary = [
    pkg.voiceScripts["15s"],
    pkg.voiceScripts["30s"],
    pkg.voiceScripts["60s"],
  ].join("");
  if (!isChineseText(primary)) return false;
  const en = pkg.voiceScriptsEn;
  const enFilled = Boolean(
    en && [en["15s"], en["30s"], en["60s"]].some((s) => s?.trim() && !isChineseText(s))
  );
  return !enFilled;
}

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
  voiceScriptsEn?: { "15s"?: string; "30s"?: string; "60s"?: string };
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

  const voiceScriptsEn = batch.voiceScriptsEn
    ? {
        "15s": batch.voiceScriptsEn["15s"]?.trim() || pkg.voiceScriptsEn?.["15s"] || "",
        "30s": batch.voiceScriptsEn["30s"]?.trim() || pkg.voiceScriptsEn?.["30s"] || "",
        "60s": batch.voiceScriptsEn["60s"]?.trim() || pkg.voiceScriptsEn?.["60s"] || "",
      }
    : pkg.voiceScriptsEn;

  return {
    ...pkg,
    hooks,
    cta,
    captionsEn: { ...pkg.captionsEn, ...batch.captionsEn },
    captionsMs: { ...pkg.captionsMs, ...batch.captionsMs },
    voiceScriptsEn,
  };
}

/** Fill textEn / textMs / captionsEn / captionsMs / voiceScriptsEn when the content agent omitted them. */
export async function enrichMarketingPackTranslations(
  pkg: MarketingContentPackage
): Promise<{ contentPackage: MarketingContentPackage; usage: { input: number; output: number; costUsd: number } }> {
  const needsVoiceScripts = needsEnglishVoiceScripts(pkg);
  if (isMarketingPackFullyTranslated(pkg) && !needsVoiceScripts) {
    return { contentPackage: pkg, usage: { input: 0, output: 0, costUsd: 0 } };
  }

  const payload = {
    hooks: pkg.hooks.map((h) => h.text),
    cta: pkg.cta.map((c) => c.text),
    captions: Object.fromEntries(
      CAPTION_KEYS.filter((k) => pkg.captions[k]?.trim()).map((k) => [k, pkg.captions[k]])
    ),
    ...(needsVoiceScripts
      ? {
          voiceScripts: {
            "15s": pkg.voiceScripts["15s"],
            "30s": pkg.voiceScripts["30s"],
            "60s": pkg.voiceScripts["60s"],
          },
        }
      : {}),
  };

  const { result, usage } = await callJsonModel<TranslationBatch>(
    `You translate short-form marketing copy for Malaysia/Southeast Asia brands.
Return natural English (en) and Bahasa Malaysia (ms) versions.
Keep brand names, numbers, hashtags, and platform handles unchanged.
Do not mix Chinese characters into en/ms fields.
Array lengths must match the input hooks and cta arrays.
When voiceScripts are provided, translate each (15s/30s/60s) into natural spoken English for on-screen bilingual subtitles, preserving meaning and length.`,
    JSON.stringify(payload),
    `{ hooksEn: string[], hooksMs: string[], ctaEn: string[], ctaMs: string[], captionsEn: { tiktok?, instagram?, facebook?, linkedin?, xiaohongshu?, youtubeShorts?, googleBusiness? }, captionsMs: same keys, voiceScriptsEn?: { "15s"?, "30s"?, "60s"? } }`
  );

  return { contentPackage: mergeTranslations(pkg, result), usage };
}
