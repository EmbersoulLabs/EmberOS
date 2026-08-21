/**
 * Sprint 3 PR 3.7 Phase D — Canonical product Execute orchestration.
 *
 * Sole product-reachable authority to:
 *   derive READY_FOR_EXECUTION → create-or-return RuntimeAuthorizedFact
 *   → schedule every required Scene via SceneSchedulingCoordinator
 *
 * Does NOT call Provider/Worker/Finalizer/Assembly/FSR.
 * Does NOT call assertPhase1ExecutionLocked (selective unlock for this path only).
 * Legacy /execution and agent.story_execution remain locked.
 */
import { asc, eq } from "drizzle-orm";
import {
  CanonicalExecuteResponseSchema,
  PHASE1_EXECUTION_LOCKED,
  toAiStoryExecutionAuthorizationEvidence,
  type AiStoryExecutionAuthorization,
  type CanonicalExecuteResponse,
  type CanonicalExecuteRuntimeStatus,
  type RuntimeOwnershipIdentity,
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  AiStorySceneReleaseRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  RuntimeAuthorizationPersistenceRepository,
  getDb,
  schema,
  type ProductionVerificationAuthority,
  type QueryDb,
  type RuntimeAuthorizationPersistenceTimings,
} from "@ceo-agent/db";
import type { ProviderRouter, ProviderRoutingPolicy } from "../provider-router";
import { CommercialAuthorizationService } from "../commercial/commercial-authorization-runtime";
import {
  CommercialAuthorizationError,
} from "@ceo-agent/db";
import {
  RuntimeAuthorizationError,
  RuntimeAuthorizationService,
  type RuntimeAuthorizationQcInput,
} from "./runtime-authorization-service";
import {
  SceneSchedulingCoordinator,
  SceneSchedulingError,
} from "./scene-scheduling-coordinator";

export class CanonicalExecuteError extends Error {
  readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    status = 409
  ) {
    super(message);
    this.name = "CanonicalExecuteError";
    this.status = status;
  }
}

export type AuthorizeAndExecuteExecutionPlanInput = {
  readonly executionPlanId: string;
  readonly actorUserId: string;
  readonly ownership: RuntimeOwnershipIdentity;
  readonly router: ProviderRouter;
  /** Optional frozen routing policy. Product Execute supplies config-derived eligibility. */
  readonly routingPolicy?: ProviderRoutingPolicy;
  readonly preferredProviders?: readonly string[];
  /** Optional DI for tests. */
  readonly now?: () => Date;
  readonly authorizationService?: RuntimeAuthorizationService;
  readonly authorizationRepository?: RuntimeAuthorizationPersistenceRepository;
  readonly reviewRepository?: ExecutionPlanReviewRepository;
  readonly assemblyRepository?: ExecutionPlanAssemblyRepository;
  readonly persistenceRepository?: AiStorySceneExecutionPersistenceRepository;
  readonly schedulingCoordinator?: SceneSchedulingCoordinator;
  readonly sceneReleaseRepository?: AiStorySceneReleaseRepository;
  readonly commercialAuthorizationService?: CommercialAuthorizationService;
  /**
   * EXEC-03 product authorization decision. When omitted, Execute keeps the
   * legacy commercial fail-closed path. Ops/agency callers must pass an
   * explicit non-commercial decision — never inferred from billing failure.
   */
  readonly executionAuthorization?: AiStoryExecutionAuthorization;
  /** Server-created PROD-VERIFY-01 authority. Never derived from request data. */
  readonly productionVerification?: ProductionVerificationAuthority;
  /**
   * Canonical transaction authority for compilation/review/assembly/QC reads
   * through RuntimeAuthorizedFact acceptance. Production defaults to getDb().transaction;
   * tests may inject an equivalent max-one-pool transaction runner.
   */
  readonly runtimeAuthorizationTransaction?: RuntimeAuthorizationTransactionRunner;
  readonly observeRuntimeAuthorizationBoundary?: (
    timings: RuntimeAuthorizationBoundaryTimings
  ) => void;
  readonly loadLatestQc?: (
    executionPlanId: string,
    orderedSceneExecutionIds: readonly string[]
  ) => Promise<RuntimeAuthorizationQcInput[]>;
};

