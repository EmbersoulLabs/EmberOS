/**
 * EXEC-04 — generated Scene review / retry authority.
 *
 * Approve binds one attempt/output. Retry schedules a new provider attempt of
 * the same Scene using persisted frozen compilation — never mutable planning.
 */
import {
  GeneratedSceneReviewDecisionResponseSchema,
  GeneratedSceneReviewFactSchema,
  GeneratedSceneReviewReadModelSchema,
  reconstructAiStoryProviderSpend,
  redactGeneratedSceneReviewError,
  resolveAiStorySceneMaxAttempts,
  type AiStoryExecutionAuthorization,
  type GeneratedSceneReviewDecisionResponse,
  type GeneratedSceneReviewFact,
  type GeneratedSceneReviewReadModel,
  type GeneratedSceneAttemptReadModel,
  type SceneAttemptInputRevisionFact,
  type SceneRetryAuthorizationFact,
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  GeneratedSceneReviewError,
  GeneratedSceneReviewRepository,
  DifferentiatedRetryRepository,
  RuntimeAuthorizationPersistenceRepository,
  listAiStoryProviderAttemptCostRecords,
  snapshotApprovedReview,
  snapshotHasInFlightProviderExecution,
  snapshotLatestReview,
  type GeneratedSceneReviewLockSnapshot,
} from "@ceo-agent/db";
import type { ProviderRouter } from "../provider-router";
import {
  SceneSchedulingCoordinator,
  SceneSchedulingError,
} from "./scene-scheduling-coordinator";

export { GeneratedSceneReviewError };

export const GENERATED_SCENE_REVIEW_READ_SUBSTAGES = [
  "generated_scene_review.scene_execution_list",
  "generated_scene_review.provider_attempt_cost_records",
  "generated_scene_review.review_list",
  "generated_scene_review.read_model_assembly",
] as const;

export type GeneratedSceneReviewReadSubstage =
  (typeof GENERATED_SCENE_REVIEW_READ_SUBSTAGES)[number];
export type GeneratedSceneReviewPathMarker = {
  readonly marker:
    | "review_parent_entry.v1"
    | "review_projection_caller.v1"
    | "review_load_plan_read_model_entry.v1"
    | "review_first_repository_call.v1";
  readonly sourceModule: string;
  readonly sourceFunction: string;
  readonly traceVersion: "review-helper-entry-path.v1";
};
export type GeneratedSceneReviewPathMarkerSink = (
  marker: GeneratedSceneReviewPathMarker
) => void;
export type GeneratedSceneReviewReadSubstageTiming = {
  readonly stage: GeneratedSceneReviewReadSubstage;
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: number;
  readonly roundTripCount: number;
  readonly rowCount: number | null;
};

export class GeneratedSceneReviewReadSubstageRecorder {
  private active: { stage: GeneratedSceneReviewReadSubstage; startedAt: number } | null = null;
  private readonly rows = new Map<GeneratedSceneReviewReadSubstage, GeneratedSceneReviewReadSubstageTiming>(
    GENERATED_SCENE_REVIEW_READ_SUBSTAGES.map((stage) => [stage, {
      stage,
      status: "NOT_REACHED",
      durationMs: null,
      queryCount: stage === "generated_scene_review.read_model_assembly" ? 0 : 1,
      roundTripCount: stage === "generated_scene_review.read_model_assembly" ? 0 : 1,
      rowCount: null,
    }])
  );

  async run<T>(
    stage: GeneratedSceneReviewReadSubstage,
    operation: () => Promise<T>,
    rowCount: (value: T) => number | null
  ): Promise<T> {
    const startedAt = performance.now();
    this.active = { stage, startedAt };
    try {
      const value = await operation();
      this.rows.set(stage, {
        ...this.rows.get(stage)!,
        status: "COMPLETED",
        durationMs: Math.round(performance.now() - startedAt),
        rowCount: rowCount(value),
      });
      this.active = null;
      return value;
    } catch (error) {
      this.rows.set(stage, {
        ...this.rows.get(stage)!,
        status: "FAILED",
        durationMs: Math.round(performance.now() - startedAt),
      });
      this.active = null;
      throw error;
    }
  }

