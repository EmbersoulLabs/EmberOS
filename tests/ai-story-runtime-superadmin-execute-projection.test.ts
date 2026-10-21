import { describe, expect, it } from "vitest";
import { resolveExecutionPlanRuntimeCallerRole } from "../apps/web/src/lib/ai-story-execution-plan-access";

describe("AI Story runtime Platform Admin Execute projection", () => {
  it("projects active Platform Admin authority as admin without a workspace membership", () => {
    expect(resolveExecutionPlanRuntimeCallerRole(null, {
      allowedBy: "ACTIVE_PLATFORM_ADMIN",
    })).toBe("admin");
  });

  it("preserves an authoritative workspace membership role", () => {
    expect(resolveExecutionPlanRuntimeCallerRole("operator", {
      allowedBy: "AGENCY_PLAN_CAPABILITY",
    })).toBe("operator");
  });

  it("does not invent customer workspace authority", () => {
    expect(resolveExecutionPlanRuntimeCallerRole(null, {
      allowedBy: "AGENCY_PLAN_CAPABILITY",
    })).toBeNull();
  });
});
