import {
  AUTO_CLIP,
  SOURCE_END_TRIM_SEC,
  pickBestLocaleVariant,
  pickBilingualCopyPair,
  buildFinalScript,
  estimateSpeechDurationSec,
  shouldUseVoiceoverForClip,
  subtitlesFromBilingualScripts,
  subtitlesFromFinalScript,
  subtitlesFromTimeline,
  isChineseText,
  buildVirtualCuts,
  inferSubjectFocus,
  type CopyLocale,
  type CopyVariant,
  type EditPlan,
  type VisionAnalysis,
  type BgmRecommendation,
  type SubtitleTimelineSegment,
} from "@ceo-agent/shared";
import type { AutoClipVariantDef } from "./auto-clip-variants";

export interface AutoClipSegment {
  index: number;
  startSec: number;
  endSec: number;
  reason: string;
}

function usableSourceEnd(sourceDurationSec: number): number {
  return Math.max(AUTO_CLIP.MIN_SEGMENT_SEC, sourceDurationSec - SOURCE_END_TRIM_SEC);
}

function normalizeSegment(
  startSec: number,
  endSec: number,
  reason: string,
  usableEnd: number
): { startSec: number; endSec: number; reason: string } {
  let start = Math.max(0, startSec);
  let end = Math.min(endSec, usableEnd);
  if (end - start < AUTO_CLIP.MIN_SEGMENT_SEC) {
    end = Math.min(start + AUTO_CLIP.OUTPUT_DURATION_SEC, usableEnd);
  }
  if (end - start > AUTO_CLIP.MAX_SEGMENT_SEC) {
    end = start + AUTO_CLIP.MAX_SEGMENT_SEC;
  }
  if (end - start < AUTO_CLIP.MIN_SEGMENT_SEC && start > 0) {
    start = Math.max(0, end - AUTO_CLIP.OUTPUT_DURATION_SEC);
  }
  return { startSec: start, endSec: end, reason };
}

function segmentsOverlap(a: AutoClipSegment, startSec: number, endSec: number, gapSec: number): boolean {
  return startSec < a.endSec + gapSec && endSec + gapSec > a.startSec;
}

function resolveBilingualScripts(variants: CopyVariant[]): {
  zhScript: string;
  enScript: string;
  hasBilingual: boolean;
} {
  const pair = pickBilingualCopyPair(variants);
  const en = pair?.en ?? pickBestLocaleVariant(variants, "en") ?? variants[0];
  const zh = pair?.zh ?? pickBestLocaleVariant(variants, "zh");
  if (!en) return { zhScript: "", enScript: "", hasBilingual: false };

  // Use body directly for subtitle scripts: buildFinalScript includes cta which may
  // fall back to Chinese when no translated CTA exists, causing the isChineseText guard
  // to wrongly disable bilingual mode even though the body is genuine English.
  const enScript = en.body?.trim() || buildFinalScript(en, "en");
  const zhScript = (zh?.body?.trim()) || (zh ? buildFinalScript(zh, "zh") : enScript);
  const hasBilingual = Boolean(
    zh &&
      en &&
      zh.id !== en.id &&
      enScript.trim() &&
      zhScript.trim() &&
      zhScript.trim() !== enScript.trim() &&
      !isChineseText(enScript)
  );

  return { zhScript, enScript, hasBilingual };
}

function clipVisualEffects(durationSec: number): EditPlan["effects"] {
  return [
    { type: "fade_in", startSec: 0, durationSec: 0.35 },
    { type: "fade_out", startSec: Math.max(0, durationSec - 0.55), durationSec: 0.5 },
  ];
}