export type AuthorizeAndExecuteExecutionPlanResult = {
  readonly response: CanonicalExecuteResponse;
  readonly httpStatus: 200 | 202;
  readonly runtimeAuthorizationId: string;
  readonly commercialAuthorizationId: string | null;
  readonly scheduledSceneIds: readonly string[];
  readonly executionAuthorization: AiStoryExecutionAuthorization | null;
};

/**
 * Narrow selective-unlock marker for the canonical product Execute path.
 * Does not weaken assertPhase1ExecutionLocked() globally.
 */
export function enterCanonicalProductExecutePath(): void {
  // Intentional no-op: this call site is the sole selective product Execute gate.
}

export type RuntimeAuthorizationBoundaryTimings = {
  readonly authEvaluationMs: number;
  readonly authorizedFactLookupMs: number;
  readonly authorizedFactWriteMs: number;
  readonly executionAuthorizationWriteMs: number;
  readonly commitMs: number;
};

type RuntimeAuthorizationTransactionDb = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export type RuntimeAuthorizationTransactionRunner = <T>(
  operation: (tx: RuntimeAuthorizationTransactionDb) => Promise<T>
) => Promise<T>;

function deriveReady(input: {
  readonly reviewStatus: string;
  readonly hasDefinition: boolean;
  readonly membershipComplete: boolean;
  readonly orderingDeterministic: boolean;
  readonly scenesHaveNonBlockingQc: boolean;
}): "READY_FOR_EXECUTION" | "NOT_READY" {
  if (
    input.reviewStatus === "APPROVED" &&
    input.hasDefinition &&
    input.membershipComplete &&
    input.orderingDeterministic &&
    input.scenesHaveNonBlockingQc
  ) {
    return "READY_FOR_EXECUTION";
  }
  return "NOT_READY";
}

function mapQcStatus(
  status: string
): "passed" | "failed" | "warning" {
  if (status === "passed" || status === "failed" || status === "warning") {
    return status;
  }
  return "failed";
}

async function loadLatestQcByScene(
  executionPlanId: string,
  orderedSceneExecutionIds: readonly string[],
  db: QueryDb = getDb()
): Promise<RuntimeAuthorizationQcInput[]> {
  const rows = await db
    .select()
    .from(schema.aiStorySceneIntentValidationResults)
    .where(
      eq(schema.aiStorySceneIntentValidationResults.executionPlanId, executionPlanId)
    )
    .orderBy(
      asc(schema.aiStorySceneIntentValidationResults.acceptedAt),
      asc(schema.aiStorySceneIntentValidationResults.id)
    );

  const latestByScene = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    latestByScene.set(row.sceneExecutionId, row);
  }

  return orderedSceneExecutionIds.map((sceneExecutionId) => {
    const row = latestByScene.get(sceneExecutionId);
    if (!row) {
      throw new CanonicalExecuteError(
        "EXECUTE_NOT_READY",
        `Missing QC validation for sceneExecutionId ${sceneExecutionId}`,
        409
      );
    }
    return {
      qcResultId: row.id,
      sceneExecutionId,
      status: mapQcStatus(row.status),
      resultHash: row.resultHash,
    };
  });
}

/**
 * Canonical product Execute facade.
 * Orchestrates frozen Review/Assembly/QC → RuntimeAuthorization → Scene Scheduling.
 */