  markTimedOut(): void {
    if (!this.active) return;
    const { stage, startedAt } = this.active;
    this.rows.set(stage, {
      ...this.rows.get(stage)!,
      status: "TIMED_OUT",
      durationMs: Math.round(performance.now() - startedAt),
    });
    this.active = null;
  }

  snapshot(): readonly GeneratedSceneReviewReadSubstageTiming[] {
    return GENERATED_SCENE_REVIEW_READ_SUBSTAGES.map((stage) => this.rows.get(stage)!);
  }
}

export type GeneratedSceneReviewReadTiming = {
  readonly executionPlanId: string;
  readonly sceneExecutionListMs: number;
  readonly providerAttemptCostRecordsMs: number;
  readonly generatedSceneReviewListMs: number;
  readonly readModelAssemblyMs: number;
  readonly totalLoadPlanReadModelMs: number;
  readonly sceneExecutionRowCount: number;
  readonly providerAttemptCostRecordCount: number;
  readonly generatedSceneReviewRowCount: number;
  readonly sceneExecutionQueryCount: 1;
  readonly sceneExecutionRoundTripCount: 1;
  readonly providerAttemptCostQueryCount: 1;
  readonly providerAttemptCostRoundTripCount: 1;
  readonly generatedSceneReviewQueryCount: 1;
  readonly generatedSceneReviewRoundTripCount: 1;
  readonly connectionAcquireCount: 1;
  readonly secondCheckoutAttempts: 0;
};

export class GeneratedSceneReviewService {
  constructor(
    private readonly dependencies: {
      readonly reviewRepository?: GeneratedSceneReviewRepository;
      readonly persistenceRepository?: AiStorySceneExecutionPersistenceRepository;
      readonly authorizationRepository?: RuntimeAuthorizationPersistenceRepository;
      readonly schedulingCoordinator?: SceneSchedulingCoordinator;
      readonly router?: ProviderRouter;
      readonly now?: () => Date;
      readonly onLoadPlanReadModelTiming?: (timing: GeneratedSceneReviewReadTiming) => void;
      readonly providerAttemptCostRecordLoader?: typeof listAiStoryProviderAttemptCostRecords;
      readonly readSubstageRecorder?: GeneratedSceneReviewReadSubstageRecorder;
      readonly differentiatedRetryRepository?: {
        getAuthorization(id: string): Promise<SceneRetryAuthorizationFact | null>;
        getRevision(id: string): Promise<SceneAttemptInputRevisionFact | null>;
        markAuthorizationConsumed(id: string): Promise<SceneRetryAuthorizationFact>;
      };
    } = {}
  ) {}

  private get reviewRepo() {
    return this.dependencies.reviewRepository ?? new GeneratedSceneReviewRepository();
  }

  private nowIso(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString();
  }

  private get schedulingCoordinator() {
    if (this.dependencies.schedulingCoordinator) {
      return this.dependencies.schedulingCoordinator;
    }
    if (!this.dependencies.router) {
      throw new GeneratedSceneReviewError(
        "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
        "Scene retry scheduler is not configured"
      );
    }
    return new SceneSchedulingCoordinator({ router: this.dependencies.router });
  }

