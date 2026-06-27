import {
  DEFAULT_SUBTITLE_LANGUAGE,
  DEFAULT_SUBTITLE_STYLE,
  parseSubtitleLanguagePair,
  resolveSubtitleStyle,
  type SubtitleLanguagePair,
  type SubtitleStylePreset,
} from "./subtitle-styles";

export interface RenderPreferences {
  subtitleStyle: SubtitleStylePreset;
  subtitleLanguage: SubtitleLanguagePair;
}

export const DEFAULT_RENDER_PREFERENCES: RenderPreferences = {
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  subtitleLanguage: DEFAULT_SUBTITLE_LANGUAGE,
};

const STYLE_VALUES = new Set<string>(["minimal", "corporate", "modern", "social"]);
const LANG_VALUES = new Set<string>([
  "zh",
  "en",
  "ms",
  "zh_en",
  "en_zh",
  "zh_ms",
  "en_ms",
]);

export function isSubtitleStylePreset(value: string): value is SubtitleStylePreset {
  return STYLE_VALUES.has(value);
}

export function isSubtitleLanguagePair(value: string): value is SubtitleLanguagePair {
  return LANG_VALUES.has(value);
}

export function parseRenderPreferences(raw: unknown): RenderPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const style = o.subtitleStyle;
  const lang = o.subtitleLanguage;
  if (
    typeof style === "string" &&
    isSubtitleStylePreset(style) &&
    typeof lang === "string" &&
    isSubtitleLanguagePair(lang)
  ) {
    return { subtitleStyle: style, subtitleLanguage: lang };
  }
  return null;
}

/** Resolve render prefs: editPlan → campaign metadata → defaults. */
export function resolveRenderPreferences(input: {
  editPlan?: { renderPreferences?: RenderPreferences | null } | null;
  campaignMetadata?: Record<string, unknown> | null;
}): RenderPreferences {
  const fromPlan = input.editPlan?.renderPreferences;
  if (fromPlan?.subtitleStyle && fromPlan?.subtitleLanguage) return fromPlan;

  const fromMeta = parseRenderPreferences(input.campaignMetadata?.renderPreferences);
  if (fromMeta) return fromMeta;

  const legacyStyle = input.campaignMetadata?.subtitleStyle;
  const legacyLang = input.campaignMetadata?.subtitleLanguage;
  if (
    typeof legacyStyle === "string" &&
    isSubtitleStylePreset(legacyStyle) &&
    typeof legacyLang === "string" &&
    isSubtitleLanguagePair(legacyLang)
  ) {
    return { subtitleStyle: legacyStyle, subtitleLanguage: legacyLang };
  }

  return DEFAULT_RENDER_PREFERENCES;
}

export function stampRenderPreferences<T extends { renderPreferences?: RenderPreferences }>(
  editPlan: T,
  prefs: RenderPreferences
): T {
  return { ...editPlan, renderPreferences: prefs };
}

/** Primary/secondary locales for bilingual subtitle line order. */
export function subtitleLocalesFromPreferences(
  prefs: RenderPreferences
): { primary: "zh" | "en" | "ms"; secondary: "zh" | "en" | "ms" | null } {
  return parseSubtitleLanguagePair(prefs.subtitleLanguage);
}

export function resolveSubtitleStyleFromPreferences(prefs: RenderPreferences) {
  return resolveSubtitleStyle(prefs.subtitleStyle);
}
