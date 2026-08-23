/**
 * Sprint 3 PR 3.7 Phase E — derive product-safe runtime projection.
 *
 * Observational only. Never authorizes, schedules, dispatches, or advances runtime.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  PRODUCT_RUNTIME_STATUS_CONTRACT_VERSION,
  ProductRuntimeProjectionSchema,
  RUNTIME_PROJECTION_VERSION,
  deriveProductCanExecute,
  deriveProductRuntimeStatus,
  emptyAiStoryProviderSpendProjection,
  latestRowBySceneExecutionId,
  type ProductRuntimeAssemblyState,
  type ProductRuntimeProjection,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyJobRepositoryImpl,
  AssemblyValidationRepositoryImpl,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  type ExecutionPlanReviewProjectionTimingRecorder,
  FinalStoryResultRepositoryImpl,
  AiStorySceneReleaseRepository,
  RuntimeAuthorizationPersistenceRepository,
  reconstructAiStoryProviderSpendForPlan,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  GeneratedSceneReviewService,
  type GeneratedSceneReviewReadTiming,
  type GeneratedSceneReviewPathMarkerSink,
  type GeneratedSceneReviewReadSubstageRecorder,
} from "./generated-scene-review-service";

const OPERATOR_ROLES: ReadonlySet<string> = new Set(["admin", "operator"]);

function mapQcStatus(status: string): "passed" | "failed" | "warning" {
  if (status === "passed" || status === "failed" || status === "warning") {
    return status;
  }
  return "failed";
}

function deriveReady(input: {
  readonly reviewStatus: string;
  readonly hasDefinition: boolean;
  readonly membershipComplete: boolean;
  readonly orderingDeterministic: boolean;
  readonly scenesHaveNonBlockingQc: boolean;
}): boolean {
  return (
    input.reviewStatus === "APPROVED" &&
    input.hasDefinition &&
    input.membershipComplete &&
    input.orderingDeterministic &&
    input.scenesHaveNonBlockingQc
  );
}

async function loadLatestQcNonBlocking(
  executionPlanId: string,
  orderedSceneExecutionIds: readonly string[]
): Promise<boolean> {
  if (orderedSceneExecutionIds.length === 0) return false;
  const db = getDb();
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

  for (const sceneExecutionId of orderedSceneExecutionIds) {
    const row = latestByScene.get(sceneExecutionId);
    if (!row) return false;
    if (mapQcStatus(row.status) === "failed") return false;
  }
  return true;
}

function deriveAssemblyState(facts: readonly { factKind: string }[]): ProductRuntimeAssemblyState {
  const kinds = new Set(facts.map((f) => f.factKind));
  if (kinds.has("SUCCEEDED")) return "SUCCEEDED";
  if (kinds.has("FAILED")) return "FAILED";
  if (kinds.has("PROCESSING_STARTED")) return "PROCESSING";
  if (kinds.has("ACCEPTED")) return "ACCEPTED";
  return "NONE";
}

function safeFailureSummary(input: {
  readonly status: ProductRuntimeProjection["status"];
  readonly failedSceneCount: number;
  readonly reconciliationCount: number;
  readonly assemblySafeMessage: string | null;
}): string | null {
  if (input.status === "SCENES_FAILED") {
    return input.failedSceneCount === 1
      ? "One scene failed to generate."
      : `${input.failedSceneCount} scenes failed to generate.`;
  }
  if (input.status === "RECONCILIATION_REQUIRED") {
    return "Scene generation requires operator reconciliation. Retry is not available in Sprint 3.";
  }
  if (input.status === "ASSEMBLY_FAILED") {
    return input.assemblySafeMessage ?? "Final story assembly failed.";
  }
  return null;
}

/**
 * Count open reconciliation signals for a plan via correlations → worker evidence.
 * Does not expose internal ids in the product projection.
 */
