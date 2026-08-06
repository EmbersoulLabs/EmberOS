/**
 * Sprint 3 PR 3.1 — Runtime Authorization Service.
 *
 * Revalidates Review, Assembly, QC, and Ownership before issuing an immutable
 * RuntimeAuthorizedFact. Equivalent authorization converges; conflicting
 * authorization fails closed.
 *
 * Hard boundary:
 * - No scheduling, Outbox, Worker, Execute, Provider Router, adapters
 * - No automatic cross-provider fallback (DISABLED for V1)
 * - PHASE1_EXECUTION_LOCKED remains in force — issuing a fact does not unlock
 * - READY_FOR_EXECUTION is accepted only as a derived input signal, never stored
 *   as execution authority on the fact
 */
import {
  PHASE1_EXECUTION_LOCKED,
  RUNTIME_AUTHORIZATION_VERSION,
  RuntimeAuthorizedFactSchema,
  RuntimeOwnershipIdentitySchema,
  projectRuntimeAuthorization,
  type ExecutionPlanDerivedReadiness,
  type RuntimeAuthorizedFact,
  type RuntimeAuthorizationProjection,
  type RuntimeFailureClassification,
  type RuntimeOwnershipIdentity,
  type SceneRuntimeState,
} from "@ceo-agent/shared";
import { integrityHash, uuidFromIntegrityHash } from "./scene-execution-compiler";

export type RuntimeAuthorizationQcInput = {
  readonly qcResultId: string;
  readonly sceneExecutionId: string;
  readonly status: "passed" | "failed" | "warning";
  readonly resultHash: string;
};

export type RuntimeAuthorizationServiceInput = {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly reviewDecisionId: string;
  readonly reviewHash: string;
  readonly reviewDecision: "APPROVED" | "REJECTED";
  readonly assemblyDefinitionId: string;
  readonly assemblyHash: string;
  readonly orderedSceneExecutionIds: readonly string[];
  readonly qcResults: readonly RuntimeAuthorizationQcInput[];
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  /**
   * Explicit immutable RuntimeAuthorizedFact version (integer).
   * Defaults to RUNTIME_AUTHORIZATION_VERSION (1). Never inferred from package version.
   */
  readonly runtimeAuthorizationVersion?: number;
  /**
   * Derived readiness signal only. Must be READY_FOR_EXECUTION to authorize.
   * Never persisted onto RuntimeAuthorizedFact as authority.
   */
  readonly derivedReadiness: ExecutionPlanDerivedReadiness;
  /** Prior fact for the same Execution Plan (replay / conflict detection). */
  readonly existingFact?: RuntimeAuthorizedFact | null;
};

export type RuntimeAuthorizationServiceResult = {
  readonly fact: RuntimeAuthorizedFact;
  readonly converged: boolean;
  readonly executionAllowed: false;
  readonly executionLockCode: typeof PHASE1_EXECUTION_LOCKED;
  readonly automaticFallbackEnabled: false;
};

export class RuntimeAuthorizationError extends Error {
  readonly status = 409;
  readonly classification: RuntimeFailureClassification;

  constructor(
    classification: RuntimeFailureClassification,
    message: string,
    readonly code: string = classification
  ) {
    super(message);
    this.name = "RuntimeAuthorizationError";
    this.classification = classification;
  }
}

/**
 * Integrity payload for RuntimeAuthorizedFact.
 * Excludes volatile authorizedAt so equivalent replays converge.
 * Includes runtimeAuthorizationVersion (never inferred from package version).
 * Excludes projectionVersion (read-model only).
 */
export function buildRuntimeAuthorizationIntegrityPayload(
  input: Omit<
    RuntimeAuthorizationServiceInput,
    "authorizedAt" | "existingFact" | "derivedReadiness"
  >
): Record<string, unknown> {
  const runtimeAuthorizationVersion =
    input.runtimeAuthorizationVersion ?? RUNTIME_AUTHORIZATION_VERSION;
  return {
    kind: "runtime-authorized-fact",
    authorizationContractVersion: "1",
    runtimeAuthorizationVersion,
    executionPlanId: input.ownership.executionPlanId,
    ownership: {
      orgId: input.ownership.orgId,
      workspaceId: input.ownership.workspaceId,
      campaignId: input.ownership.campaignId,
      storyId: input.ownership.storyId,
      storyVersionId: input.ownership.storyVersionId,
      animationPackageId: input.ownership.animationPackageId,
      executionPlanId: input.ownership.executionPlanId,
    },
    reviewDecisionId: input.reviewDecisionId,
    reviewHash: input.reviewHash,
    reviewDecision: input.reviewDecision,
    assemblyDefinitionId: input.assemblyDefinitionId,
    assemblyHash: input.assemblyHash,
    orderedSceneExecutionIds: [...input.orderedSceneExecutionIds],
    qcResultIds: input.qcResults.map((row) => row.qcResultId),
    qcFingerprints: input.qcResults.map((row) => ({
      qcResultId: row.qcResultId,
      sceneExecutionId: row.sceneExecutionId,
      status: row.status,
      resultHash: row.resultHash,
    })),
    authorizedBy: input.authorizedBy,
  };
}

