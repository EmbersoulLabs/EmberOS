/**
 * Sprint 3 PR 3.7 Phase E — product runtime status derivation unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  deriveProductCanExecute,
  deriveProductRuntimeStatus,
  isProductRuntimePollingStatus,
} from "@ceo-agent/shared";

describe("deriveProductRuntimeStatus precedence", () => {
  const base = {
    hasFinalStoryResult: false,
    assemblyState: "NONE" as const,
    requiredSceneCount: 2,
    succeededSceneCount: 0,
    failedSceneCount: 0,
    reconciliationCount: 0,
    hasActiveSceneRuntime: false,
    hasRuntimeAuthorizedFact: false,
    canonicalReadinessSatisfied: false,
  };

  it("SUCCEEDED when Final Story Result exists", () => {
    expect(
      deriveProductRuntimeStatus({ ...base, hasFinalStoryResult: true, assemblyState: "FAILED" })
    ).toBe("SUCCEEDED");
  });

  it("ASSEMBLY_FAILED before scene aggregates", () => {
    expect(
      deriveProductRuntimeStatus({
        ...base,
        assemblyState: "FAILED",
        failedSceneCount: 1,
      })
    ).toBe("ASSEMBLY_FAILED");
  });

  it("ASSEMBLING / WAITING_FOR_ASSEMBLY from assembly facts", () => {
    expect(deriveProductRuntimeStatus({ ...base, assemblyState: "PROCESSING" })).toBe(
      "ASSEMBLING"
    );
    expect(deriveProductRuntimeStatus({ ...base, assemblyState: "ACCEPTED" })).toBe(
      "WAITING_FOR_ASSEMBLY"
    );
  });

  it("SCENES_COMPLETE when all required scenes succeeded", () => {
    expect(
      deriveProductRuntimeStatus({
        ...base,
        succeededSceneCount: 2,
      })
    ).toBe("SCENES_COMPLETE");
  });

  it("RECONCILIATION_REQUIRED before SCENES_FAILED", () => {
    expect(
      deriveProductRuntimeStatus({
        ...base,
        reconciliationCount: 1,
        failedSceneCount: 1,
      })
    ).toBe("RECONCILIATION_REQUIRED");
  });

  it("SCENES_FAILED / SCENES_RUNNING / AUTHORIZED / READY / NOT_READY", () => {
    expect(deriveProductRuntimeStatus({ ...base, failedSceneCount: 1 })).toBe("SCENES_FAILED");
    expect(
      deriveProductRuntimeStatus({
        ...base,
        hasRuntimeAuthorizedFact: true,
        hasActiveSceneRuntime: true,
      })
    ).toBe("SCENES_RUNNING");
    expect(
      deriveProductRuntimeStatus({
        ...base,
        hasRuntimeAuthorizedFact: true,
      })
    ).toBe("AUTHORIZED");
    expect(
      deriveProductRuntimeStatus({
        ...base,
        canonicalReadinessSatisfied: true,
      })
    ).toBe("READY_FOR_EXECUTION");
    expect(deriveProductRuntimeStatus(base)).toBe("NOT_READY");
  });

  it("canExecute is operator convenience only", () => {
    expect(
      deriveProductCanExecute({
        status: "READY_FOR_EXECUTION",
        hasRuntimeAuthorizedFact: false,
        callerMayExecute: true,
      })
    ).toBe(true);
    expect(
      deriveProductCanExecute({
        status: "READY_FOR_EXECUTION",
        hasRuntimeAuthorizedFact: false,
        callerMayExecute: false,
      })
    ).toBe(false);
    expect(
      deriveProductCanExecute({
        status: "READY_FOR_EXECUTION",
        hasRuntimeAuthorizedFact: true,
        callerMayExecute: true,
      })
    ).toBe(false);
  });

  it("polling status set matches Phase E lifecycle", () => {
    expect(isProductRuntimePollingStatus("SCENES_RUNNING")).toBe(true);
    expect(isProductRuntimePollingStatus("SUCCEEDED")).toBe(false);
    expect(isProductRuntimePollingStatus("READY_FOR_EXECUTION")).toBe(false);
  });
});
