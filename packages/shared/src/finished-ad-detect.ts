export type FinishedAdRisk = "low" | "medium" | "high";

export interface FinishedAdAssessment {
  risk: FinishedAdRisk;
  score: number;
  reasons: string[];
}

const FINISHED_AD_FILENAME_RE =
  /tiktok|douyin|抖音|小红书|xhs|instagram|reels|final|export|render|ad[_-]?|爆款|成片|成品|subtitle|字幕|剪映|capcut/i;

export function assessFinishedAdRisk(input: {
  type: "video" | "image";
  filename?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  hasAudio?: boolean;
}): FinishedAdAssessment {
  const reasons: string[] = [];
  let score = 0;

  const name = input.filename ?? "";
  if (name && FINISHED_AD_FILENAME_RE.test(name)) {
    score += 30;
    reasons.push("filename_suggests_exported_ad");
  }

  if (input.type === "video") {
    const w = input.width ?? 0;
    const h = input.height ?? 0;
    const dur = input.durationSec ?? 0;
    const vertical = w > 0 && h / w >= 1.45;
    const near916 = w > 0 && Math.abs(w / h - 9 / 16) < 0.04;

    if (vertical) {
      score += 20;
      reasons.push("vertical_social_aspect");
    }
    if (near916) {
      score += 12;
      reasons.push("exact_9_16_canvas");
    }
    if (dur >= 8 && dur <= 60) {
      score += 15;
      reasons.push("typical_short_ad_duration");
    }
    if (dur > 0 && dur <= 30) {
      score += 10;
      reasons.push("under_30s_clip");
    }
    if (input.hasAudio) {
      score += 8;
      reasons.push("has_existing_voiceover_or_music");
    }
  }

  let risk: FinishedAdRisk = "low";
  if (score >= 65) risk = "high";
  else if (score >= 38) risk = "medium";

  return { risk, score, reasons };
}
