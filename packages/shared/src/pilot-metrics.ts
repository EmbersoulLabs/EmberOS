/** Phase 1 agency pilot success thresholds (PLAN_PROMPT.md). */
export const PILOT_TARGETS = {
  internalFirstPassApprovalMinPct: 70,
  resubmitRateMaxPct: 30,
} as const;

export type PilotMetricVerdict = "pass" | "fail" | "insufficient_data";

export interface PilotMetricCheck {
  id: string;
  label: string;
  valuePct: number | null;
  targetLabel: string;
  verdict: PilotMetricVerdict;
  detail: string;
}

export interface PilotMetricsInput {
  internalFirstPassApproved: number;
  internalFirstPassDecided: number;
  resubmittedCreatives: number;
  creativesWithReviews: number;
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function evaluatePilotMetrics(input: PilotMetricsInput): PilotMetricCheck[] {
  const internalRate = pct(input.internalFirstPassApproved, input.internalFirstPassDecided);
  const resubmitRate = pct(input.resubmittedCreatives, input.creativesWithReviews);

  const internalVerdict: PilotMetricVerdict =
    input.internalFirstPassDecided === 0
      ? "insufficient_data"
      : internalRate !== null && internalRate >= PILOT_TARGETS.internalFirstPassApprovalMinPct
        ? "pass"
        : "fail";

  const resubmitVerdict: PilotMetricVerdict =
    input.creativesWithReviews === 0
      ? "insufficient_data"
      : resubmitRate !== null && resubmitRate <= PILOT_TARGETS.resubmitRateMaxPct
        ? "pass"
        : "fail";

  return [
    {
      id: "internal_first_pass",
      label: "Internal first-pass approval",
      valuePct: internalRate,
      targetLabel: `≥ ${PILOT_TARGETS.internalFirstPassApprovalMinPct}%`,
      verdict: internalVerdict,
      detail: `${input.internalFirstPassApproved}/${input.internalFirstPassDecided} clips approved on first internal review`,
    },
    {
      id: "resubmit_rate",
      label: "Resubmit rate (copy/rework proxy)",
      valuePct: resubmitRate,
      targetLabel: `≤ ${PILOT_TARGETS.resubmitRateMaxPct}%`,
      verdict: resubmitVerdict,
      detail: `${input.resubmittedCreatives}/${input.creativesWithReviews} clips resubmitted after an internal rejection`,
    },
  ];
}

export function pilotPhase1Ready(checks: PilotMetricCheck[]): boolean {
  const actionable = checks.filter((c) => c.verdict !== "insufficient_data");
  if (actionable.length === 0) return false;
  return actionable.every((c) => c.verdict === "pass");
}
