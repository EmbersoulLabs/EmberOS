import type { CopyLocale, EditPlan } from "@ceo-agent/shared";
import type { VoicePreset } from "@ceo-agent/shared";
import {
  DEFAULT_VOICE_PRESET,
  detectScriptLocale,
  estimateSpeechDurationSec,
} from "@ceo-agent/shared";

function resolveVoiceLocale(plan: EditPlan): CopyLocale {
  if (plan.audio.voiceover?.locale === "en" || plan.audio.voiceover?.locale === "zh") {
    return plan.audio.voiceover.locale;
  }
  if (plan.finalScriptZh?.trim()) return "zh";
  if (plan.finalScriptEn?.trim()) return "en";
  if (plan.finalScript?.trim()) return detectScriptLocale(plan.finalScript);
  return "en";
}

function resolveVoiceScript(plan: EditPlan, locale: CopyLocale): string {
  if (locale === "zh" && plan.finalScriptZh?.trim()) return plan.finalScriptZh.trim();
  if (locale === "en" && plan.finalScriptEn?.trim()) return plan.finalScriptEn.trim();
  return plan.finalScript?.trim() ?? "";
}

function enableVoiceover(
  plan: EditPlan,
  voice: "female" | "male",
  locale?: CopyLocale
): EditPlan {
  const resolvedLocale = locale ?? resolveVoiceLocale(plan);
  const finalScript = resolveVoiceScript(plan, resolvedLocale);
  const speechDur = finalScript ? estimateSpeechDurationSec(finalScript, resolvedLocale) : 0;
  const targetDurationSec = finalScript
    ? Math.max(plan.targetDurationSec, speechDur + 0.5)
    : plan.targetDurationSec;

  return {
    ...plan,
    finalScript: finalScript || plan.finalScript,
    targetDurationSec,
    clips: plan.clips.map((clip) => ({
      ...clip,
      outputDurationSec: targetDurationSec,
    })),
    audio: {
      ...plan.audio,
      keepOriginal: false,
      voiceover: {
        ...plan.audio.voiceover,
        enabled: true,
        locale: resolvedLocale,
        voice,
        segments: finalScript
          ? [{ startSec: 0, endSec: targetDurationSec, text: finalScript }]
          : (plan.audio.voiceover?.segments ?? []),
      },
    },
  };
}

/** Apply user voice preference to an edit plan before render. */
export function applyVoicePreset(plan: EditPlan, preset: VoicePreset = DEFAULT_VOICE_PRESET): EditPlan {
  if (preset === "auto") return plan;

  if (preset === "keep_original") {
    return {
      ...plan,
      audio: {
        ...plan.audio,
        keepOriginal: true,
        voiceover: { enabled: false, locale: plan.audio.voiceover?.locale },
      },
    };
  }

  if (preset === "none") {
    return {
      ...plan,
      audio: {
        ...plan.audio,
        keepOriginal: false,
        voiceover: { enabled: false, locale: plan.audio.voiceover?.locale },
      },
    };
  }

  if (preset === "female" || preset === "male") {
    return enableVoiceover(plan, preset);
  }

  return plan;
}
