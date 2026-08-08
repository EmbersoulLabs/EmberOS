/**
 * Sprint 3 PR 3.5 — Scene Result Projector (Transaction B).
 *
 * Projects Canonical Scene Result from accepted Provider Finalization only.
 * Never writes Provider terminal state, usage, cost, or outbox.
 */
import {
  ProjectedSceneResultSchema,
  SCENE_PROJECTION_CONTRACT_VERSION,
  SCENE_PROJECTION_VERSION,
  SceneProjectionCorrelationSchema,
  buildProviderCostReference,
  buildProviderFinalizationReference,
  buildProviderUsageReference,
  mapWorkerFailureToProjectionFailure,
  mapWorkerResultToSceneStatus,
  type AcceptedProviderFinalization,
  type ProjectedSceneResult,
  type SceneProjectionCorrelation,
  type SceneProjectionValidatedBundle,
  type WorkerExecutionResult,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

export class SceneResultProjectorError extends Error {
  constructor(
    readonly code:
      | "SCENE_PROJECTION_FINALIZATION_REQUIRED"
      | "SCENE_PROJECTION_CONFLICT"
      | "SCENE_PROJECTION_HASH_MISMATCH"
      | "SCENE_PROJECTION_TRANSACTION_FAILED",
    message: string
  ) {
    super(message);
    this.name = "SceneResultProjectorError";
  }
}

export type SceneProjectionRepository = {
  acceptOrConvergeProjection(input: {
    readonly correlation: SceneProjectionCorrelation;
    readonly sceneResult: ProjectedSceneResult;
  }): Promise<{
    readonly correlation: SceneProjectionCorrelation;
    readonly sceneResult: ProjectedSceneResult;
    readonly converged: boolean;
  }>;
};

export function computeSceneRuntimeId(input: {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
}): string {
  return deterministicPersistenceUuid("ai-story-scene-runtime", input);
}

export function computeSceneResultId(input: {
  readonly sceneExecutionId: string;
  readonly providerFinalizationReference: string;
}): string {
  return deterministicPersistenceUuid("ai-story-scene-result", input);
}

function sceneResultHashPayload(
  result: Omit<ProjectedSceneResult, "integrityHash">
) {
  return {
    sceneResultId: result.sceneResultId,
    executionPlanId: result.executionPlanId,
    sceneRuntimeId: result.sceneRuntimeId,
    sceneExecutionId: result.sceneExecutionId,
    sceneId: result.sceneId,
    sceneOrder: result.sceneOrder,
    ownership: result.ownership,
    status: result.status,
    failureClassification: result.failureClassification,
    mediaReference: result.mediaReference,
    durationMs: result.durationMs,
    acceptedAt: result.acceptedAt,
    projectedAt: result.projectedAt,
    providerExecutionId: result.providerExecutionId,
    providerAttemptId: result.providerAttemptId,
    providerFinalizationReference: result.providerFinalizationReference,
    providerUsageReference: result.providerUsageReference,
    providerCostReference: result.providerCostReference,
    projectionVersion: result.projectionVersion,
    contractVersion: result.contractVersion,
  };
}

function correlationHashPayload(
  record: Omit<SceneProjectionCorrelation, "integrityHash">
) {
  return {
    projectionCorrelationId: record.projectionCorrelationId,
    sceneExecutionId: record.sceneExecutionId,
    workerExecutionResultId: record.workerExecutionResultId,
    providerExecutionId: record.providerExecutionId,
    providerAttemptId: record.providerAttemptId,
    outboxJobId: record.outboxJobId,
    dispatchId: record.dispatchId,
    providerFinalizationReference: record.providerFinalizationReference,
    sceneResultId: record.sceneResultId,
    ownershipOrgId: record.ownershipOrgId,
    ownershipWorkspaceId: record.ownershipWorkspaceId,
    projectedAt: record.projectedAt,
    contractVersion: record.contractVersion,
    executionAllowed: record.executionAllowed,
    executionLockCode: record.executionLockCode,
    automaticFallbackEnabled: record.automaticFallbackEnabled,
  };
}

export function projectSceneResultFromAcceptedFinalization(input: {
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
  readonly finalization: AcceptedProviderFinalization;
}): {
  readonly correlation: SceneProjectionCorrelation;
  readonly sceneResult: ProjectedSceneResult;
} {
  const { workerResult, bundle, finalization } = input;
  if (!finalization.resultReference || !finalization.completedAt) {
    throw new SceneResultProjectorError(
      "SCENE_PROJECTION_FINALIZATION_REQUIRED",
      "Projection requires accepted Provider Finalization"
    );
  }

  const providerFinalizationReference = buildProviderFinalizationReference({
    executionId: finalization.executionId,
    attemptId: finalization.attemptId,
    jobId: finalization.jobId,
    completedAt: finalization.completedAt,
    resultReference: finalization.resultReference,
  });

  const ownership = bundle.runtimeAuthorization.ownership;
  const projectedAt = workerResult.producedAt;
  const acceptedAt = finalization.completedAt;
  const status = mapWorkerResultToSceneStatus({
    canonicalProviderState: workerResult.canonicalProviderState,
    failureCode: workerResult.failureClassification?.code,
  });
  if (
    finalization.terminalKind === "TERMINAL_FAILURE" &&
    status === "SUCCEEDED"
  ) {
    throw new SceneResultProjectorError(
      "SCENE_PROJECTION_FINALIZATION_REQUIRED",
      "Terminal-failure finalization cannot project SUCCEEDED Scene Result"
    );
  }
  if (
    finalization.terminalKind === "SUCCEEDED" &&
    status !== "SUCCEEDED"
  ) {
    throw new SceneResultProjectorError(
      "SCENE_PROJECTION_FINALIZATION_REQUIRED",
      "Successful finalization cannot project non-SUCCEEDED Scene Result"
    );
  }
  const failureClassification =
    status === "SUCCEEDED"
      ? null
      : mapWorkerFailureToProjectionFailure(
          workerResult.failureClassification?.code ?? finalization.failureCode
        ) ?? "PROVIDER_FAILED";

  const mediaReference =
    status === "SUCCEEDED" && workerResult.terminalMedia?.uriReference
      ? {
          uri: workerResult.terminalMedia.uriReference,
          contentHash:
            workerResult.terminalMedia.contentHash ??
            canonicalPersistenceHash({
              uri: workerResult.terminalMedia.uriReference,
            }),
          mediaType: workerResult.terminalMedia.mediaType,
        }
      : status === "SUCCEEDED" && workerResult.normalizedResultReference
        ? {
            uri: workerResult.normalizedResultReference,
            contentHash: canonicalPersistenceHash({
              uri: workerResult.normalizedResultReference,
            }),
            mediaType: "application/octet-stream",
          }
        : null;

  if (status !== "SUCCEEDED" && mediaReference) {
    throw new SceneResultProjectorError(
      "SCENE_PROJECTION_HASH_MISMATCH",
      "Non-success Scene Result must not include successful media reference"
    );
  }

  const durationMs =
    workerResult.terminalMedia?.durationMs ??
    workerResult.normalizedUsageFacts?.durationMs ??
    null;

  const sceneRuntimeId = computeSceneRuntimeId({
    executionPlanId: ownership.executionPlanId,
    sceneExecutionId: bundle.routingDecision.sceneExecutionId,
    runtimeAuthorizationId: bundle.runtimeAuthorization.runtimeAuthorizationId,
  });
  const sceneResultId = computeSceneResultId({
    sceneExecutionId: bundle.routingDecision.sceneExecutionId,
    providerFinalizationReference,
  });

  const sceneWithoutHash = {
    sceneResultId,
    executionPlanId: ownership.executionPlanId,
    sceneRuntimeId,
    sceneExecutionId: bundle.routingDecision.sceneExecutionId,
    sceneId: bundle.sceneId,
    sceneOrder: bundle.sceneOrder,
    ownership,
    status,
    failureClassification,
    mediaReference: status === "SUCCEEDED" ? mediaReference : null,
    durationMs: durationMs && durationMs > 0 ? durationMs : null,
    acceptedAt,
    projectedAt,
    contractVersion: "1" as const,
    providerExecutionId: finalization.executionId,
    providerAttemptId: finalization.attemptId,
    providerFinalizationReference,
    providerUsageReference: buildProviderUsageReference(finalization.attemptId),
    providerCostReference: buildProviderCostReference(finalization.attemptId),
    projectionVersion: SCENE_PROJECTION_VERSION,
  };

  const sceneResult = ProjectedSceneResultSchema.parse({
    ...sceneWithoutHash,
    integrityHash: canonicalPersistenceHash(sceneResultHashPayload(sceneWithoutHash)),
  });

  const correlationWithoutHash = {
    projectionCorrelationId: deterministicPersistenceUuid(
      "ai-story-scene-projection-correlation",
      {
        sceneExecutionId: bundle.routingDecision.sceneExecutionId,
        providerFinalizationReference,
      }
    ),
    sceneExecutionId: bundle.routingDecision.sceneExecutionId,
    workerExecutionResultId: workerResult.workerExecutionResultId,
    providerExecutionId: finalization.executionId,
    providerAttemptId: finalization.attemptId,
    outboxJobId: finalization.jobId,
    dispatchId: workerResult.dispatchId,
    providerFinalizationReference,
    sceneResultId: sceneResult.sceneResultId,
    ownershipOrgId: ownership.orgId,
    ownershipWorkspaceId: ownership.workspaceId,
    projectedAt,
    contractVersion: SCENE_PROJECTION_CONTRACT_VERSION,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false as const,
  };

  const correlation = SceneProjectionCorrelationSchema.parse({
    ...correlationWithoutHash,
    integrityHash: canonicalPersistenceHash(
      correlationHashPayload(correlationWithoutHash)
    ),
  });

  return { correlation, sceneResult };
}

export class SceneResultProjector {
  constructor(private readonly repository: SceneProjectionRepository) {}

  async projectFromAcceptedFinalization(input: {
    readonly workerResult: WorkerExecutionResult;
    readonly bundle: SceneProjectionValidatedBundle;
    readonly finalization: AcceptedProviderFinalization;
  }): Promise<{
    readonly correlation: SceneProjectionCorrelation;
    readonly sceneResult: ProjectedSceneResult;
    readonly converged: boolean;
  }> {
    const projected = projectSceneResultFromAcceptedFinalization(input);
    return this.repository.acceptOrConvergeProjection(projected);
  }
}
