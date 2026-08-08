/**
 * Sprint 3 PR 3.6 — non-authoritative Assembly Runtime read projection.
 */
import {
  ASSEMBLY_ENGINE_VERSION,
  AssemblyRuntimeProjectionSchema,
  PHASE1_EXECUTION_LOCKED,
  type AssemblyArtifact,
  type AssemblyJob,
  type AssemblyJobFact,
  type AssemblyRuntimeFailureClassification,
  type AssemblyRuntimeProjection,
} from "@ceo-agent/shared/server";
import { ASSEMBLY_RUNTIME_FAILURE_POLICIES } from "@ceo-agent/shared/server";

export function projectAssemblyRuntime(input: {
  readonly job: AssemblyJob;
  readonly facts: readonly AssemblyJobFact[];
  readonly artifact: AssemblyArtifact | null;
  readonly inputValidationStatus?: "UNKNOWN" | "PASSED" | "FAILED";
  readonly derivedAt?: string;
}): AssemblyRuntimeProjection {
  const accepted = input.facts.find((fact) => fact.factKind === "ACCEPTED");
  const processing = input.facts.find((fact) => fact.factKind === "PROCESSING_STARTED");
  const succeeded = input.facts.find((fact) => fact.factKind === "SUCCEEDED");
  const failed = input.facts.find((fact) => fact.factKind === "FAILED");

  let state: AssemblyRuntimeProjection["state"] = "NOT_STARTED";
  let terminalStatus: AssemblyRuntimeProjection["terminalStatus"] = "NONE";
  let safeFailureClassification: AssemblyRuntimeFailureClassification | null = null;
  let completedAt: string | null = null;

  if (succeeded && succeeded.factKind === "SUCCEEDED") {
    state = "SUCCEEDED";
    terminalStatus = "SUCCEEDED";
    completedAt = succeeded.completedAt;
  } else if (failed && failed.factKind === "FAILED") {
    state = "FAILED";
    terminalStatus = "FAILED";
    completedAt = failed.failedAt;
    const match = (
      Object.keys(ASSEMBLY_RUNTIME_FAILURE_POLICIES) as AssemblyRuntimeFailureClassification[]
    ).find(
      (key) =>
        ASSEMBLY_RUNTIME_FAILURE_POLICIES[key].terminalFactClassification ===
        failed.failureClassification
    );
    safeFailureClassification = match ?? "ASSEMBLY_INFRASTRUCTURE_TERMINAL";
  } else if (processing) {
    state = "PROCESSING";
  }

  return AssemblyRuntimeProjectionSchema.parse({
    assemblyJobId: input.job.assemblyJobId,
    executionPlanId: input.job.executionPlanId,
    state,
    processingStarted: Boolean(processing),
    terminalStatus,
    sceneCount: input.job.orderedSceneResultIds.length,
    inputValidationStatus: input.inputValidationStatus ?? "UNKNOWN",
    artifactAvailable: Boolean(input.artifact),
    safeFailureClassification,
    assemblyEngineVersion: input.artifact ? ASSEMBLY_ENGINE_VERSION : null,
    acceptedAt: accepted && accepted.factKind === "ACCEPTED" ? accepted.acceptedAt : null,
    processingStartedAt:
      processing && processing.factKind === "PROCESSING_STARTED"
        ? processing.startedAt
        : null,
    completedAt,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    derivedAt: input.derivedAt ?? input.job.acceptedAt,
  });
}
