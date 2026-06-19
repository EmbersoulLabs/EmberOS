import type { Platform } from "./types/index";
import { getPlatformSpec } from "./platform-specs/index";

export type CopyLocale = "en" | "zh";
export type CopyTemplate = "pain_point" | "comparison" | "story";

export interface CopyMixSlot {
  id: string;
  locale: CopyLocale;
  platform: Platform;
  template: CopyTemplate;
}

const EN_TEMPLATES: CopyTemplate[] = ["pain_point", "comparison"];
const ZH_TEMPLATES: CopyTemplate[] = ["story"];
const ALL_TEMPLATES: CopyTemplate[] = ["pain_point", "comparison", "story"];

function platformLocale(platform: Platform): CopyLocale {
  return getPlatformSpec(platform).locale.startsWith("zh") ? "zh" : "en";
}

function enPlatforms(platforms: Platform[]): Platform[] {
  return platforms.filter((p) => platformLocale(p) === "en");
}

function zhPlatforms(platforms: Platform[]): Platform[] {
  return platforms.filter((p) => platformLocale(p) === "zh");
}

/** Default: bilingual campaigns → 2 EN + 1 ZH; single-language → 3 variants. */
export function resolveCopyMix(platforms: Platform[]): CopyMixSlot[] {
  const list = platforms.length ? platforms : (["tiktok"] as Platform[]);
  const enList = enPlatforms(list);
  const zhList = zhPlatforms(list);

  if (enList.length > 0 && zhList.length > 0) {
    const enA = enList[0]!;
    const enB = enList[1] ?? enA;
    const zhPrimary = zhList[0]!;
    return [
      { id: "v-en-1", locale: "en", platform: enA, template: EN_TEMPLATES[0]! },
      { id: "v-en-2", locale: "en", platform: enB, template: EN_TEMPLATES[1]! },
      { id: "v-zh-1", locale: "zh", platform: zhPrimary, template: ZH_TEMPLATES[0]! },
    ];
  }

  // Chinese-only platforms — still generate 1 EN variant for bilingual on-screen subtitles
  if (zhList.length > 0 && enList.length === 0) {
    const zhPrimary = zhList[0]!;
    return [
      { id: "v-zh-1", locale: "zh", platform: zhPrimary, template: "pain_point" },
      { id: "v-zh-2", locale: "zh", platform: zhPrimary, template: "comparison" },
      { id: "v-en-1", locale: "en", platform: "tiktok", template: "story" },
    ];
  }

  // English-only platforms — add 1 ZH variant for bilingual on-screen subtitles
  if (enList.length > 0 && zhList.length === 0) {
    const enA = enList[0]!;
    const enB = enList[1] ?? enA;
    return [
      { id: "v-en-1", locale: "en", platform: enA, template: EN_TEMPLATES[0]! },
      { id: "v-en-2", locale: "en", platform: enB, template: EN_TEMPLATES[1]! },
      { id: "v-zh-1", locale: "zh", platform: "xiaohongshu", template: ZH_TEMPLATES[0]! },
    ];
  }

  const locale: CopyLocale = zhList.length > 0 && enList.length === 0 ? "zh" : "en";
  const primary = list[0]!;
  return ALL_TEMPLATES.map((template, i) => ({
    id: locale === "zh" ? `v-zh-${i + 1}` : `v-en-${i + 1}`,
    locale,
    platform: primary,
    template,
  }));
}

export function pickCopyVariantForPlatform<T extends { id: string; platform: Platform; locale?: CopyLocale }>(
  variants: T[],
  platform: Platform,
  fallbackId?: string | null
): T | undefined {
  const want = platformLocale(platform);
  return (
    variants.find((v) => v.platform === platform && (v.locale ?? platformLocale(v.platform)) === want) ??
    variants.find((v) => (v.locale ?? platformLocale(v.platform)) === want) ??
    variants.find((v) => v.platform === platform) ??
    variants.find((v) => v.id === fallbackId) ??
    variants[0]
  );
}

export function pickBestLocaleVariant<T extends { locale?: CopyLocale; body?: string }>(
  variants: T[],
  locale: CopyLocale
): T | undefined {
  return variants
    .filter((v) => v.locale === locale)
    .sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))[0];
}

export function pickBilingualCopyPair<T extends { locale?: CopyLocale; body?: string }>(
  variants: T[]
): { en: T; zh: T } | null {
  const en = pickBestLocaleVariant(variants, "en");
  const zh = pickBestLocaleVariant(variants, "zh");
  if (en && zh) return { en, zh };
  return null;
}

export function pickSubtitlesCopyVariant<T extends { locale?: CopyLocale }>(
  variants: T[],
  goal?: string
): T | undefined {
  const zh = /[\u4e00-\u9fff]/.test(goal ?? "");
  if (zh) return variants.find((v) => v.locale === "zh") ?? variants[0];
  return variants.find((v) => v.locale === "en") ?? variants[0];
}
