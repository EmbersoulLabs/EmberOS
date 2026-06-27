import type { CopyVariant, EditPlan, PresetProfile, VisionAnalysis, Platform, SubtitleTimelineSegment } from "@ceo-agent/shared";
import {
  SCENE_ROLES,
  pickBilingualCopyPair,
  pickBestLocaleVariant,
  presetTotalDurationSec,
  RENDER_MVP_LIMITS,
  SOURCE_END_TRIM_SEC,
  clipSubtitleLine,
  firstPhrase,
  secondPhrase,
  buildFinalScript,
  estimateSpeechDurationSec,
  shouldUseVoiceoverForClip,
  subtitlesFromFinalScript,
  subtitlesFromBilingualScripts,
  subtitlesFromTimeline,
  isChineseText,
} from "@ceo-agent/shared";
import type { CopyLocale } from "@ceo-agent/shared";

/** Image beats when mixing video + stills. */
const MIXED_IMAGE_ROLES = new Set<EditPlan["clips"][number]["role"]>(["proof", "cta"]);

/** Stay away from source tail (CapCut / 剪映 end card). */
const BEAT_OFFSETS = [0.05, 0.24, 0.43, 0.58, 0.7];

function usableSourceDuration(sourceDurationSec: number): number {
  return Math.max(3, sourceDurationSec - SOURCE_END_TRIM_SEC);
}

function pickSourceStartPoints(
  vision: VisionAnalysis,
  sourceDurationSec: number,
  count: number
): number[] {
  const dur = usableSourceDuration(sourceDurationSec);
  const visionStarts = [...(vision.suggestedMoments ?? []), ...(vision.scenes ?? [])]
    .filter((m) => m.endSec - m.startSec >= 0.8 && m.startSec < dur - 0.5)
    .map((m) => Math.min(m.startSec, dur - 1))
    .sort((a, b) => a - b);

  const unique: number[] = [];
  for (const t of visionStarts) {
    if (unique.every((u) => Math.abs(u - t) > dur * 0.12)) unique.push(t);
  }

  if (unique.length >= count) {
    return unique.slice(0, count);
  }

  return BEAT_OFFSETS.slice(0, count).map((o) => o * Math.max(0.5, dur - 0.5));
}

function pushBilingualBeat(
  subtitles: EditPlan["subtitles"],
  start: number,
  end: number,
  zhText: string,
  enText: string,
  kind: "hook" | "body" | "cta"
) {
  const z = clipSubtitleLine(zhText, "zh");
  const e = clipSubtitleLine(enText, "en");
  if (z) {
    subtitles.push({
      startSec: start,
      endSec: end,
      text: z,
      style: kind === "hook" ? "hook_zh" : kind === "cta" ? "cta_zh" : "body_zh",
    });
  }
  if (e && e !== z) {
    subtitles.push({
      startSec: start,
      endSec: end,
      text: e,
      style: kind === "hook" ? "hook_en" : kind === "cta" ? "cta_en" : "body_en",
    });
  } else if (!z && e) {
    subtitles.push({
      startSec: start,
      endSec: end,
      text: e,
      style: kind === "hook" ? "hook_en" : kind === "cta" ? "cta_en" : "body_en",
    });
  }
}

function subtitleBeatsForMontage(
  preset: PresetProfile,
  variants: CopyVariant[]
): EditPlan["subtitles"] {
  const pair = pickBilingualCopyPair(variants);
  const en = pair?.en ?? pickBestLocaleVariant(variants, "en") ?? variants[0]!;
  const zh = pair?.zh ?? pickBestLocaleVariant(variants, "zh");
  // Check that the English variant's body is actually in English; cta may fall back to Chinese.
  const bilingual = Boolean(zh && en && zh.id !== en.id && !isChineseText(en.body ?? ""));

  let t = 0;
  const subtitles: EditPlan["subtitles"] = [];

  for (const role of SCENE_ROLES) {
    const duration = preset.scenePacing[role];
    const start = t;
    const end = t + duration;

    if (role === "hook") {
      if (bilingual) pushBilingualBeat(subtitles, start, end, zh!.hook, en.hook, "hook");
      else {
        const locale = en.locale === "en" ? "en" : "zh";
        subtitles.push({
          startSec: start,
          endSec: end,
          text: clipSubtitleLine(en.hook, locale),
          style: locale === "en" ? "hook_en" : "hook_zh",
        });
      }
    } else if (role === "cta") {
      if (bilingual) pushBilingualBeat(subtitles, start, end, zh!.cta, en.cta, "cta");
      else {
        const locale = en.locale === "en" ? "en" : "zh";
        subtitles.push({
          startSec: start,
          endSec: end,
          text: clipSubtitleLine(en.cta, locale),
          style: locale === "en" ? "cta_en" : "cta_zh",
        });
      }
    } else if (role === "product") {
      if (bilingual) {
        pushBilingualBeat(
          subtitles,
          start,
          end,
          firstPhrase(zh!.body, "zh"),
          firstPhrase(en.body, "en"),
          "body"
        );
      } else {
        const locale = en.locale === "en" ? "en" : "zh";
        subtitles.push({
          startSec: start,
          endSec: end,
          text: firstPhrase(en.body, locale),
          style: locale === "en" ? "body_en" : "body_zh",
        });
      }
    } else if (role === "benefits") {
      if (bilingual) {
        pushBilingualBeat(
          subtitles,
          start,
          end,
          secondPhrase(zh!.body, "zh"),
          secondPhrase(en.body, "en"),
          "body"
        );
      } else {
        const locale = en.locale === "en" ? "en" : "zh";
        subtitles.push({
          startSec: start,
          endSec: end,
          text: secondPhrase(en.body, locale),
          style: locale === "en" ? "body_en" : "body_zh",
        });
      }
    } else if (role === "proof") {
      if (bilingual) {
        pushBilingualBeat(
          subtitles,
          start,
          end,
          clipSubtitleLine(zh!.title || zh!.hook, "zh"),
          clipSubtitleLine(en.title || en.hook, "en"),
          "body"
        );
      } else {
        const locale = en.locale === "en" ? "en" : "zh";
        subtitles.push({
          startSec: start,
          endSec: end,
          text: clipSubtitleLine(en.title || en.hook, locale),
          style: locale === "en" ? "body_en" : "body_zh",
        });
      }
    }

    t = end;
  }

  return subtitles;
}

