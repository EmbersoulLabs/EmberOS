/**
 * Sprint 3 PR 3.6 — deterministic Assembly Job fact builders for runtime.
 * No wall-clock values participate in integrity hashes / fact ids.
 */
import {
  ASSEMBLY_FACT_CONTRACT_VERSION,
  ASSEMBLY_RUNTIME_FAILURE_POLICIES,
  AssemblyFailedFactSchema,
  AssemblyProcessingStartedFactSchema,
  AssemblySucceededFactSchema,
  assemblyIntegrityHash,
  buildAssemblySucceededBindingId,
  buildFinalStoryResultIdentity,
  type AssemblyFailedFact,
  type AssemblyJob,
  type AssemblyProcessingStartedFact,
  type AssemblyRuntimeFailureClassification,
  type AssemblySucceededFact,
} from "@ceo-agent/shared/server";

function deterministicFactUuid(integrityHash: string): string {
  const hex = integrityHash.replace(/^sha256:/, "").slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

/** PROCESSING_STARTED — operational; startedAt frozen to job.acceptedAt for convergence. */
export function buildAssemblyProcessingStartedFact(
  job: AssemblyJob
): AssemblyProcessingStartedFact {
  const payload = {
    factKind: "PROCESSING_STARTED" as const,
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    ownership: job.ownership,
    startedAt: job.acceptedAt,
    contractVersion: ASSEMBLY_FACT_CONTRACT_VERSION,
  };
  const integrityHash = assemblyIntegrityHash({
    kind: "assembly-processing-started-fact",
    ...payload,
  });
  return AssemblyProcessingStartedFactSchema.parse({
    ...payload,
    factId: deterministicFactUuid(integrityHash),
    integrityHash,
  });
}

export function buildAssemblySucceededFact(input: {
  readonly job: AssemblyJob;
  readonly executionIdentity: string;
  readonly finalMediaContentHash: string;
  readonly assemblyEngineSnapshotHash: string;
  readonly completedAt: string;
}): AssemblySucceededFact {
  const binding = buildFinalStoryResultIdentity({
    assemblyJobId: input.job.assemblyJobId,
    finalMediaContentHash: input.finalMediaContentHash,
    finalResultContractVersion: "1",
    assemblyEngineSnapshotHash: input.assemblyEngineSnapshotHash,
  });
  // Prefer identity binding from final-media hash; also bind from execution identity
  // so equivalent runtime replay converges without persisting Final Story Result rows.
  void buildAssemblySucceededBindingId;
  const payload = {
    factKind: "SUCCEEDED" as const,
    assemblyJobId: input.job.assemblyJobId,
    executionPlanId: input.job.executionPlanId,
    ownership: input.job.ownership,
    storyResultId: binding.storyResultId,
    finalMediaContentHash: input.finalMediaContentHash,
    completedAt: input.completedAt,
    contractVersion: ASSEMBLY_FACT_CONTRACT_VERSION,
  };
  const integrityHash = assemblyIntegrityHash({
    kind: "assembly-succeeded-fact",
    executionIdentity: input.executionIdentity,
    ...payload,
  });
  return AssemblySucceededFactSchema.parse({
    ...payload,
    factId: deterministicFactUuid(integrityHash),
    integrityHash,
  });
}

export function buildAssemblyFailedFact(input: {
  readonly job: AssemblyJob;
  readonly classification: AssemblyRuntimeFailureClassification;
  readonly message?: string;
}): AssemblyFailedFact {
  const policy = ASSEMBLY_RUNTIME_FAILURE_POLICIES[input.classification];
  const payload = {
    factKind: "FAILED" as const,
    assemblyJobId: input.job.assemblyJobId,
    executionPlanId: input.job.executionPlanId,
    ownership: input.job.ownership,
    failureClassification: policy.terminalFactClassification,
    message: input.message ?? policy.safePublicMessage,
    failedAt: input.job.acceptedAt,
    contractVersion: ASSEMBLY_FACT_CONTRACT_VERSION,
  };
  const integrityHash = assemblyIntegrityHash({
    kind: "assembly-failed-fact",
    runtimeClassification: input.classification,
    ...payload,
  });
  return AssemblyFailedFactSchema.parse({
    ...payload,
    factId: deterministicFactUuid(integrityHash),
    integrityHash,
  });
}