/** Pick N non-overlapping highlight windows from vision analysis. */
export function pickAutoClipSegments(
  vision: VisionAnalysis,
  sourceDurationSec: number,
  count = AUTO_CLIP.CLIP_COUNT
): AutoClipSegment[] {
  const usableEnd = usableSourceEnd(sourceDurationSec);
  const gapSec = Math.max(3, usableEnd * 0.04);

  const candidates = [...(vision.suggestedMoments ?? []), ...(vision.scenes ?? [])]
    .filter((m) => m.endSec - m.startSec >= 0.5 && m.startSec < usableEnd - 1)
    .map((m) => {
      const norm = normalizeSegment(m.startSec, m.endSec, "reason" in m ? m.reason : m.description, usableEnd);
      return {
        startSec: norm.startSec,
        endSec: norm.endSec,
        reason: "reason" in m ? m.reason : m.description,
        span: norm.endSec - norm.startSec,
      };
    })
    .sort((a, b) => b.span - a.span);

  const picked: AutoClipSegment[] = [];
  for (const c of candidates) {
    if (picked.some((p) => segmentsOverlap(p, c.startSec, c.endSec, gapSec))) continue;
    picked.push({
      index: picked.length,
      startSec: c.startSec,
      endSec: c.endSec,
      reason: c.reason,
    });
    if (picked.length >= count) break;
  }

  if (picked.length >= count) return picked.slice(0, count);

  const windowLen = Math.min(
    AUTO_CLIP.OUTPUT_DURATION_SEC,
    Math.max(AUTO_CLIP.MIN_SEGMENT_SEC, usableEnd / count - gapSec)
  );
  const step = (usableEnd - windowLen) / Math.max(1, count - 1);

  for (let i = picked.length; i < count; i++) {
    const startSec = Math.min(i * step, usableEnd - windowLen);
    const endSec = startSec + windowLen;
    if (picked.some((p) => segmentsOverlap(p, startSec, endSec, gapSec))) continue;
    picked.push({
      index: i,
      startSec,
      endSec,
      reason: vision.hooks[i] ?? `Highlight ${i + 1}`,
    });
  }

  while (picked.length < count) {
    const i = picked.length;
    const startSec = Math.min((usableEnd / count) * i, usableEnd - AUTO_CLIP.MIN_SEGMENT_SEC);
    picked.push({
      index: i,
      startSec,
      endSec: Math.min(startSec + AUTO_CLIP.OUTPUT_DURATION_SEC, usableEnd),
      reason: vision.hooks[i] ?? `Highlight ${i + 1}`,
    });
  }

  return picked.slice(0, count).map((s, index) => ({ ...s, index }));
}

/** TTS when clip is long enough; otherwise BGM + bilingual subtitles only. */
export function attachAutoClipVoiceover(
  plan: EditPlan,
  variants: CopyVariant[],
  voiceLocale: CopyLocale,
  subtitleTimeline?: SubtitleTimelineSegment[]
): EditPlan {
  const { zhScript, enScript, hasBilingual } = resolveBilingualScripts(variants);
  const primary = pickBestLocaleVariant(variants, voiceLocale) ?? variants[0];
  if (!primary) return plan;

  const finalScript =
    plan.finalScript?.trim() ||
    (voiceLocale === "zh" ? zhScript : enScript).trim() ||
    buildFinalScript(primary, voiceLocale);
  if (!finalScript.trim()) return plan;

  const clipDurationSec = plan.targetDurationSec;
  const useVoice = shouldUseVoiceoverForClip(clipDurationSec, finalScript, voiceLocale);
  const speechDur = estimateSpeechDurationSec(finalScript, voiceLocale);
  const targetDurationSec = useVoice ? Math.max(clipDurationSec, speechDur + 0.5) : clipDurationSec;

  const sourceStart = plan.clips.length > 0 ? Math.min(...plan.clips.map((c) => c.startSec)) : 0;
  const sourceEnd = plan.clips.length > 0 ? Math.max(...plan.clips.map((c) => c.endSec)) : targetDurationSec;

  let subtitles = hasBilingual
    ? subtitlesFromBilingualScripts(zhScript, enScript, targetDurationSec)
    : subtitleTimeline && subtitleTimeline.length > 0
      ? subtitlesFromTimeline(subtitleTimeline, sourceStart, sourceEnd, targetDurationSec, voiceLocale)
      : subtitlesFromFinalScript(finalScript, targetDurationSec, voiceLocale);

  if (subtitles.length === 0 && hasBilingual) {
    subtitles = subtitlesFromBilingualScripts(zhScript, enScript, targetDurationSec);
  } else if (subtitles.length === 0) {
    subtitles = subtitlesFromFinalScript(finalScript, targetDurationSec, voiceLocale);
  }

  if (!useVoice) {
    console.log(
      `[auto-clip] clip ${targetDurationSec.toFixed(1)}s — skipping TTS, using BGM + subtitles`
    );
  }

  const assetId = plan.clips[0]?.assetId;
  const clips =
    useVoice && targetDurationSec > clipDurationSec + 0.05 && assetId
      ? buildVirtualCuts({
          assetId,
          sourceStartSec: sourceStart,
          sourceEndSec: sourceEnd,
          outputDurationSec: targetDurationSec,
          focus: {
            x: plan.clips[0]?.focusX ?? 0.5,
            y: plan.clips[0]?.focusY ?? 0.5,
          },
        })
      : plan.clips;

  return {
    ...plan,
    finalScript,
    finalScriptZh: hasBilingual ? zhScript : undefined,
    finalScriptEn: hasBilingual ? enScript : undefined,
    targetDurationSec,
    subtitles,
    effects: clipVisualEffects(targetDurationSec),
    clips,
    audio: {
      ...plan.audio,
      keepOriginal: false,
      bgm: plan.audio.bgm ?? "chill",
      voiceover: useVoice
        ? {
            enabled: true,
            locale: voiceLocale,
            segments: [{ startSec: 0, endSec: targetDurationSec, text: finalScript }],
          }
        : { enabled: false, locale: voiceLocale },
    },
  };
}

