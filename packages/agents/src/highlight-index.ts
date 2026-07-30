import {
  AUTO_CLIP,
  SOURCE_END_TRIM_SEC,
  resolveMarketingOutputCount,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import type { AutoClipSegment } from "./auto-clip";

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface HighlightSegment {
  startSec: number;
  endSec: number;
  attentionScore: number;
  engagementScore: number;
  conversionScore: number;
  educationalScore: number;
  brandScore: number;
  deadAir: boolean;
  sceneType?: string;
  reason: string;
}

export interface HighlightIndexInput {
  vision: VisionAnalysis;
  sourceDurationSec: number;
  transcriptSegments?: TranscriptSegment[];
  transcriptSummary?: string;
  keywords?: string[];
}

function usableSourceEnd(sourceDurationSec: number): number {
  return Math.max(AUTO_CLIP.MIN_SEGMENT_SEC, sourceDurationSec - SOURCE_END_TRIM_SEC);
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function keywordHits(text: string, keywords: string[]): number {
  if (!keywords.length || !text.trim()) return 0;
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k.toLowerCase())).length;
}

function speechDensityInWindow(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number
): number {
  const span = endSec - startSec;
  if (span <= 0 || !segments.length) return 0;
  let spoken = 0;
  for (const seg of segments) {
    if (seg.endSec <= startSec || seg.startSec >= endSec) continue;
    const overlap = Math.min(seg.endSec, endSec) - Math.max(seg.startSec, startSec);
    spoken += overlap;
  }
  return spoken / span;
}

function scoreSegment(
  startSec: number,
  endSec: number,
  reason: string,
  input: HighlightIndexInput
): HighlightSegment {
  const { vision, transcriptSegments = [], keywords = [] } = input;
  const span = endSec - startSec;
  const density = speechDensityInWindow(transcriptSegments, startSec, endSec);
  const textBlob = [
    reason,
    ...transcriptSegments
      .filter((s) => s.endSec > startSec && s.startSec < endSec)
      .map((s) => s.text),
  ].join(" ");
  const hits = keywordHits(textBlob, keywords);
  const hookMatch = vision.hooks.some((h) => textBlob.toLowerCase().includes(h.toLowerCase().slice(0, 20)));

  const deadAir = density < 0.15 && span > 8;
  const attentionScore = clampScore(
    40 + (hookMatch ? 25 : 0) + density * 30 + Math.min(hits * 8, 24)
  );
  const engagementScore = clampScore(35 + density * 40 + (hookMatch ? 15 : 0));
  const conversionScore = clampScore(30 + hits * 12 + (reason.toLowerCase().includes("product") ? 20 : 0));
  const educationalScore = clampScore(
    25 +
      (reason.toLowerCase().includes("teach") || reason.toLowerCase().includes("how") ? 30 : 0) +
      density * 25
  );
  const brandScore = clampScore(40 + (vision.scenes.some((s) => s.startSec <= startSec && s.endSec >= endSec) ? 20 : 0));

  return {
    startSec,
    endSec,
    attentionScore: deadAir ? Math.min(attentionScore, 25) : attentionScore,
    engagementScore: deadAir ? Math.min(engagementScore, 20) : engagementScore,
    conversionScore,
    educationalScore,
    brandScore,
    deadAir,
    reason,
  };
}

function compositeScore(seg: HighlightSegment, variantIndex: number): number {
  const weights = [
    { a: 0.3, e: 0.2, c: 0.25, ed: 0.1, b: 0.15 },
    { a: 0.45, e: 0.3, c: 0.1, ed: 0.05, b: 0.1 },
    { a: 0.15, e: 0.15, c: 0.45, ed: 0.15, b: 0.1 },
  ][variantIndex] ?? { a: 0.25, e: 0.25, c: 0.2, ed: 0.15, b: 0.15 };

  return (
    seg.attentionScore * weights.a +
    seg.engagementScore * weights.e +
    seg.conversionScore * weights.c +
    seg.educationalScore * weights.ed +
    seg.brandScore * weights.b
  );
}

function normalizeWindow(
  startSec: number,
  endSec: number,
  reason: string,
  usableEnd: number
): { startSec: number; endSec: number; reason: string } | null {
  let start = Math.max(0, startSec);
  let end = Math.min(endSec, usableEnd);
  if (end - start < AUTO_CLIP.MIN_SEGMENT_SEC) {
    end = Math.min(start + AUTO_CLIP.OUTPUT_DURATION_SEC, usableEnd);
  }
  if (end - start > AUTO_CLIP.MAX_SEGMENT_SEC) {
    end = start + AUTO_CLIP.MAX_SEGMENT_SEC;
  }
  if (end - start < AUTO_CLIP.MIN_SEGMENT_SEC) return null;
  return { startSec: start, endSec: end, reason };
}

