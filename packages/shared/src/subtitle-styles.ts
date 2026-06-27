/** Premium subtitle styling — enterprise marketing video output. */

export type SubtitleStylePreset = "minimal" | "corporate" | "modern" | "social";

export type SubtitleLanguagePair =
  | "zh"
  | "en"
  | "ms"
  | "zh_en"
  | "en_zh"
  | "zh_ms"
  | "en_ms";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStylePreset = "minimal";
export const DEFAULT_SUBTITLE_LANGUAGE: SubtitleLanguagePair = "zh_en";

export const SUBTITLE_FADE_MS = 200;
export const SUBTITLE_MARGIN_V_PX = 135;
export const SUBTITLE_SECONDARY_SCALE = 0.7;

export interface SubtitleStyleConfig {
  id: SubtitleStylePreset;
  primaryColor: string;
  outlinePx: number;
  shadowPx: number;
  primaryBold: boolean;
  secondaryBold: boolean;
  fontSizePrimary: number;
  fontSizeSecondary: number;
}

const BASE: Omit<SubtitleStyleConfig, "id"> = {
  primaryColor: "&H00FFFFFF",
  outlinePx: 0,
  shadowPx: 2,
  primaryBold: true,
  secondaryBold: false,
  fontSizePrimary: 54,
  fontSizeSecondary: 38,
};

export const SUBTITLE_STYLE_CONFIGS: Record<SubtitleStylePreset, SubtitleStyleConfig> = {
  minimal: { id: "minimal", ...BASE },
  corporate: {
    id: "corporate",
    ...BASE,
    outlinePx: 1,
    shadowPx: 3,
    fontSizePrimary: 52,
    fontSizeSecondary: 36,
  },
  modern: {
    id: "modern",
    ...BASE,
    shadowPx: 4,
    fontSizePrimary: 56,
    fontSizeSecondary: 40,
  },
  social: {
    id: "social",
    ...BASE,
    outlinePx: 2,
    fontSizePrimary: 58,
    fontSizeSecondary: 42,
  },
};

export function resolveSubtitleStyle(id?: string | null): SubtitleStyleConfig {
  if (id && id in SUBTITLE_STYLE_CONFIGS) {
    return SUBTITLE_STYLE_CONFIGS[id as SubtitleStylePreset];
  }
  return SUBTITLE_STYLE_CONFIGS.minimal;
}

/** Parse bilingual pair config into primary/secondary locale codes. */
export function parseSubtitleLanguagePair(
  pair: SubtitleLanguagePair | string | undefined
): { primary: "zh" | "en" | "ms"; secondary: "zh" | "en" | "ms" | null } {
  switch (pair) {
    case "zh":
      return { primary: "zh", secondary: null };
    case "en":
      return { primary: "en", secondary: null };
    case "ms":
      return { primary: "ms", secondary: null };
    case "en_zh":
      return { primary: "en", secondary: "zh" };
    case "zh_ms":
      return { primary: "zh", secondary: "ms" };
    case "en_ms":
      return { primary: "en", secondary: "ms" };
    case "zh_en":
    default:
      return { primary: "zh", secondary: "en" };
  }
}