async function countOpenReconciliations(
  executionPlanId: string,
  terminalSceneExecutionIds: ReadonlySet<string>
): Promise<number> {
  const db = getDb();
  const correlations = await db
    .select({
      sceneExecutionId: schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
      outboxJobId: schema.aiStorySceneSchedulingCorrelations.outboxJobId,
    })
    .from(schema.aiStorySceneSchedulingCorrelations)
    .where(eq(schema.aiStorySceneSchedulingCorrelations.executionPlanId, executionPlanId));

  const openOutboxIds = correlations
    .filter((row) => !terminalSceneExecutionIds.has(row.sceneExecutionId))
    .map((row) => row.outboxJobId);
  if (openOutboxIds.length === 0) return 0;

  const dispatches = await db
    .select({
      dispatchId: schema.providerExecutionDispatches.dispatchId,
      jobId: schema.providerExecutionDispatches.jobId,
    })
    .from(schema.providerExecutionDispatches)
    .where(inArray(schema.providerExecutionDispatches.jobId, openOutboxIds));

  const openDispatchIds = dispatches.map((row) => row.dispatchId);
  if (openDispatchIds.length === 0) return 0;

  const [workerRows, observationRows] = await Promise.all([
    db
      .select({
        dispatchId: schema.aiStoryWorkerExecutionResults.dispatchId,
        reconciliationRequired:
          schema.aiStoryWorkerExecutionResults.reconciliationRequired,
      })
      .from(schema.aiStoryWorkerExecutionResults)
      .where(
        and(
          inArray(schema.aiStoryWorkerExecutionResults.dispatchId, openDispatchIds),
          eq(schema.aiStoryWorkerExecutionResults.reconciliationRequired, true)
        )
      ),
    db
      .select({
        dispatchId: schema.aiStoryWorkerAttemptObservations.dispatchId,
        reconciliationRequired:
          schema.aiStoryWorkerAttemptObservations.reconciliationRequired,
      })
      .from(schema.aiStoryWorkerAttemptObservations)
      .where(
        and(
          inArray(
            schema.aiStoryWorkerAttemptObservations.dispatchId,
            openDispatchIds
          ),
          eq(schema.aiStoryWorkerAttemptObservations.reconciliationRequired, true)
        )
      ),
  ]);

  const reconDispatchIds = new Set<string>();
  for (const row of workerRows) reconDispatchIds.add(row.dispatchId);
  for (const row of observationRows) reconDispatchIds.add(row.dispatchId);
  return reconDispatchIds.size;
}

export type DeriveProductRuntimeProjectionInput = {
  readonly executionPlanId: string;
  readonly callerRole: WorkspaceRole | string | null;
  readonly derivedAt?: string;
  readonly observeStage?: <T>(stage: "runtime_authorization_read" | "execution_plan_review_projection_read" | "release_state_read" | "provider_attempt_read" | "scene_result_read" | "generated_scene_review_read" | "cost_usage_projection" | "runtime_projection_build", operation: () => Promise<T>) => Promise<T>;
  readonly executionPlanReviewProjectionTimingRecorder?: ExecutionPlanReviewProjectionTimingRecorder;
  readonly onGeneratedSceneReviewReadTiming?: (timing: GeneratedSceneReviewReadTiming) => void;
  readonly onGeneratedSceneReviewPathMarker?: GeneratedSceneReviewPathMarkerSink;
  readonly generatedSceneReviewReadSubstageRecorder?: GeneratedSceneReviewReadSubstageRecorder;
};

/**
 * Load persisted authorities and derive the product runtime projection.
 * GET side-effect free.
 */
