import { baseClipFingerprint } from "./render";
import type { CopyLocale } from "./copy-mix";
import {
  buildFinalScript,
  estimateSpeechDurationSec,
  shouldUseVoiceoverForClip,
} from "./final-script";
import { isChineseText } from "./subtitle-text";
import {
  subtitlesFromBilingualScripts,
  subtitlesFromFinalScript,
} from "./subtitles-from-script";
import type { CopyVariant, EditPlan } from "./types/index";

function splitBodyLines(body: string, maxLines = 2): string[] {
  const chunks = body
    .split(/[\n。！？!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length > 0) return chunks.slice(0, maxLines);
  return body.trim() ? [body.trim().slice(0, 36)] : [];
}

/** On-screen bilingual line: Chinese on top, English below (中英). */
export function formatBilingualLine(zh: string, en: string): string {
  const z = zh.trim();
  const e = en.trim();
  if (z && e && z !== e) return `${z}\n${e}`;
  return z || e;
}

export function applyBilingualToSubtitles(
  subtitles: EditPlan["subtitles"],
  en: CopyVariant,
  zh: CopyVariant
): EditPlan["subtitles"] {
  if (subtitles.length === 0) return subtitles;

  const enBody = splitBodyLines(en.body);
  const zhBody = splitBodyLines(zh.body);
  const bodySlots = subtitles.filter((s) => s.style === "body");
  const hookText = formatBilingualLine(zh.hook, en.hook);
  const ctaText = formatBilingualLine(zh.cta, en.cta);

  return subtitles.map((s) => {
    if (s.style === "hook" || s.style === "bold_center") {
      return { ...s, text: hookText };
    }
    if (s.style === "cta") {
      return { ...s, text: ctaText };
    }
    if (s.style === "body") {
      const idx = bodySlots.indexOf(s);
      const zhLine = zhBody[idx] ?? zhBody[zhBody.length - 1] ?? zh.body;
      const enLine = enBody[idx] ?? enBody[enBody.length - 1] ?? en.body;
      return { ...s, text: formatBilingualLine(zhLine, enLine) };
    }
    return s;
  });
}

function resolveEnZh(variant: CopyVariant, alt?: CopyVariant): { en: CopyVariant; zh: CopyVariant } | null {
  if (!alt || variant.locale === alt.locale) return null;
  const en = variant.locale === "en" ? variant : alt;
  const zh = variant.locale === "zh" ? variant : alt;
  return { en, zh };
}

/** Sync edit-plan subtitle text from a copy variant without changing timing. */
export function syncSubtitlesFromCopy(
  editPlan: EditPlan,
  variant: CopyVariant,
  altVariant?: CopyVariant
): EditPlan {
  const pair = resolveEnZh(variant, altVariant);
  if (pair) {
    return {
      ...editPlan,
      subtitles: applyBilingualToSubtitles(editPlan.subtitles, pair.en, pair.zh),
    };
  }

  const subs = [...editPlan.subtitles];
  if (subs.length === 0) return editPlan;

  const parts = [variant.hook, variant.body, variant.cta].filter(Boolean);
  if (parts.length === 0) return editPlan;

  if (subs.length >= 3 && parts.length >= 3) {
    subs[0] = { ...subs[0]!, text: parts[0]! };
    subs[1] = { ...subs[1]!, text: parts[1]! };
    subs[subs.length - 1] = { ...subs[subs.length - 1]!, text: parts[2]! };
  } else if (subs.length === 1) {
    subs[0] = { ...subs[0]!, text: parts.join(" ") };
  } else {
    for (let i = 0; i < subs.length; i++) {
      subs[i] = { ...subs[i]!, text: parts[i % parts.length]! };
    }
  }

  return { ...editPlan, subtitles: subs };
}

export function canUseSubtitleOnlyRerender(before: EditPlan, after: EditPlan): boolean {
  return baseClipFingerprint(before) === baseClipFingerprint(after);
}

function resolveVoiceLocale(editPlan: EditPlan, variant: CopyVariant): CopyLocale {
  if (editPlan.audio.voiceover?.locale === "en" || editPlan.audio.voiceover?.locale === "zh") {
    return editPlan.audio.voiceover.locale;
  }
  if (variant.locale === "en" || variant.locale === "zh") return variant.locale;
  return "en";
}

/**
 * Sync TTS script (finalScript), voiceover segments, and subtitles from updated copy.
 * Replaces syncSubtitlesFromCopy for copy-save flows that should regenerate narration.
 */
export function syncEditPlanFromCopy(
  editPlan: EditPlan,
  variant: CopyVariant,
  altVariant?: CopyVariant
): EditPlan {
  const pair = resolveEnZh(variant, altVariant);
  const locale = resolveVoiceLocale(editPlan, variant);
  // Use body to check language: cta may fall back to Chinese even on the "en" variant.
  const bilingual = Boolean(pair && pair.zh.id !== pair.en.id && !isChineseText(pair.en.body ?? ""));

  let finalScriptZh: string | undefined;
  let finalScriptEn: string | undefined;
  if (pair) {
    // Prefer body over full finalScript so Chinese cta fallback doesn't poison the English track.
    finalScriptZh = pair.zh.body?.trim() || buildFinalScript(pair.zh, "zh");
    finalScriptEn = pair.en.body?.trim() || buildFinalScript(pair.en, "en");
  }

  const primaryScript = bilingual
    ? ((locale === "zh" ? finalScriptZh : finalScriptEn) ?? buildFinalScript(variant, locale))
    : buildFinalScript(variant, locale);

  if (!primaryScript.trim()) return editPlan;

  const voEnabled = editPlan.audio.voiceover?.enabled ?? false;
  const baseDuration = editPlan.clips[0]?.outputDurationSec ?? editPlan.targetDurationSec;
  const useVoice = voEnabled && shouldUseVoiceoverForClip(baseDuration, primaryScript, locale);
  const speechDur = estimateSpeechDurationSec(primaryScript, locale);
  const targetDurationSec = useVoice
    ? Math.max(editPlan.targetDurationSec, speechDur + 0.5)
    : editPlan.targetDurationSec;

  const subtitles =
    bilingual && finalScriptZh?.trim() && finalScriptEn?.trim()
      ? subtitlesFromBilingualScripts(finalScriptZh, finalScriptEn, targetDurationSec)
      : subtitlesFromFinalScript(primaryScript, targetDurationSec, locale);

  const voice = editPlan.audio.voiceover?.voice ?? "female";

  return {
    ...editPlan,
    finalScript: primaryScript,
    finalScriptZh: bilingual ? finalScriptZh : undefined,
    finalScriptEn: bilingual ? finalScriptEn : undefined,
    targetDurationSec,
    subtitles,
    audio: {
      ...editPlan.audio,
      voiceover: voEnabled
        ? {
            enabled: true,
            locale,
            voice,
            segments: [{ startSec: 0, endSec: targetDurationSec, text: primaryScript }],
          }
        : {
            ...editPlan.audio.voiceover,
            enabled: false,
            locale,
          },
    },
  };
}

export function narrationScriptChanged(before: EditPlan, after: EditPlan): boolean {
  if ((before.finalScript ?? "").trim() !== (after.finalScript ?? "").trim()) return true;
  const beforeSeg = before.audio.voiceover?.segments?.[0]?.text ?? "";
  const afterSeg = after.audio.voiceover?.segments?.[0]?.text ?? "";
  return beforeSeg.trim() !== afterSeg.trim();
}