  async approve(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly attemptId: string;
    readonly actorUserId: string;
    readonly workspaceId: string;
    readonly executionAuthorization: AiStoryExecutionAuthorization;
  }): Promise<GeneratedSceneReviewDecisionResponse> {
    void input.executionAuthorization;
    try {
      const decision = await this.reviewRepo.transactDecision(
        {
          executionPlanId: input.executionPlanId,
          sceneExecutionId: input.sceneExecutionId,
          expectedWorkspaceId: input.workspaceId,
        },
        async (tx, snapshot) => {
          assertSameScene(snapshot, input.sceneExecutionId);
          const approved = snapshotApprovedReview(snapshot);
          if (approved) {
            if (approved.providerAttemptId === input.attemptId) {
              return {
                review: approved,
                scene: buildDecisionSceneReadModel(snapshot, approved),
              };
            }
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
              "Scene already has an approved generated output"
            );
          }
          if (snapshotHasInFlightProviderExecution(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_IN_FLIGHT",
              "Cannot approve while a provider attempt is running"
            );
          }
          const target = snapshot.reviews.find(
            (row) => row.providerAttemptId === input.attemptId
          );
          if (!target) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_APPROVAL_BINDING_INVALID",
              "Attempt is not a reviewable generated Scene output",
              404
            );
          }
          const result = snapshot.results.find(
            (row) => row.providerAttemptId === input.attemptId
          );
          if (!result || result.status !== "SUCCEEDED") {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_APPROVAL_BINDING_INVALID",
              "Only a succeeded generated output can be approved"
            );
          }
          if (
            target.sceneExecutionId !== snapshot.sceneExecutionId ||
            target.executionPlanId !== snapshot.executionPlanId ||
            target.workspaceId !== snapshot.workspaceId ||
            target.sceneId !== snapshot.sceneId ||
            target.sceneResultId !== result.sceneResultId ||
            result.sceneExecutionId !== snapshot.sceneExecutionId ||
            result.executionPlanId !== snapshot.executionPlanId ||
            result.workspaceId !== snapshot.workspaceId ||
            result.sceneId !== snapshot.sceneId
          ) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_APPROVAL_BINDING_INVALID",
              "Generated Scene result does not match the review authority"
            );
          }
          if (target.decision !== "PENDING_REVIEW") {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
              "Generated Scene output is not pending review"
            );
          }
          const review = await this.reviewRepo.writeDecisionInTransaction(tx, {
            current: {
              ...target,
              sceneResultId: result.sceneResultId,
            },
            decision: "APPROVED",
            decidedBy: input.actorUserId,
            decidedAt: this.nowIso(),
          });
          return {
            review,
            scene: buildDecisionSceneReadModel(snapshot, review),
          };
        }
      );
      return GeneratedSceneReviewDecisionResponseSchema.parse({
        review: decision.review,
        scene: decision.scene,
        retryEnqueued: false,
        newAttemptNumber: null,
      });
    } catch (error) {
      throw redactReviewError(error);
    }
  }

  async reject(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly actorUserId: string;
    readonly workspaceId: string;
    readonly executionAuthorization: AiStoryExecutionAuthorization;
  }): Promise<GeneratedSceneReviewDecisionResponse> {
    void input.executionAuthorization;
    try {
      const review = await this.reviewRepo.transactDecision(
        {
          executionPlanId: input.executionPlanId,
          sceneExecutionId: input.sceneExecutionId,
          expectedWorkspaceId: input.workspaceId,
        },
        async (tx, snapshot) => {
          assertSameScene(snapshot, input.sceneExecutionId);
          if (snapshotApprovedReview(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
              "Approved generated output cannot be rejected"
            );
          }
          if (snapshotHasInFlightProviderExecution(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_IN_FLIGHT",
              "Cannot reject while a provider attempt is running"
            );
          }
          const latest = snapshotLatestReview(snapshot);
          if (!latest || latest.decision !== "PENDING_REVIEW") {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
              "No reviewable generated Scene output to reject"
            );
          }
          return this.reviewRepo.writeDecisionInTransaction(tx, {
            current: latest,
            decision: "REJECTED_TERMINAL",
            decidedBy: input.actorUserId,
            decidedAt: this.nowIso(),
          });
        }
      );
      const scene = await this.loadSceneReadModel(
        input.executionPlanId,
        input.sceneExecutionId
      );
      return GeneratedSceneReviewDecisionResponseSchema.parse({
        review,
        scene,
        retryEnqueued: false,
        newAttemptNumber: null,
      });
    } catch (error) {
      throw redactReviewError(error);
    }
  }

  async retry(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly actorUserId: string;
    readonly workspaceId: string;
    readonly executionAuthorization: AiStoryExecutionAuthorization;
    readonly retryAuthorizationId?: string;
  }): Promise<GeneratedSceneReviewDecisionResponse> {
    try {
      if (!input.retryAuthorizationId) {
        throw new GeneratedSceneReviewError(
          "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
          "A human retry authorization is required"
        );
      }
      const differentiated =
        this.dependencies.differentiatedRetryRepository ??
        new DifferentiatedRetryRepository();
      const authorization = await differentiated.getAuthorization(input.retryAuthorizationId);
      if (!authorization || authorization.sceneExecutionId !== input.sceneExecutionId || authorization.executionPlanId !== input.executionPlanId || authorization.workspaceId !== input.workspaceId) {
        throw new GeneratedSceneReviewError("GENERATED_SCENE_RETRY_NOT_ELIGIBLE", "Retry authorization does not match this Scene");
      }
      const revision = await differentiated.getRevision(authorization.retryInputRevisionId);
      if (!revision || revision.canonicalFingerprint !== authorization.retryInputFingerprint) {
        throw new GeneratedSceneReviewError("GENERATED_SCENE_RETRY_NOT_ELIGIBLE", "Retry input revision authority is missing");
      }
      const retryGeneration = authorization.authorizedAttemptNumber;
      const review = await this.reviewRepo.transactDecision(
        {
          executionPlanId: input.executionPlanId,
          sceneExecutionId: input.sceneExecutionId,
          expectedWorkspaceId: input.workspaceId,
        },
        async (tx, snapshot) => {
          assertSameScene(snapshot, input.sceneExecutionId);
          if (snapshotApprovedReview(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
              "Approved generated output cannot be retried"
            );
          }
          const latest = snapshotLatestReview(snapshot);
          if (snapshotHasInFlightProviderExecution(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_IN_FLIGHT",
              "A provider attempt is already running for this Scene"
            );
          }
          if (!latest || latest.decision !== "REJECTED" || latest.generatedSceneReviewId !== authorization.sourceReviewId || latest.providerAttemptId !== authorization.sourceAttemptId) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
              "The exact rejected generated output is required"
            );
          }
          const maxAttempts = snapshot.maxAttempts;
          if (snapshot.attemptCount >= maxAttempts) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_LIMIT_EXHAUSTED",
              "Scene retry limit reached"
            );
          }
          if (snapshot.attemptCount + 1 !== retryGeneration) throw new GeneratedSceneReviewError("GENERATED_SCENE_RETRY_NOT_ELIGIBLE", "Retry authorization attempt number is stale");
          return latest;
        }
      );

      const authRepo =
        this.dependencies.authorizationRepository ??
        new RuntimeAuthorizationPersistenceRepository();
      const fact = await authRepo.getByExecutionPlanId(input.executionPlanId);
      if (!fact) {
        throw new GeneratedSceneReviewError(
          "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
          "Runtime authorization is required before retry"
        );
      }

      const persistence =
        this.dependencies.persistenceRepository ??
        new AiStorySceneExecutionPersistenceRepository();
      const compilation = await persistence.getByExecutionPlanId(input.executionPlanId);
      if (!compilation) {
        throw new GeneratedSceneReviewError(
          "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
          "Frozen Scene compilation is missing"
        );
      }

      try {
        await this.schedulingCoordinator.scheduleAuthorizedScene({
          executionPlanId: input.executionPlanId,
          sceneExecutionId: input.sceneExecutionId,
          runtimeAuthorizationId: fact.runtimeAuthorizationId,
          executionAuthorization: input.executionAuthorization,
          actorUserId: input.actorUserId,
          retryGeneration,
          retryInputRevision: revision,
        });
        await differentiated.markAuthorizationConsumed(authorization.retryAuthorizationId);
      } catch (error) {
        if (error instanceof SceneSchedulingError) {
          throw new GeneratedSceneReviewError(
            "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
            redactGeneratedSceneReviewError(error.message)
          );
        }
        throw error;
      }

      const scene = await this.loadSceneReadModel(
        input.executionPlanId,
        input.sceneExecutionId
      );
      return GeneratedSceneReviewDecisionResponseSchema.parse({
        review,
        scene,
        retryEnqueued: true,
        newAttemptNumber: retryGeneration,
      });
    } catch (error) {
      throw redactReviewError(error);
    }
  }

  async loadPlanReadModel(
    executionPlanId: string,
    requestSubstageRecorder?: GeneratedSceneReviewReadSubstageRecorder,
    onPathMarker?: GeneratedSceneReviewPathMarkerSink
  ): Promise<readonly GeneratedSceneReviewReadModel[]> {
    onPathMarker?.({
      marker: "review_load_plan_read_model_entry.v1",
      sourceModule: "packages/agents/src/ai-story/generated-scene-review-service.ts",
      sourceFunction: "GeneratedSceneReviewService.loadPlanReadModel",
      traceVersion: "review-helper-entry-path.v1",
    });
    const totalStartedAt = performance.now();
    const persistence =
      this.dependencies.persistenceRepository ??
      new AiStorySceneExecutionPersistenceRepository();
    const substageRecorder =
      requestSubstageRecorder ??
      this.dependencies.readSubstageRecorder ??
      new GeneratedSceneReviewReadSubstageRecorder();
    const sceneExecutionStartedAt = performance.now();
    onPathMarker?.({
      marker: "review_first_repository_call.v1",
      sourceModule: "packages/agents/src/ai-story/generated-scene-review-service.ts",
      sourceFunction: "GeneratedSceneReviewService.loadPlanReadModel",
      traceVersion: "review-helper-entry-path.v1",
    });
    const intents = await substageRecorder.run(
      "generated_scene_review.scene_execution_list",
      () => persistence.listIntentsByExecutionPlanId(executionPlanId),
      (rows) => rows.length
    );
    const sceneExecutionListMs = performance.now() - sceneExecutionStartedAt;

    const providerAttemptStartedAt = performance.now();
    const costRecords = await substageRecorder.run(
      "generated_scene_review.provider_attempt_cost_records",
      () => (this.dependencies.providerAttemptCostRecordLoader ??
        listAiStoryProviderAttemptCostRecords)(executionPlanId),
      (rows) => rows.length
    );
    const providerAttemptCostRecordsMs = performance.now() - providerAttemptStartedAt;
    const reconstructed = reconstructAiStoryProviderSpend(
      costRecords
    );

    const reviewStartedAt = performance.now();
    const reviewRepository = this.reviewRepo;
    const reviewAuthorityRows = await substageRecorder.run(
      "generated_scene_review.review_list",
      () =>
        typeof reviewRepository.listWithRetryAuthorityByExecutionPlanId ===
        "function"
          ? reviewRepository.listWithRetryAuthorityByExecutionPlanId(
              executionPlanId
            )
          : reviewRepository.listByExecutionPlanId(executionPlanId).then((rows) =>
              rows.map((review) => ({
                review,
                retryEligibility: null,
                retryInputRevisionId: null,
                retryAuthorizationId: null,
              }))
            ),
      (rows) => rows.length
    );
    const reviews = reviewAuthorityRows.map((row) => row.review);
    const generatedSceneReviewListMs = performance.now() - reviewStartedAt;

    const assemblyStartedAt = performance.now();
    const models = await substageRecorder.run(
      "generated_scene_review.read_model_assembly",
      async () => {
        const snapshotByScene = groupReviews(reviews);
        const retryAuthorityByReview = new Map(
          reviewAuthorityRows.map((row) => [row.review.generatedSceneReviewId, row])
        );
        const maxAttempts = resolveAiStorySceneMaxAttempts();
        const orderedIntents = intents
          .slice()
          .sort((a, b) => a.identity.sceneOrder - b.identity.sceneOrder);
        const assembled: GeneratedSceneReviewReadModel[] = [];
        for (const intent of orderedIntents) {
          assembled.push(await this.buildReadModel({
            executionPlanId,
            sceneExecutionId: intent.identity.sceneExecutionId,
            sceneId: intent.identity.sceneId,
            sceneOrder: intent.identity.sceneOrder,
            reviews: snapshotByScene.get(intent.identity.sceneExecutionId) ?? [],
            retryAuthorityByReview,
            spendAttempts: reconstructed.attempts.filter(
              (attempt) => attempt.sceneExecutionId === intent.identity.sceneExecutionId
            ),
            sceneKnownCost:
              reconstructed.projection.scenes.find(
                (row) => row.sceneExecutionId === intent.identity.sceneExecutionId
              )?.knownAmount ?? null,
            maxAttempts,
          }));
        }
        return assembled;
      },
      (rows) => rows.length
    );
    const readModelAssemblyMs = performance.now() - assemblyStartedAt;
    const timing: GeneratedSceneReviewReadTiming = {
      executionPlanId,
      sceneExecutionListMs,
      providerAttemptCostRecordsMs,
      generatedSceneReviewListMs,
      readModelAssemblyMs,
      totalLoadPlanReadModelMs: performance.now() - totalStartedAt,
      sceneExecutionRowCount: intents.length,
      providerAttemptCostRecordCount: costRecords.length,
      generatedSceneReviewRowCount: reviews.length,
      sceneExecutionQueryCount: 1,
      sceneExecutionRoundTripCount: 1,
      providerAttemptCostQueryCount: 1,
      providerAttemptCostRoundTripCount: 1,
      generatedSceneReviewQueryCount: 1,
      generatedSceneReviewRoundTripCount: 1,
      connectionAcquireCount: 1,
      secondCheckoutAttempts: 0,
    };
    this.dependencies.onLoadPlanReadModelTiming?.(timing);
    console.info(JSON.stringify({
      event: "ai_story_generated_scene_review_read_timing",
      ...timing,
    }));
    return models;
  }

  private async loadSceneReadModel(
    executionPlanId: string,
    sceneExecutionId: string
  ): Promise<GeneratedSceneReviewReadModel> {
    const models = await this.loadPlanReadModel(executionPlanId);
    const scene = models.find((row) => row.sceneExecutionId === sceneExecutionId);
    if (!scene) {
      throw new GeneratedSceneReviewError(
        "GENERATED_SCENE_REVIEW_NOT_FOUND",
        "Scene Execution not found",
        404
      );
    }
    return scene;
  }

  private async buildReadModel(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly sceneId: string;
    readonly sceneOrder: number;
    readonly reviews: readonly GeneratedSceneReviewFact[];
    readonly retryAuthorityByReview: ReadonlyMap<
      string,
      {
        readonly retryEligibility: string | null;
        readonly retryInputRevisionId: string | null;
        readonly retryAuthorizationId: string | null;
      }
    >;
    readonly spendAttempts: readonly import("@ceo-agent/shared").AiStoryProviderAttemptCostEvidence[];
    readonly sceneKnownCost: number | null;
    readonly maxAttempts: number;
  }): Promise<GeneratedSceneReviewReadModel> {
    const attempts: GeneratedSceneAttemptReadModel[] = input.spendAttempts
      .slice()
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => {
        const review = input.reviews.find((row) => row.providerAttemptId === attempt.attemptId);
        return {
          attemptId: attempt.attemptId,
          attemptNumber: attempt.attemptNumber,
          providerExecutionId: null,
          status: attempt.outcome,
          outcome:
            attempt.outcome === "success"
              ? "success"
              : attempt.outcome === "failure"
                ? "failure"
                : "unknown",
          sceneResultId: review?.sceneResultId ?? null,
          reviewState: review?.decision ?? null,
          failureClass: attempt.failureClass,
          knownCostAmount: attempt.amount,
          costSource: attempt.costSource,
          createdAt: attempt.createdAt,
          completedAt: attempt.completedAt,
        };
      });
    const approved = input.reviews.find((row) => row.decision === "APPROVED") ?? null;
    const latestReview = input.reviews[input.reviews.length - 1] ?? null;
    const retryAuthority = latestReview
      ? input.retryAuthorityByReview.get(latestReview.generatedSceneReviewId)
      : null;
    const latestAttempt = attempts[attempts.length - 1] ?? null;
    const running = latestAttempt?.outcome === "unknown" && latestReview?.decision === "RETRY_REQUESTED";
    const reviewState = approved
      ? "APPROVED"
      : latestReview?.decision ?? "PENDING_REVIEW";
    const reviewAvailable = Boolean(
      latestReview?.sceneResultId && latestReview.providerAttemptId
    );
    const attemptCount = Math.max(attempts.length, input.reviews.length);
    return GeneratedSceneReviewReadModelSchema.parse({
      sceneExecutionId: input.sceneExecutionId,
      sceneId: input.sceneId,
      sceneOrder: input.sceneOrder,
      reviewState: running && reviewState === "RETRY_REQUESTED" ? "RETRY_REQUESTED" : reviewState,
      runtimeState: approved
        ? "APPROVED"
        : running
          ? "RUNNING"
          : retryAuthority?.retryAuthorizationId
            ? "RETRY_AUTHORIZED"
          : latestReview?.decision === "REJECTED"
            ? "REJECTED"
          : reviewAvailable
            ? "PENDING_REVIEW"
            : "QUEUED",
      reviewAvailable,
      recoveryMode: null,
      approvedAttemptId: approved?.providerAttemptId ?? null,
      approvedSceneResultId: approved?.sceneResultId ?? null,
      latestAttemptId: latestAttempt?.attemptId ?? latestReview?.providerAttemptId ?? null,
      latestReviewId: latestReview?.generatedSceneReviewId ?? null,
      retryEligibility:
        retryAuthority?.retryEligibility === "ELIGIBLE" ||
        retryAuthority?.retryEligibility === "INELIGIBLE_MAX_ATTEMPTS" ||
        retryAuthority?.retryEligibility === "INELIGIBLE_TERMINAL_POLICY" ||
        retryAuthority?.retryEligibility === "INELIGIBLE_AUTHORITY_CONFLICT"
          ? retryAuthority.retryEligibility
          : null,
      retryInputRevisionId: retryAuthority?.retryInputRevisionId ?? null,
      retryAuthorizationId: retryAuthority?.retryAuthorizationId ?? null,
      latestAttemptNumber: latestAttempt?.attemptNumber ?? (attemptCount > 0 ? attemptCount : null),
      latestAttemptStatus: latestAttempt?.status ?? (running ? "running" : null),
      attemptCount,
      retryRemaining: Math.max(0, input.maxAttempts - attemptCount),
      maxAttempts: input.maxAttempts,
      latestAttemptKnownCost: latestAttempt?.knownCostAmount ?? null,
      sceneKnownCost: input.sceneKnownCost,
      currency: "USD",
      running,
      attempts,
    });
  }
}