function pickVoiceLocale(variants: CopyVariant[], platforms?: Platform[], goal?: string): CopyLocale {
  if (goal && /[\u4e00-\u9fff]/.test(goal)) return "zh";
  const zhVariant = variants.find((v) => v.locale === "zh");
  const enVariant = variants.find((v) => v.locale === "en");
  if (zhVariant && !enVariant) return "zh";
  if (enVariant && !zhVariant) return "en";
  if (platforms?.some((p) => p === "xiaohongshu" || p === "douyin")) return "zh";
  const zhText = [zhVariant?.hook, zhVariant?.body, zhVariant?.cta].filter(Boolean).join(" ");
  if (zhText && /[\u4e00-\u9fff]/.test(zhText)) return "zh";
  return "en";
}

/** Attach TTS voiceover — finalScript is the single narration source. */
export function attachVoiceover(
  plan: EditPlan,
  variants: CopyVariant[],
  platforms?: Platform[],
  goal?: string,
  subtitleTimeline?: SubtitleTimelineSegment[]
): EditPlan {
  const locale = pickVoiceLocale(variants, platforms, goal);
  const primary = pickBestLocaleVariant(variants, locale) ?? variants[0];
  if (!primary) return plan;

  const finalScript = plan.finalScript ?? buildFinalScript(primary, locale);
  if (!finalScript.trim()) return plan;

  const clipDurationSec = plan.targetDurationSec;
  const useVoice = shouldUseVoiceoverForClip(clipDurationSec, finalScript, locale);
  const speechDur = estimateSpeechDurationSec(finalScript, locale);
  const targetDurationSec = useVoice ? Math.max(clipDurationSec, speechDur + 0.5) : clipDurationSec;
  const pair = pickBilingualCopyPair(variants);
  const sourceStart = plan.clips.length > 0 ? Math.min(...plan.clips.map((c) => c.startSec)) : 0;
  const sourceEnd = plan.clips.length > 0 ? Math.max(...plan.clips.map((c) => c.endSec)) : targetDurationSec;

  let subtitles =
    subtitleTimeline && subtitleTimeline.length > 0
      ? subtitlesFromTimeline(subtitleTimeline, sourceStart, sourceEnd, targetDurationSec, locale)
      : pair && pair.zh.id !== pair.en.id
        ? subtitlesFromBilingualScripts(
            buildFinalScript(pair.zh, "zh"),
            buildFinalScript(pair.en, "en"),
            targetDurationSec
          )
        : subtitlesFromFinalScript(finalScript, targetDurationSec, locale);

  if (subtitles.length === 0) {
    subtitles =
      pair && pair.zh.id !== pair.en.id
        ? subtitlesFromBilingualScripts(
            buildFinalScript(pair.zh, "zh"),
            buildFinalScript(pair.en, "en"),
            targetDurationSec
          )
        : subtitlesFromFinalScript(finalScript, targetDurationSec, locale);
  }

  return {
    ...plan,
    finalScript,
    finalScriptZh: pair && pair.zh.id !== pair.en.id ? buildFinalScript(pair.zh, "zh") : undefined,
    finalScriptEn: pair && pair.zh.id !== pair.en.id ? buildFinalScript(pair.en, "en") : undefined,
    targetDurationSec,
    subtitles,
    audio: {
      ...plan.audio,
      keepOriginal: false,
      bgm: plan.audio.bgm ?? "marketing",
      voiceover: useVoice
        ? {
            enabled: true,
            locale,
            segments: [{ startSec: 0, endSec: targetDurationSec, text: finalScript }],
          }
        : { enabled: false, locale },
    },
  };
}