export function computeRuntimeAuthorizationIntegrityHash(
  input: Omit<RuntimeAuthorizationServiceInput, "authorizedAt" | "existingFact" | "derivedReadiness">
): string {
  return integrityHash(buildRuntimeAuthorizationIntegrityPayload(input));
}

function assertOwnershipConsistent(ownership: RuntimeOwnershipIdentity): void {
  RuntimeOwnershipIdentitySchema.parse(ownership);
  if (ownership.executionPlanId.trim().length === 0) {
    throw new RuntimeAuthorizationError(
      "OWNERSHIP_INVALID",
      "Execution Plan ownership identity is required"
    );
  }
}

function assertAuthorizationPrerequisites(
  input: RuntimeAuthorizationServiceInput
): void {
  assertOwnershipConsistent(input.ownership);

  if (input.derivedReadiness !== "READY_FOR_EXECUTION") {
    throw new RuntimeAuthorizationError(
      "BUSINESS_VALIDATION_FAILED",
      "Derived readiness is NOT_READY; RuntimeAuthorizedFact cannot be issued"
    );
  }

  if (input.reviewDecision !== "APPROVED") {
    throw new RuntimeAuthorizationError(
      "BUSINESS_VALIDATION_FAILED",
      "Story review must be APPROVED before RuntimeAuthorizedFact issuance"
    );
  }

  if (input.orderedSceneExecutionIds.length === 0) {
    throw new RuntimeAuthorizationError(
      "BUSINESS_VALIDATION_FAILED",
      "Assembly ordered Scene Execution ids are required"
    );
  }

  const uniqueScenes = new Set(input.orderedSceneExecutionIds);
  if (uniqueScenes.size !== input.orderedSceneExecutionIds.length) {
    throw new RuntimeAuthorizationError(
      "IDENTITY_CONFLICT",
      "orderedSceneExecutionIds contain duplicates"
    );
  }

  if (input.qcResults.length !== input.orderedSceneExecutionIds.length) {
    throw new RuntimeAuthorizationError(
      "QC_BLOCKED",
      "QC results must cover every ordered Scene Execution exactly once"
    );
  }

  const qcByScene = new Map<string, RuntimeAuthorizationQcInput>();
  for (const row of input.qcResults) {
    if (qcByScene.has(row.sceneExecutionId)) {
      throw new RuntimeAuthorizationError(
        "IDENTITY_CONFLICT",
        `Duplicate QC result for sceneExecutionId ${row.sceneExecutionId}`
      );
    }
    qcByScene.set(row.sceneExecutionId, row);
  }

  for (const sceneExecutionId of input.orderedSceneExecutionIds) {
    const qc = qcByScene.get(sceneExecutionId);
    if (!qc) {
      throw new RuntimeAuthorizationError(
        "QC_BLOCKED",
        `Missing QC result for sceneExecutionId ${sceneExecutionId}`
      );
    }
    if (qc.status === "failed") {
      throw new RuntimeAuthorizationError(
        "QC_BLOCKED",
        `QC failed for sceneExecutionId ${sceneExecutionId}`
      );
    }
  }

  const qcIds = new Set(input.qcResults.map((row) => row.qcResultId));
  if (qcIds.size !== input.qcResults.length) {
    throw new RuntimeAuthorizationError(
      "IDENTITY_CONFLICT",
      "qcResultIds must be unique"
    );
  }
}

function assertFactMatchesPlan(
  fact: RuntimeAuthorizedFact,
  executionPlanId: string
): void {
  if (fact.executionPlanId !== executionPlanId) {
    throw new RuntimeAuthorizationError(
      "IDENTITY_CONFLICT",
      "Existing RuntimeAuthorizedFact belongs to a different Execution Plan"
    );
  }
  if (fact.ownership.executionPlanId !== executionPlanId) {
    throw new RuntimeAuthorizationError(
      "OWNERSHIP_INVALID",
      "Existing RuntimeAuthorizedFact ownership drifts from Execution Plan"
    );
  }
}