function buildDecisionSceneReadModel(
  snapshot: GeneratedSceneReviewLockSnapshot,
  decision: GeneratedSceneReviewFact
): GeneratedSceneReviewReadModel {
  const reviews = snapshot.reviews.map((review) =>
    review.generatedSceneReviewId === decision.generatedSceneReviewId ? decision : review
  );
  const attempts: GeneratedSceneAttemptReadModel[] = reviews.map((review, index) => {
    const result = snapshot.results.find(
      (candidate) => candidate.providerAttemptId === review.providerAttemptId
    );
    const correlation = snapshot.correlations.find((candidate) => {
      const execution = snapshot.providerExecutions.get(candidate.providerExecutionId);
      return execution?.acceptedAttemptId === review.providerAttemptId;
    });
    const execution = correlation
      ? snapshot.providerExecutions.get(correlation.providerExecutionId)
      : undefined;
    const succeeded = result?.status === "SUCCEEDED";
    return {
      attemptId: review.providerAttemptId,
      attemptNumber: index + 1,
      providerExecutionId: correlation?.providerExecutionId ?? null,
      status: result?.status ?? execution?.status ?? "UNKNOWN",
      outcome: succeeded ? "success" : execution?.status === "TERMINAL_FAILURE" ? "failure" : "unknown",
      sceneResultId: result?.sceneResultId ?? review.sceneResultId,
      reviewState: review.decision,
      failureClass: null,
      knownCostAmount: null,
      costSource: null,
      createdAt: correlation?.scheduledAt.toISOString() ?? null,
      completedAt: result?.projectedAt.toISOString() ?? execution?.completedAt?.toISOString() ?? null,
    };
  });
  const latest = attempts[attempts.length - 1] ?? null;
  return GeneratedSceneReviewReadModelSchema.parse({
    sceneExecutionId: snapshot.sceneExecutionId,
    sceneId: snapshot.sceneId,
    sceneOrder: snapshot.sceneOrder,
    reviewState: decision.decision,
    runtimeState: decision.decision === "APPROVED" ? "APPROVED" : decision.decision === "REJECTED" ? "REJECTED" : "PENDING_REVIEW",
    reviewAvailable: Boolean(decision.sceneResultId && latest),
    recoveryMode: null,
    approvedAttemptId: decision.decision === "APPROVED" ? decision.providerAttemptId : null,
    approvedSceneResultId: decision.decision === "APPROVED" ? decision.sceneResultId : null,
    latestAttemptId: latest?.attemptId ?? null,
    latestReviewId: decision.generatedSceneReviewId,
    retryEligibility: null,
    retryInputRevisionId: null,
    retryAuthorizationId: null,
    latestAttemptNumber: latest?.attemptNumber ?? null,
    latestAttemptStatus: latest?.status ?? null,
    attemptCount: Math.max(snapshot.attemptCount, attempts.length),
    retryRemaining: Math.max(0, snapshot.maxAttempts - Math.max(snapshot.attemptCount, attempts.length)),
    maxAttempts: snapshot.maxAttempts,
    latestAttemptKnownCost: null,
    sceneKnownCost: null,
    currency: "USD",
    running: false,
    attempts,
    generatedMedia: null,
  });
}

function assertSameScene(
  snapshot: GeneratedSceneReviewLockSnapshot,
  sceneExecutionId: string
): void {
  if (snapshot.sceneExecutionId !== sceneExecutionId) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_IDENTITY_FORGED",
      "Scene identity does not match persisted Scene Execution",
      404
    );
  }
}

function groupReviews(
  reviews: readonly GeneratedSceneReviewFact[]
): Map<string, GeneratedSceneReviewFact[]> {
  const map = new Map<string, GeneratedSceneReviewFact[]>();
  for (const review of reviews) {
    const list = map.get(review.sceneExecutionId) ?? [];
    list.push(review);
    map.set(review.sceneExecutionId, list);
  }
  return map;
}

function redactReviewError(error: unknown): never {
  if (error instanceof GeneratedSceneReviewError) {
    throw new GeneratedSceneReviewError(
      error.code,
      redactGeneratedSceneReviewError(error.message),
      error.status
    );
  }
  if (error instanceof Error) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
      redactGeneratedSceneReviewError(error.message)
    );
  }
  throw new GeneratedSceneReviewError(
    "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
    "Scene review request failed."
  );
}

export { GeneratedSceneReviewFactSchema };