export async function deriveProductRuntimeProjection(
  input: DeriveProductRuntimeProjectionInput
): Promise<ProductRuntimeProjection> {
  const executionPlanId = input.executionPlanId;
  const derivedAt = input.derivedAt ?? new Date().toISOString();
  const observe = input.observeStage ?? (async (_stage, operation) => operation());

  const reviewRepo = new ExecutionPlanReviewRepository();
  const assemblyRepo = new ExecutionPlanAssemblyRepository();
  const authRepo = new RuntimeAuthorizationPersistenceRepository();
  const persistence = new AiStorySceneExecutionPersistenceRepository();
  const validation = new AssemblyValidationRepositoryImpl();
  const jobRepo = new AssemblyJobRepositoryImpl();
  const fsrRepo = new FinalStoryResultRepositoryImpl();
  const releaseRepo = new AiStorySceneReleaseRepository();

  const [review, assembly, authFact, fsr, compilation] = await Promise.all([
    observe("execution_plan_review_projection_read", () =>
      reviewRepo.getLogicalProjection(
        executionPlanId,
        undefined,
        input.executionPlanReviewProjectionTimingRecorder
      )
    ),
    observe("runtime_projection_build", () => assemblyRepo.getProjection(executionPlanId)),
    observe("runtime_authorization_read", () => authRepo.getByExecutionPlanId(executionPlanId)),
    observe("scene_result_read", () => fsrRepo.getByExecutionPlanId(executionPlanId)),
    observe("provider_attempt_read", () => persistence.getByExecutionPlanId(executionPlanId)),
  ]);

  const orderedSceneExecutionIds =
    (assembly?.orderedSceneExecutionIds?.length
      ? assembly.orderedSceneExecutionIds
      : assembly?.definition?.orderedSceneExecutionIds) ??
    compilation?.intents
      .slice()
      .sort((a, b) => a.identity.sceneOrder - b.identity.sceneOrder)
      .map((intent) => intent.identity.sceneExecutionId) ??
    [];

  const requiredSceneCount = orderedSceneExecutionIds.length;

  const scenesHaveNonBlockingQc =
    requiredSceneCount === 0
      ? false
      : await loadLatestQcNonBlocking(executionPlanId, orderedSceneExecutionIds);

  const canonicalReadinessSatisfied = deriveReady({
    reviewStatus: review?.status ?? "NOT_OPENED",
    hasDefinition: Boolean(assembly?.prerequisites.hasDefinition),
    membershipComplete: Boolean(assembly?.prerequisites.membershipComplete),
    orderingDeterministic: Boolean(assembly?.prerequisites.orderingDeterministic),
    scenesHaveNonBlockingQc,
  });

  const sceneResults = await observe("scene_result_read", () => validation.listCanonicalSceneResults(executionPlanId));
  const latestByScene = latestRowBySceneExecutionId(sceneResults, (left, right) =>
    left.acceptedAt.localeCompare(right.acceptedAt)
  );
  const latestResults = [...latestByScene.values()];
  const succeededSceneCount = latestResults.filter((r) => r.status === "SUCCEEDED").length;
  const failedSceneCount = latestResults.filter(
    (r) => r.status === "FAILED" || r.status === "REJECTED" || r.status === "TIMEOUT"
  ).length;

  input.onGeneratedSceneReviewPathMarker?.({
    marker: "review_parent_entry.v1",
    sourceModule: "packages/agents/src/ai-story/derive-product-runtime-projection.ts",
    sourceFunction: "deriveProductRuntimeProjection",
    traceVersion: "review-helper-entry-path.v1",
  });
  const generatedSceneReviewBase = await observe("generated_scene_review_read", () => {
    input.onGeneratedSceneReviewPathMarker?.({
      marker: "review_projection_caller.v1",
      sourceModule: "packages/agents/src/ai-story/derive-product-runtime-projection.ts",
      sourceFunction: "deriveProductRuntimeProjection",
      traceVersion: "review-helper-entry-path.v1",
    });
    return new GeneratedSceneReviewService({
      onLoadPlanReadModelTiming: input.onGeneratedSceneReviewReadTiming,
    }).loadPlanReadModel(
      executionPlanId,
      input.generatedSceneReviewReadSubstageRecorder,
      input.onGeneratedSceneReviewPathMarker
    );
  }).catch(() => []);
  const sceneResultById = new Map(latestResults.map((row) => [row.sceneResultId, row]));
  const generatedSceneReviews = generatedSceneReviewBase.map((review) => {
    const latestAttempt = review.attempts.find(
      (attempt) => attempt.attemptId === review.latestAttemptId
    );
    const result = latestAttempt?.sceneResultId
      ? sceneResultById.get(latestAttempt.sceneResultId)
      : undefined;
    const media =
      result?.status === "SUCCEEDED" &&
      result.mediaReference &&
      latestAttempt?.attemptId === review.latestAttemptId &&
      result.sceneExecutionId === review.sceneExecutionId
        ? {
            mediaId: result.sceneResultId,
            sceneResultId: result.sceneResultId,
            sceneExecutionId: result.sceneExecutionId,
            providerAttemptId: latestAttempt.attemptId,
            mediaType: result.mediaReference.mediaType,
            contentType: result.mediaReference.mediaType,
            deliveryUrl: null,
            expiresAt: null,
            deliveryStatus: "PENDING" as const,
            safeError: null,
          }
        : null;
    return { ...review, generatedMedia: media };
  });
  const pendingReviewSceneCount = generatedSceneReviews.filter(
    (row) => row.reviewState === "PENDING_REVIEW"
  ).length;
  const approvedSceneCount = generatedSceneReviews.filter(
    (row) => row.reviewState === "APPROVED"
  ).length;
  const releaseRows = authFact ? await observe("release_state_read", () => releaseRepo.list(executionPlanId)) : [];
  const sceneReleaseStates = releaseRows.map((row) => ({
    sceneExecutionId: row.sceneExecutionId,
    sceneOrder: row.sceneOrder,
    releaseState: row.releaseState === "RELEASED" ? "RELEASED" as const : "AUTHORIZED_NOT_RELEASED" as const,
  }));
  const heldSceneCount = sceneReleaseStates.filter((row) => row.releaseState === "AUTHORIZED_NOT_RELEASED").length;
  const firstSceneId = sceneReleaseStates.find((row) => row.sceneOrder === 1)?.sceneExecutionId;
  const firstApproved = generatedSceneReviews.some((row) => row.sceneExecutionId === firstSceneId && row.reviewState === "APPROVED");
  const remainingReleasePermitted = Boolean(authFact && heldSceneCount > 0 && firstApproved);
  const runningSceneCount = generatedSceneReviews.filter((row) => row.running).length;

  const terminalSceneExecutionIds = new Set(
    latestResults
      .filter((row) => !generatedSceneReviews.some((review) => review.sceneExecutionId === row.sceneExecutionId && review.running))
      .map((r) => r.sceneExecutionId)
  );

  const reconciliationCount = authFact
    ? await countOpenReconciliations(executionPlanId, terminalSceneExecutionIds)
    : 0;

  const incompleteSceneCount = Math.max(
    0,
    requiredSceneCount - succeededSceneCount - failedSceneCount
  );

  const hasActiveSceneRuntime =
    Boolean(authFact) &&
    reconciliationCount === 0 &&
    (incompleteSceneCount > 0 || runningSceneCount > 0);

  const assemblyJob = await jobRepo.getLatestByExecutionPlanId(executionPlanId);
  const assemblyFacts = assemblyJob
    ? await jobRepo.loadAssemblyFacts(assemblyJob.assemblyJobId)
    : [];
  const assemblyState = deriveAssemblyState(assemblyFacts);

  const failedFact = assemblyFacts.find((f) => f.factKind === "FAILED");
  const assemblySafeMessage =
    failedFact && failedFact.factKind === "FAILED"
      ? "Final story assembly failed."
      : null;

  const hasFinalStoryResult = Boolean(fsr);
  const hasRuntimeAuthorizedFact = Boolean(authFact);

  const status = deriveProductRuntimeStatus({
    hasFinalStoryResult,
    assemblyState,
    requiredSceneCount,
    succeededSceneCount,
    failedSceneCount,
    reconciliationCount,
    hasActiveSceneRuntime,
    hasRuntimeAuthorizedFact,
    canonicalReadinessSatisfied,
  });

  const canExecute = deriveProductCanExecute({
    status,
    hasRuntimeAuthorizedFact,
    callerMayExecute: OPERATOR_ROLES.has(String(input.callerRole ?? "")),
  });

  const providerSpend = authFact
    ? await observe("cost_usage_projection", () => reconstructAiStoryProviderSpendForPlan(executionPlanId))
    : emptyAiStoryProviderSpendProjection();

  return observe("runtime_projection_build", async () => ProductRuntimeProjectionSchema.parse({
    contractVersion: PRODUCT_RUNTIME_STATUS_CONTRACT_VERSION,
    executionPlanId,
    runtimeAuthorizationId: authFact?.runtimeAuthorizationId ?? null,
    status,
    runtimeProjectionVersion: RUNTIME_PROJECTION_VERSION,
    requiredSceneCount,
    succeededSceneCount,
    failedSceneCount,
    reconciliationCount,
    assemblyState,
    hasFinalStoryResult,
    canExecute,
    safeFailureSummary: safeFailureSummary({
      status,
      failedSceneCount,
      reconciliationCount,
      assemblySafeMessage,
    }),
    providerSpend,
    generatedSceneReviews,
    pendingReviewSceneCount,
    approvedSceneCount,
    sceneReleaseStates,
    remainingReleasePermitted,
    heldSceneCount,
    derivedAt,
  }));
}
