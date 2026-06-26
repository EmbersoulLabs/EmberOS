import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ms from "./locales/ms.json";

export type Locale = "en" | "zh" | "ms";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ms", label: "Bahasa Melayu" },
];

export const DEFAULT_LOCALE: Locale = "zh";

/** Campaign goal values stored in DB → translation key */
export const CAMPAIGN_GOAL_OPTIONS = [
  { value: "种草", key: "goal.seeding" },
  { value: "带货", key: "goal.sales" },
  { value: "涨粉", key: "goal.followers" },
  { value: "品牌曝光", key: "goal.brand" },
] as const;

export type TranslationKey = keyof typeof en;

export const messages: Record<Locale, Record<TranslationKey, string>> = {
  en: en as Record<TranslationKey, string>,
  zh: zh as Record<TranslationKey, string>,
  ms: ms as Record<TranslationKey, string>,
};

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  let text = messages[locale]?.[key] ?? messages.en[key];
  if (!text) {
    text = messages.en[key] ?? "";
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "zh" || value === "ms";
}

export function statusTranslationKey(status: string): TranslationKey | null {
  const key = `status.${status}` as TranslationKey;
  return key in en ? key : null;
}

/** Map UI locale to marketing pack content locale (1:1). */
export function uiLocaleToPackLocale(locale: Locale): "zh" | "en" | "ms" {
  return locale;
}