function factsEquivalent(
  left: RuntimeAuthorizedFact,
  right: RuntimeAuthorizedFact
): boolean {
  return (
    left.runtimeAuthorizationId === right.runtimeAuthorizationId &&
    left.runtimeAuthorizationVersion === right.runtimeAuthorizationVersion &&
    left.deterministicIntegrityHash === right.deterministicIntegrityHash &&
    left.executionPlanId === right.executionPlanId &&
    left.reviewDecisionId === right.reviewDecisionId &&
    left.reviewHash === right.reviewHash &&
    left.assemblyDefinitionId === right.assemblyDefinitionId &&
    left.assemblyHash === right.assemblyHash &&
    left.authorizedBy === right.authorizedBy &&
    integrityHash(left.orderedSceneExecutionIds) ===
      integrityHash(right.orderedSceneExecutionIds) &&
    integrityHash(left.qcResultIds) === integrityHash(right.qcResultIds) &&
    integrityHash(left.ownership) === integrityHash(right.ownership)
  );
}

export class RuntimeAuthorizationService {
  /**
   * Revalidate Review + Assembly + QC + Ownership and issue RuntimeAuthorizedFact.
   * Does not schedule, dispatch, execute, or unlock Phase 1.
   */
  authorize(
    input: RuntimeAuthorizationServiceInput
  ): RuntimeAuthorizationServiceResult {
    assertAuthorizationPrerequisites(input);

    const runtimeAuthorizationVersion =
      input.runtimeAuthorizationVersion ?? RUNTIME_AUTHORIZATION_VERSION;
    if (
      !Number.isInteger(runtimeAuthorizationVersion) ||
      runtimeAuthorizationVersion < 1
    ) {
      throw new RuntimeAuthorizationError(
        "IDENTITY_CONFLICT",
        "runtimeAuthorizationVersion must be a positive integer"
      );
    }

    const integrityInput = {
      ...input,
      runtimeAuthorizationVersion,
    };
    const integrityHashValue =
      computeRuntimeAuthorizationIntegrityHash(integrityInput);
    const runtimeAuthorizationId = uuidFromIntegrityHash(
      integrityHash({
        kind: "runtimeAuthorizationId",
        integrityHash: integrityHashValue,
      })
    );

    const candidate = RuntimeAuthorizedFactSchema.parse({
      runtimeAuthorizationId,
      executionPlanId: input.ownership.executionPlanId,
      runtimeAuthorizationVersion,
      reviewDecisionId: input.reviewDecisionId,
      reviewHash: input.reviewHash,
      assemblyDefinitionId: input.assemblyDefinitionId,
      assemblyHash: input.assemblyHash,
      orderedSceneExecutionIds: [...input.orderedSceneExecutionIds],
      qcResultIds: input.qcResults.map((row) => row.qcResultId),
      ownership: input.ownership,
      authorizationContractVersion: "1",
      authorizedBy: input.authorizedBy,
      authorizedAt: input.authorizedAt,
      deterministicIntegrityHash: integrityHashValue,
    });

    const existing = input.existingFact ?? null;
    if (existing) {
      assertFactMatchesPlan(existing, input.ownership.executionPlanId);
      if (existing.runtimeAuthorizationVersion !== runtimeAuthorizationVersion) {
        throw new RuntimeAuthorizationError(
          "IDENTITY_CONFLICT",
          "Conflicting runtimeAuthorizationVersion; authorization fails closed"
        );
      }
      if (existing.deterministicIntegrityHash === candidate.deterministicIntegrityHash) {
        if (!factsEquivalent(existing, { ...candidate, authorizedAt: existing.authorizedAt })) {
          throw new RuntimeAuthorizationError(
            "IDENTITY_CONFLICT",
            "Equivalent integrity hash but conflicting RuntimeAuthorizedFact identity"
          );
        }
        return {
          fact: existing,
          converged: true,
          executionAllowed: false,
          executionLockCode: PHASE1_EXECUTION_LOCKED,
          automaticFallbackEnabled: false,
        };
      }
      throw new RuntimeAuthorizationError(
        "IDENTITY_CONFLICT",
        "Conflicting RuntimeAuthorizedFact for Execution Plan; authorization fails closed"
      );
    }

    return {
      fact: candidate,
      converged: false,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      automaticFallbackEnabled: false,
    };
  }

  /**
   * Pure projection helper — derives AUTHORIZED coverage without authorizing.
   */
  project(input: {
    readonly ownership: RuntimeOwnershipIdentity;
    readonly authorizedFact: RuntimeAuthorizedFact | null;
    readonly scenes: readonly {
      readonly sceneExecutionId: string;
      readonly sceneId: string;
      readonly sceneOrder: number;
      readonly observedState?: SceneRuntimeState;
    }[];
    readonly derivedReadiness: ExecutionPlanDerivedReadiness;
    readonly derivedAt: string;
  }): RuntimeAuthorizationProjection {
    return projectRuntimeAuthorization(input);
  }
}
