import { describe, expect, it } from "vitest";
import {
  actualCertificationPlanningCostCents,
  CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING,
  CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS,
  maximumCertificationPlanningCostCents,
} from "../packages/db/src/queries/certification-planning-authority";

describe("AI Story certification planning pre-call cost ceiling", () => {
  it("uses the full pinned-model context window as a conservative input bound", () => {
    expect(CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING).toBe(128_000);
    for (const maxOutputTokens of Object.values(CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS)) {
      const reserved = maximumCertificationPlanningCostCents(maxOutputTokens);
      expect(actualCertificationPlanningCostCents(0, 0)).toBeLessThanOrEqual(reserved);
      expect(actualCertificationPlanningCostCents(64_000, Math.floor(maxOutputTokens / 2))).toBeLessThanOrEqual(reserved);
      expect(actualCertificationPlanningCostCents(128_000, maxOutputTokens)).toBe(reserved);
    }
  });

  it("rejects missing/unbounded output and usage outside the certified model bounds", () => {
    expect(() => maximumCertificationPlanningCostCents(0)).toThrow("Finite output-token limit");
    expect(() => maximumCertificationPlanningCostCents(16_385)).toThrow("Finite output-token limit");
    expect(() => actualCertificationPlanningCostCents(128_001, 0)).toThrow("Provider usage exceeds");
    expect(() => actualCertificationPlanningCostCents(0, 16_385)).toThrow("Provider usage exceeds");
  });
});