function basePlanFields(
  preset: PresetProfile,
  copyVariants: CopyVariant[],
  clips: EditPlan["clips"],
  coverAtSec: number
): Omit<EditPlan, "clips"> & { clips: EditPlan["clips"] } {
  const pair = pickBilingualCopyPair(copyVariants);
  const en = pair?.en ?? copyVariants[0]!;
  const targetDurationSec = Math.min(
    presetTotalDurationSec(preset),
    RENDER_MVP_LIMITS.MAX_MONTAGE_OUTPUT_SEC
  );
  return {
    aspectRatio: "9:16",
    targetDurationSec,
    outputResolution: { preview: "720x1280", export: "1080x1920" },
    clips,
    subtitles: subtitleBeatsForMontage(preset, copyVariants),
    cover: { atSec: coverAtSec, overlayText: en.title },
    audio: { keepOriginal: false, bgm: preset.id, normalize: true },
    effects: [{ type: "fade_in", startSec: 0, durationSec: 0.25 }],
  };
}

export interface MixedMontageInput {
  vision: VisionAnalysis;
  preset: PresetProfile;
  copyVariants: CopyVariant[];
  videoAssetId: string;
  imageAssetIds: string[];
  sourceDurationSec: number;
  maxDurationSec?: number;
}

/** Video beats for hook/product/benefits; product stills for proof/cta. */
export function buildMixedMontageEditPlan(input: MixedMontageInput): EditPlan {
  const imageIds = input.imageAssetIds;
  if (imageIds.length === 0) {
    return buildMontageEditPlan({
      vision: input.vision,
      preset: input.preset,
      copyVariants: input.copyVariants,
      assetId: input.videoAssetId,
      sourceDurationSec: input.sourceDurationSec,
      maxDurationSec: input.maxDurationSec,
    });
  }

  const usableDur = usableSourceDuration(input.sourceDurationSec);
  const startPoints = pickSourceStartPoints(input.vision, input.sourceDurationSec, SCENE_ROLES.length);
  let imageIdx = 0;

  const clips: EditPlan["clips"] = SCENE_ROLES.map((role, i) => {
    const outputDurationSec = input.preset.scenePacing[role];
    const motion = input.preset.motionByRole[role];

    if (MIXED_IMAGE_ROLES.has(role)) {
      const assetId = imageIds[imageIdx % imageIds.length]!;
      imageIdx += 1;
      return {
        assetId,
        startSec: 0,
        endSec: 0,
        outputDurationSec,
        speed: 1,
        motion,
        role,
      };
    }

    const speed = input.preset.speedByRole[role];
    const startSec = Math.min(startPoints[i] ?? 0, Math.max(0, usableDur - 1));
    const inputNeed = outputDurationSec * speed;
    return {
      assetId: input.videoAssetId,
      startSec,
      endSec: startSec + inputNeed,
      outputDurationSec,
      speed,
      motion,
      role,
    };
  });

  const heroStart = clips[0]?.startSec ?? 0;
  return basePlanFields(input.preset, input.copyVariants, clips, heroStart + 0.4);
}

export interface MontageInput {
  vision: VisionAnalysis;
  preset: PresetProfile;
  copyVariants: CopyVariant[];
  assetId: string;
  sourceDurationSec: number;
  maxDurationSec?: number;
}

export interface ImageMontageInput {
  vision: VisionAnalysis;
  preset: PresetProfile;
  copyVariants: CopyVariant[];
  imageAssetIds: string[];
  maxDurationSec?: number;
}

export function buildImageMontageEditPlan(input: ImageMontageInput): EditPlan {
  const ids = input.imageAssetIds;
  if (ids.length === 0) throw new Error("No image assets for slideshow");

  const clips: EditPlan["clips"] = SCENE_ROLES.map((role, i) => ({
    assetId: ids[i % ids.length]!,
    startSec: 0,
    endSec: 0,
    outputDurationSec: input.preset.scenePacing[role],
    speed: 1,
    motion: input.preset.motionByRole[role],
    role,
  }));

  return basePlanFields(input.preset, input.copyVariants, clips, 0);
}

export function buildMontageEditPlan(input: MontageInput): EditPlan {
  const maxDur = input.maxDurationSec ?? RENDER_MVP_LIMITS.MAX_MONTAGE_OUTPUT_SEC;
  const usableDur = usableSourceDuration(input.sourceDurationSec);
  const startPoints = pickSourceStartPoints(input.vision, input.sourceDurationSec, SCENE_ROLES.length);

  const clips: EditPlan["clips"] = SCENE_ROLES.map((role, i) => {
    const outputDurationSec = input.preset.scenePacing[role];
    const speed = input.preset.speedByRole[role];
    const startSec = Math.min(startPoints[i] ?? 0, Math.max(0, usableDur - 1));
    const inputNeed = outputDurationSec * speed;

    return {
      assetId: input.assetId,
      startSec,
      endSec: startSec + inputNeed,
      outputDurationSec,
      speed,
      motion: input.preset.motionByRole[role],
      role,
    };
  });

  const heroStart = clips[0]?.startSec ?? 0;
  const plan = basePlanFields(input.preset, input.copyVariants, clips, heroStart + 0.4);
  return { ...plan, targetDurationSec: Math.min(plan.targetDurationSec, maxDur) };
}