function buildCandidates(input: HighlightIndexInput): Array<{ startSec: number; endSec: number; reason: string }> {
  const usableEnd = usableSourceEnd(input.sourceDurationSec);
  const { vision, transcriptSegments = [] } = input;
  const candidates: Array<{ startSec: number; endSec: number; reason: string; span: number }> = [];

  for (const m of [...(vision.suggestedMoments ?? []), ...(vision.scenes ?? [])]) {
    const reason = "reason" in m ? m.reason : m.description;
    const norm = normalizeWindow(m.startSec, m.endSec, reason, usableEnd);
    if (!norm) continue;
    candidates.push({ ...norm, span: norm.endSec - norm.startSec });
  }

  for (let i = 0; i < transcriptSegments.length; i++) {
    const seg = transcriptSegments[i]!;
    const next = transcriptSegments[i + 1];
    const endSec = next ? (seg.endSec + next.startSec) / 2 : Math.min(seg.endSec + 4, usableEnd);
    const norm = normalizeWindow(seg.startSec, endSec, seg.text.slice(0, 80), usableEnd);
    if (norm) candidates.push({ ...norm, span: norm.endSec - norm.startSec });
  }

  return candidates.sort((a, b) => b.span - a.span);
}

/** Score all candidate windows from transcript + vision moments. */
export function buildHighlightIndex(input: HighlightIndexInput): HighlightSegment[] {
  const raw = buildCandidates(input);
  const seen = new Set<string>();
  const index: HighlightSegment[] = [];

  for (const c of raw) {
    const key = `${Math.round(c.startSec)}-${Math.round(c.endSec)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    index.push(scoreSegment(c.startSec, c.endSec, c.reason, input));
  }

  return index.sort(
    (a, b) =>
      b.attentionScore +
      b.engagementScore -
      (a.attentionScore + a.engagementScore)
  );
}

function segmentsOverlap(
  a: { startSec: number; endSec: number },
  startSec: number,
  endSec: number,
  gapSec: number
): boolean {
  return startSec < a.endSec + gapSec && endSec + gapSec > a.startSec;
}

/** Pick top marketing clips using scored highlights (PD-054/055 quality-first). */
export function pickSegmentsFromHighlightIndex(
  index: HighlightSegment[],
  sourceDurationSec: number,
  count = AUTO_CLIP.DEFAULT_OUTPUT_COUNT
): AutoClipSegment[] {
  const usableEnd = usableSourceEnd(sourceDurationSec);
  const gapSec = Math.max(3, usableEnd * 0.04);
  const viable = index.filter(
    (s) => !s.deadAir && s.endSec - s.startSec >= AUTO_CLIP.MIN_SEGMENT_SEC * 0.5
  );

  const nonOverlapping: Array<HighlightSegment & { qualityScore: number }> = [];
  const ranked = [...viable].sort(
    (a, b) => compositeScore(b, 0) - compositeScore(a, 0)
  );
  for (const seg of ranked) {
    if (
      nonOverlapping.some((p) =>
        segmentsOverlap(p, seg.startSec, seg.endSec, gapSec)
      )
    ) {
      continue;
    }
    const raw = compositeScore(seg, nonOverlapping.length);
    // Normalize composite score into 0–1 for product strategy.
    const qualityScore = Math.max(0, Math.min(1, raw / 10));
    nonOverlapping.push({ ...seg, qualityScore });
    if (nonOverlapping.length >= AUTO_CLIP.MAX_OUTPUT_COUNT) break;
  }

  const resolved = resolveMarketingOutputCount({
    candidates: nonOverlapping.map((seg, i) => ({
      id: `highlight-${i}-${seg.startSec}`,
      qualityScore: seg.qualityScore,
      reason: seg.reason,
      mediaKind: "video" as const,
    })),
    target: Math.min(count, AUTO_CLIP.DEFAULT_OUTPUT_COUNT),
    minimum: AUTO_CLIP.MIN_OUTPUT_COUNT,
    maximum: AUTO_CLIP.MAX_OUTPUT_COUNT,
  });

  const selected = resolved.selected
    .map((c) => {
      const match = nonOverlapping.find(
        (seg, i) => `highlight-${i}-${seg.startSec}` === c.id
      );
      return match;
    })
    .filter((seg): seg is HighlightSegment & { qualityScore: number } => Boolean(seg));

  // PD-055: never pad with evenly spaced filler windows.
  return selected.map((seg, i) => ({
    index: i,
    startSec: seg.startSec,
    endSec: seg.endSec,
    reason: seg.reason,
  }));
}
