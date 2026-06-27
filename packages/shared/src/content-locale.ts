/** Primary language for AI-generated campaign content (strategy, vision, copy). */

export type ContentLocale = "zh" | "en" | "ms";

export function contentLocaleFromMetadata(
  metadata?: Record<string, unknown> | null
): ContentLocale | undefined {
  const l = metadata?.contentLocale;
  if (l === "zh" || l === "en" || l === "ms") return l;
  return undefined;
}

/** Resolve output locale when campaign metadata omits contentLocale (legacy runs). */
export function resolvePipelineContentLocale(
  metadata?: Record<string, unknown> | null,
  fallbackGoal?: string | null
): ContentLocale {
  const fromMeta = contentLocaleFromMetadata(metadata);
  if (fromMeta) return fromMeta;
  return /[\u4e00-\u9fff]/.test(fallbackGoal ?? "") ? "zh" : "en";
}

export function outputLanguagePrompt(locale: ContentLocale): string {
  if (locale === "zh") {
    return "Write ALL string values in Simplified Chinese (简体中文).";
  }
  if (locale === "ms") {
    return "Write ALL string values in Bahasa Melayu.";
  }
  return "Write ALL string values in English. Do not use Chinese characters.";
}