/** Single 9:16 clip — voice locale per variant; bilingual subtitles when copy allows. */
export function buildStandaloneClipEditPlan(input: {
  assetId: string;
  segment: AutoClipSegment;
  copyVariants: CopyVariant[];
  clipVariant?: AutoClipVariantDef;
  platform?: CopyVariant["platform"];
  bgmKey?: string;
  bgmRecommendation?: BgmRecommendation;
  vision?: VisionAnalysis | null;
  subtitleTimeline?: SubtitleTimelineSegment[];
}): EditPlan {
  const { segment, assetId, copyVariants, clipVariant, platform, bgmKey, bgmRecommendation, vision, subtitleTimeline } =
    input;
  const sourceLen = segment.endSec - segment.startSec;
  const clipDuration = Math.min(AUTO_CLIP.OUTPUT_DURATION_SEC, Math.max(AUTO_CLIP.MIN_SEGMENT_SEC, sourceLen));

  const voiceLocale = clipVariant?.voiceLocale ?? "en";
  const { zhScript, enScript, hasBilingual } = resolveBilingualScripts(copyVariants);
  const pair = pickBilingualCopyPair(copyVariants);
  const en = pair?.en ?? copyVariants[0]!;
  const zh = pair?.zh ?? pickBestLocaleVariant(copyVariants, "zh");

  const finalScript = voiceLocale === "zh" ? zhScript : enScript;
  const targetDurationSec = clipDuration;
  let subtitles = hasBilingual
    ? subtitlesFromBilingualScripts(zhScript, enScript, targetDurationSec)
    : subtitleTimeline && subtitleTimeline.length > 0
      ? subtitlesFromTimeline(
          subtitleTimeline,
          segment.startSec,
          segment.endSec,
          targetDurationSec,
          voiceLocale
        )
      : subtitlesFromFinalScript(finalScript, targetDurationSec, voiceLocale);

  const titleSource = zh?.title || en.title;

  const focus = inferSubjectFocus(vision);
  const clips = buildVirtualCuts({
    assetId,
    sourceStartSec: segment.startSec,
    sourceEndSec: segment.endSec,
    outputDurationSec: targetDurationSec,
    focus,
  });

  return {
    aspectRatio: "9:16",
    targetDurationSec,
    outputResolution: { preview: "720x1280", export: "1080x1920" },
    finalScript,
    finalScriptZh: hasBilingual ? zhScript : undefined,
    finalScriptEn: hasBilingual ? enScript : undefined,
    clipMeta: clipVariant
      ? {
          index: clipVariant.index,
          title: clipVariant.title,
          variant: clipVariant.variant,
          hookType: clipVariant.hookType,
          videoArchetype: clipVariant.videoArchetype,
          platform: platform ?? copyVariants[0]?.platform,
        }
      : undefined,
    clips,
    subtitles,
    cover: { atSec: 0.4, overlayText: titleSource },
    audio: {
      keepOriginal: false,
      bgm: bgmKey ?? "calm_ambient",
      normalize: true,
      bgmRecommendation: bgmRecommendation
        ? {
            trackId: bgmRecommendation.trackId,
            trackName: bgmRecommendation.trackName,
            category: bgmRecommendation.category,
            confidenceScore: bgmRecommendation.confidenceScore,
            reason: bgmRecommendation.reason,
            benefits: bgmRecommendation.benefits,
            alternatives: bgmRecommendation.alternatives,
            analysis: bgmRecommendation.analysis,
            license: bgmRecommendation.license,
          }
        : undefined,
    },
    effects: clipVisualEffects(targetDurationSec),
  };
}