export async function authorizeAndExecuteExecutionPlan(
  input: AuthorizeAndExecuteExecutionPlanInput
): Promise<AuthorizeAndExecuteExecutionPlanResult> {
  enterCanonicalProductExecutePath();

  if (input.ownership.executionPlanId !== input.executionPlanId) {
    throw new CanonicalExecuteError(
      "OWNERSHIP_INVALID",
      "Execution Plan ownership identity mismatch",
      409
    );
  }

  const reviewRepo =
    input.reviewRepository ?? new ExecutionPlanReviewRepository();
  const assemblyRepo =
    input.assemblyRepository ?? new ExecutionPlanAssemblyRepository();
  const persistence =
    input.persistenceRepository ??
    new AiStorySceneExecutionPersistenceRepository();
  const authRepo =
    input.authorizationRepository ??
    new RuntimeAuthorizationPersistenceRepository();
  const authService =
    input.authorizationService ?? new RuntimeAuthorizationService();
  const scheduling =
    input.schedulingCoordinator ??
    new SceneSchedulingCoordinator({ router: input.router });
  const commercialAuth =
    input.commercialAuthorizationService ??
    new CommercialAuthorizationService();
  const now = input.now ?? (() => new Date());

  const executionAuthorization = input.executionAuthorization ?? null;
  if (
    executionAuthorization &&
    executionAuthorization.settlementMode === "none" &&
    executionAuthorization.accessMode !== "ops"
  ) {
    throw new CanonicalExecuteError(
      "AI_STORY_EXECUTION_DENIED",
      "Non-commercial settlement requires ops accessMode",
      403
    );
  }
  const persistenceTimings: RuntimeAuthorizationPersistenceTimings = {
    authorizedFactLookupMs: 0,
    authorizedFactWriteMs: 0,
  };
  let authEvaluationMs = 0;

  const evaluateAndPersistRuntimeAuthorization = async (
    dbAuthority?: QueryDb
  ) => {
    const persisted = await persistence.getByExecutionPlanId(
      input.executionPlanId,
      dbAuthority
    );
    if (!persisted) {
      throw new CanonicalExecuteError(
        "EXECUTE_NOT_READY",
        "Execution Plan compilation is missing",
        409
      );
    }

    const review = await reviewRepo.getLogicalProjection(
      input.executionPlanId,
      dbAuthority
    );
    if (!review) {
      throw new CanonicalExecuteError(
        "EXECUTE_NOT_READY",
        "Review projection is missing",
        409
      );
    }
    if (review.status === "REJECTED") {
      throw new CanonicalExecuteError(
        "EXECUTE_REVIEW_REJECTED",
        "Human Review is REJECTED; Execute is denied",
        409
      );
    }
    if (review.status !== "APPROVED" || !review.storyDecision) {
      throw new CanonicalExecuteError(
        "EXECUTE_REVIEW_NOT_APPROVED",
        "Human Review must be APPROVED before Execute",
        409
      );
    }

    const assembly = await assemblyRepo.getProjection(
      input.executionPlanId,
      dbAuthority
    );
    if (!assembly?.definition) {
      throw new CanonicalExecuteError(
        "EXECUTE_ASSEMBLY_MISSING",
        "Assembly Definition is required before Execute",
        409
      );
    }
    const prerequisites = assembly.prerequisites;
    if (!prerequisites.membershipComplete || !prerequisites.orderingDeterministic) {
      throw new CanonicalExecuteError(
        "EXECUTE_ASSEMBLY_INVALID",
        "Assembly Definition memberships are incomplete or non-deterministic",
        409
      );
    }

    const orderedSceneExecutionIds = [
      ...assembly.definition.orderedSceneExecutionIds,
    ];
    if (orderedSceneExecutionIds.length === 0) {
      throw new CanonicalExecuteError(
        "EXECUTE_ASSEMBLY_INVALID",
        "Assembly Definition has no ordered scenes",
        409
      );
    }

    const qcResults = input.loadLatestQc
      ? await input.loadLatestQc(input.executionPlanId, orderedSceneExecutionIds)
      : await loadLatestQcByScene(
          input.executionPlanId,
          orderedSceneExecutionIds,
          dbAuthority
        );
    const scenesHaveNonBlockingQc = qcResults.every((row) => row.status !== "failed");
    if (!scenesHaveNonBlockingQc) {
      throw new CanonicalExecuteError(
        "EXECUTE_QC_BLOCKED",
        "QC blockers prevent Execute",
        409
      );
    }

    const derivedReadiness = deriveReady({
      reviewStatus: review.status,
      hasDefinition: prerequisites.hasDefinition,
      membershipComplete: prerequisites.membershipComplete,
      orderingDeterministic: prerequisites.orderingDeterministic,
      scenesHaveNonBlockingQc,
    });
    if (derivedReadiness !== "READY_FOR_EXECUTION") {
      throw new CanonicalExecuteError(
        "EXECUTE_NOT_READY",
        "Execution Plan is NOT_READY for Execute",
        409
      );
    }

    let issued;
    const authEvaluationStartedAt = performance.now();
    try {
      issued = authService.authorize({
        ownership: input.ownership,
        reviewDecisionId: review.storyDecision.factId,
        reviewHash: review.storyDecision.deterministicFingerprint,
        reviewDecision: "APPROVED",
        assemblyDefinitionId: assembly.definition.assemblyDefinitionId,
        assemblyHash: assembly.definition.deterministicFingerprint,
        orderedSceneExecutionIds,
        qcResults,
        authorizedBy: input.actorUserId,
        authorizedAt: now().toISOString(),
        derivedReadiness: "READY_FOR_EXECUTION",
      });
    } catch (error) {
      if (error instanceof RuntimeAuthorizationError) {
        throw new CanonicalExecuteError(error.code, error.message, error.status);
      }
      throw error;
    } finally {
      authEvaluationMs += performance.now() - authEvaluationStartedAt;
    }

    const factToPersist = executionAuthorization
      ? {
          ...issued.fact,
          executionAuthorization:
            toAiStoryExecutionAuthorizationEvidence(executionAuthorization),
        }
      : issued.fact;

    try {
      const accepted = dbAuthority
        ? await authRepo.acceptOrReturnInTransaction(
            factToPersist,
            dbAuthority as RuntimeAuthorizationTransactionDb,
            persistenceTimings
          )
        : await authRepo.acceptOrReturn(factToPersist);
      return { accepted, orderedSceneExecutionIds };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
      ) {
        throw new CanonicalExecuteError(
          (error as { code: string }).code,
          error instanceof Error ? error.message : "Runtime authorization conflict",
          409
        );
      }
      throw error;
    }
  };

  const defaultDbRepositories =
    !input.persistenceRepository &&
    !input.reviewRepository &&
    !input.assemblyRepository &&
    !input.authorizationRepository &&
    !input.loadLatestQc;
  const useCanonicalTransaction =
    Boolean(input.runtimeAuthorizationTransaction) || defaultDbRepositories;
  let commitMs = 0;
  let transactionBodyCompletedAt = 0;
  let boundary;
  if (useCanonicalTransaction) {
    const runTransaction = input.runtimeAuthorizationTransaction ??
      (<T>(operation: (tx: RuntimeAuthorizationTransactionDb) => Promise<T>) =>
        getDb().transaction(operation));
    boundary = await runTransaction(async (tx) => {
      const result = await evaluateAndPersistRuntimeAuthorization(tx);
      transactionBodyCompletedAt = performance.now();
      return result;
    });
    commitMs = performance.now() - transactionBodyCompletedAt;
  } else {
    boundary = await evaluateAndPersistRuntimeAuthorization();
  }
  const { accepted, orderedSceneExecutionIds } = boundary;
  const boundaryTimings: RuntimeAuthorizationBoundaryTimings = {
    authEvaluationMs,
    authorizedFactLookupMs: persistenceTimings.authorizedFactLookupMs,
    authorizedFactWriteMs: persistenceTimings.authorizedFactWriteMs,
    executionAuthorizationWriteMs: persistenceTimings.authorizedFactWriteMs,
    commitMs,
  };
  input.observeRuntimeAuthorizationBoundary?.(boundaryTimings);
  console.info(JSON.stringify({
    event: "AI_STORY_RUNTIME_AUTHORIZATION_BOUNDARY_COMPLETED",
    executionPlanId: input.executionPlanId,
    ...boundaryTimings,
  }));

  const skipCommercialSettlement =
    executionAuthorization?.accessMode === "ops" &&
    executionAuthorization.settlementMode === "none";

  let commercial: Awaited<
    ReturnType<CommercialAuthorizationService["authorizeExecutionPlanExecute"]>
  > | null = null;
  if (!skipCommercialSettlement) {
    try {
      commercial = await commercialAuth.authorizeExecutionPlanExecute({
        orgId: input.ownership.orgId,
        workspaceId: input.ownership.workspaceId,
        executionPlanId: input.executionPlanId,
        authorizedAt: now().toISOString(),
      });
    } catch (error) {
      if (error instanceof CommercialAuthorizationError) {
        throw new CanonicalExecuteError(error.code, error.message, error.status);
      }
      throw error;
    }
  }

  const releases = input.sceneReleaseRepository ?? new AiStorySceneReleaseRepository();
  const releaseRows = await releases.initialize({
    executionPlanId: input.executionPlanId,
    runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
    workspaceId: input.ownership.workspaceId,
    orderedSceneExecutionIds,
    actorUserId: input.actorUserId,
    releasedAt: now(),
  });
  const initialScene = releaseRows.find(
    (row) => row.sceneOrder === 1 && row.releaseState === "RELEASED"
  );
  const releaseLedgerMatchesAuthorization =
    releaseRows.length === orderedSceneExecutionIds.length &&
    releaseRows.every((row, index) =>
      row.sceneOrder === index + 1 &&
      row.sceneExecutionId === orderedSceneExecutionIds[index] &&
      row.runtimeAuthorizationId === accepted.fact.runtimeAuthorizationId &&
      row.workspaceId === input.ownership.workspaceId
    );
  if (!releaseLedgerMatchesAuthorization || !initialScene || initialScene.sceneExecutionId !== orderedSceneExecutionIds[0]) {
    throw new CanonicalExecuteError(
      "STAGED_RELEASE_CONFLICT",
      "Durable initial Scene release does not match Assembly ordering",
      409
    );
  }

  const scheduledSceneIds: string[] = [];
  let anyNewSchedule = false;
  for (const sceneExecutionId of [initialScene.sceneExecutionId]) {
    try {
      const bundle = await scheduling.scheduleAuthorizedScene({
        executionPlanId: input.executionPlanId,
        sceneExecutionId,
        runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
        commercialAuthorizationId: commercial
          ? commercial.authorization.commercialAuthorizationId
          : undefined,
        executionAuthorization: executionAuthorization
          ? toAiStoryExecutionAuthorizationEvidence(executionAuthorization)
          : accepted.fact.executionAuthorization,
        actorUserId: input.actorUserId,
        routingPolicy: input.routingPolicy,
        preferredProviders: input.preferredProviders,
        productionVerification: input.productionVerification,
      });
      scheduledSceneIds.push(sceneExecutionId);
      // Replayed accepted bundles still count toward scheduledSceneCount.
      if (!bundle.replayed) {
        anyNewSchedule = true;
      }
    } catch (error) {
      if (error instanceof SceneSchedulingError) {
        // Idempotent converge: accepted equivalent replay may surface as get-or-return.
        if (error.code === "ROUTING_DECISION_CONFLICT" || error.code === "OUTBOX_SCHEDULING_CONFLICT") {
          throw new CanonicalExecuteError(error.code, error.message, 409);
        }
        throw new CanonicalExecuteError(error.code, error.message, 409);
      }
      throw error;
    }
  }

  const newlyAccepted = !accepted.converged || anyNewSchedule;
  const runtimeStatus: CanonicalExecuteRuntimeStatus = newlyAccepted
    ? "AUTHORIZED_AND_SCHEDULED"
    : "ALREADY_AUTHORIZED_AND_SCHEDULED";

  const response = CanonicalExecuteResponseSchema.parse({
    contractVersion: "1",
    executionPlanId: input.executionPlanId,
    runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
    runtimeStatus,
    runtimeProjectionVersion: 1,
    scheduledSceneCount: scheduledSceneIds.length,
    converged: !newlyAccepted,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false,
  });

  return {
    response,
    httpStatus: newlyAccepted ? 202 : 200,
    runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
    commercialAuthorizationId:
      commercial?.authorization.commercialAuthorizationId ?? null,
    scheduledSceneIds,
    executionAuthorization,
  };
}
