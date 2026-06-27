import { describe, it, expect } from "vitest";
import { evaluatePilotMetrics, pilotPhase1Ready, pct } from "@ceo-agent/shared";

describe("pilot-metrics", () => {
  it("computes percentage with one decimal", () => {
    expect(pct(3, 4)).toBe(75);
    expect(pct(0, 0)).toBeNull();
  });

  it("passes when internal approval ≥70% and resubmit ≤30%", () => {
    const checks = evaluatePilotMetrics({
      internalFirstPassApproved: 8,
      internalFirstPassDecided: 10,
      resubmittedCreatives: 2,
      creativesWithReviews: 10,
    });
    expect(checks[0]?.verdict).toBe("pass");
    expect(checks[1]?.verdict).toBe("pass");
    expect(pilotPhase1Ready(checks)).toBe(true);
  });

  it("fails when resubmit rate exceeds 30%", () => {
    const checks = evaluatePilotMetrics({
      internalFirstPassApproved: 9,
      internalFirstPassDecided: 10,
      resubmittedCreatives: 4,
      creativesWithReviews: 10,
    });
    expect(checks[0]?.verdict).toBe("pass");
    expect(checks[1]?.verdict).toBe("fail");
    expect(pilotPhase1Ready(checks)).toBe(false);
  });

  it("reports insufficient data with zero reviews", () => {
    const checks = evaluatePilotMetrics({
      internalFirstPassApproved: 0,
      internalFirstPassDecided: 0,
      resubmittedCreatives: 0,
      creativesWithReviews: 0,
    });
    expect(checks.every((c) => c.verdict === "insufficient_data")).toBe(true);
    expect(pilotPhase1Ready(checks)).toBe(false);
  });
});
