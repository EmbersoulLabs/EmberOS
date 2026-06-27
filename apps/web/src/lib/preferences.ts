import type { RenderPreferences } from "@ceo-agent/shared";
import type { SubtitleLanguagePair, SubtitleStylePreset } from "@ceo-agent/shared";
import { isLocale, type Locale } from "@ceo-agent/shared/i18n";

const AI_OUTPUT_KEY = "emberos-ai-output-lang";
const SUBTITLE_LANG_KEY = "emberos-subtitle-lang";
const SUBTITLE_STYLE_KEY = "emberos-subtitle-style";

export type AiOutputLanguage = "auto" | Locale;

export function getAiOutputLanguage(): AiOutputLanguage {
  if (typeof window === "undefined") return "auto";
  const stored = localStorage.getItem(AI_OUTPUT_KEY);
  if (stored === "auto") return "auto";
  if (stored && isLocale(stored)) return stored;
  return "auto";
}

export function setAiOutputLanguage(value: AiOutputLanguage): void {
  localStorage.setItem(AI_OUTPUT_KEY, value);
}

export function resolveContentLocaleForRun(uiLocale: Locale): Locale {
  const pref = getAiOutputLanguage();
  if (pref === "auto") return uiLocale;
  return pref;
}

export function getSubtitleLanguage(): SubtitleLanguagePair {
  if (typeof window === "undefined") return "zh_en";
  const stored = localStorage.getItem(SUBTITLE_LANG_KEY);
  const valid: SubtitleLanguagePair[] = ["zh", "en", "ms", "zh_en", "en_zh", "zh_ms", "en_ms"];
  if (stored && valid.includes(stored as SubtitleLanguagePair)) {
    return stored as SubtitleLanguagePair;
  }
  return "zh_en";
}

export function setSubtitleLanguage(value: SubtitleLanguagePair): void {
  localStorage.setItem(SUBTITLE_LANG_KEY, value);
}

export function getSubtitleStyle(): SubtitleStylePreset {
  if (typeof window === "undefined") return "minimal";
  const stored = localStorage.getItem(SUBTITLE_STYLE_KEY);
  const valid: SubtitleStylePreset[] = ["minimal", "corporate", "modern", "social"];
  if (stored && valid.includes(stored as SubtitleStylePreset)) {
    return stored as SubtitleStylePreset;
  }
  return "minimal";
}

export function setSubtitleStyle(value: SubtitleStylePreset): void {
  localStorage.setItem(SUBTITLE_STYLE_KEY, value);
}

export function getRenderPreferences(): RenderPreferences {
  return {
    subtitleStyle: getSubtitleStyle(),
    subtitleLanguage: getSubtitleLanguage(),
  };
}

/** Payload for campaign create / run requests. */
export function getRenderPreferencesPayload(): RenderPreferences {
  return getRenderPreferences();
}
