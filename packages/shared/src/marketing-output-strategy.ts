/**
 * PD-054 / PD-055 — Unified Marketing Output Strategy (product configuration).
 * Consumed by Auto Clip and AI Story video execution count selection.
 * AI Story Execution does not generate images.
 */
import { z } from "zod";

/** Product configuration — not architecture constants to hardcode elsewhere. */
export const MARKETING_OUTPUT_STRATEGY = {
  /** PD-054 / PD-055 default target. */
  DEFAULT_TARGET_OUTPUTS: 5,
  /** Quality floor: never return fewer than this when candidates exist. */
  MINIMUM_OUTPUTS: 3,
  /** Soft ceiling for V1 (Agency 5–10 is future). */
  MAXIMUM_OUTPUTS: 5,
  /** Reject candidates at or below this quality score (0–1). */
  MIN_QUALITY_SCORE: 0.55,
} as const;

export const MarketingOutputCandidateSchema = z.object({
  id: z.string().min(1),
  qualityScore: z.number().min(0).max(1),
  reason: z.string().default(""),
});

export type MarketingOutputCandidate = z.infer<typeof MarketingOutputCandidateSchema>;

export type ResolveMarketingOutputCountInput = {
  candidates: readonly MarketingOutputCandidate[];
  target?: number;
  minimum?: number;
  maximum?: number;
  minQualityScore?: number;
};

export type ResolveMarketingOutputCountResult = {
  selected: MarketingOutputCandidate[];
  selectedCount: number;
  target: number;
  rejectedLowQuality: number;
  strategy: "quality_first";
};

/**
 * Quality-first selection (PD-055). Used for video marketing outputs / Auto Clip.
 */
export function resolveMarketingOutputCount(
  input: ResolveMarketingOutputCountInput
): ResolveMarketingOutputCountResult {
  const target = clampInt(
    input.target ?? MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS,
    MARKETING_OUTPUT_STRATEGY.MINIMUM_OUTPUTS,
    MARKETING_OUTPUT_STRATEGY.MAXIMUM_OUTPUTS
  );
  const minimum = clampInt(
    input.minimum ?? MARKETING_OUTPUT_STRATEGY.MINIMUM_OUTPUTS,
    1,
    target
  );
  const maximum = clampInt(
    input.maximum ?? MARKETING_OUTPUT_STRATEGY.MAXIMUM_OUTPUTS,
    target,
    MARKETING_OUTPUT_STRATEGY.MAXIMUM_OUTPUTS
  );
  const minQuality =
    input.minQualityScore ?? MARKETING_OUTPUT_STRATEGY.MIN_QUALITY_SCORE;

  const ranked = [...input.candidates]
    .filter((c) => Number.isFinite(c.qualityScore))
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const qualityPass = ranked.filter((c) => c.qualityScore >= minQuality);
  const rejectedLowQuality = ranked.length - qualityPass.length;

  let selected = qualityPass.slice(0, maximum);
  if (selected.length > target) {
    selected = selected.slice(0, target);
  }

  if (selected.length < minimum && ranked.length > 0) {
    const softFloor = minQuality * 0.5;
    const softPass = ranked.filter((c) => c.qualityScore >= softFloor);
    selected = softPass.slice(0, Math.min(minimum, maximum));
  }

  return {
    selected,
    selectedCount: selected.length,
    target,
    rejectedLowQuality,
    strategy: "quality_first",
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
