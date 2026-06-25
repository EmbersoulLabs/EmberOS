import type { CopyLocale } from "./copy-mix";
import type { EditPlan } from "./types/index";
import type { SubtitleTimelineSegment } from "./types/marketing-os";

function roleToStyle(
  role: string | undefined,
  locale: CopyLocale
): EditPlan["subtitles"][number]["style"] {
  const r = (role ?? "body").toLowerCase();
  if (r === "hook") return locale === "zh" ? "hook_zh" : "hook_en";
  if (r === "cta") return locale === "zh" ? "cta_zh" : "cta_en";
  return locale === "zh" ? "body_zh" : "body_en";
}

/** Map marketing-package subtitle timeline (source seconds) into clip output subtitles. */
export function subtitlesFromTimeline(
  timeline: SubtitleTimelineSegment[],
  clipStartSec: number,
  clipEndSec: number,
  targetDurationSec: number,
  locale: CopyLocale = "en"
): EditPlan["subtitles"] {
  if (!timeline.length || clipEndSec <= clipStartSec || targetDurationSec <= 0) return [];

  const clipLen = clipEndSec - clipStartSec;
  const subtitles: EditPlan["subtitles"] = [];

  for (const seg of timeline) {
    if (seg.endSec <= clipStartSec || seg.startSec >= clipEndSec) continue;
    const overlapStart = Math.max(seg.startSec, clipStartSec);
    const overlapEnd = Math.min(seg.endSec, clipEndSec);
    if (overlapEnd - overlapStart < 0.2) continue;

    const relStart = (overlapStart - clipStartSec) / clipLen;
    const relEnd = (overlapEnd - clipStartSec) / clipLen;
    const text = seg.text.trim();
    if (!text) continue;

    subtitles.push({
      startSec: relStart * targetDurationSec,
      endSec: Math.min(targetDurationSec, relEnd * targetDurationSec),
      text,
      style: roleToStyle(seg.role, locale),
    });
  }

  if (subtitles.length === 0) return [];

  subtitles[0]!.startSec = 0;
  subtitles[subtitles.length - 1]!.endSec = targetDurationSec;
  return subtitles;
}

/** Scale a full-video timeline to a clip's output duration (when timeline is 0-based for the clip). */
export function subtitlesFromClipTimeline(
  timeline: SubtitleTimelineSegment[],
  targetDurationSec: number,
  locale: CopyLocale = "en"
): EditPlan["subtitles"] {
  if (!timeline.length || targetDurationSec <= 0) return [];

  const maxEnd = Math.max(...timeline.map((s) => s.endSec), 0.1);
  const scale = targetDurationSec / maxEnd;

  return timeline
    .filter((s) => s.text.trim())
    .map((seg) => ({
      startSec: seg.startSec * scale,
      endSec: Math.min(targetDurationSec, seg.endSec * scale),
      text: seg.text.trim(),
      style: roleToStyle(seg.role, locale),
    }));
}
