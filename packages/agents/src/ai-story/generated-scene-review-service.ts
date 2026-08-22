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
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  GeneratedSceneReviewError,
  GeneratedSceneReviewRepository,
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

export class GeneratedSceneReviewService {
  constructor(
    private readonly dependencies: {
      readonly reviewRepository?: GeneratedSceneReviewRepository;
      readonly persistenceRepository?: AiStorySceneExecutionPersistenceRepository;
      readonly authorizationRepository?: RuntimeAuthorizationPersistenceRepository;
      readonly schedulingCoordinator?: SceneSchedulingCoordinator;
      readonly router?: ProviderRouter;
      readonly now?: () => Date;
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
  }): Promise<GeneratedSceneReviewDecisionResponse> {
    try {
      let retryGeneration = 0;
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
          if (latest?.decision === "REJECTED_TERMINAL") {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
              "Rejected Scene cannot be retried"
            );
          }
          if (snapshotHasInFlightProviderExecution(snapshot)) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_IN_FLIGHT",
              "A provider attempt is already running for this Scene"
            );
          }
          if (
            !latest ||
            (latest.decision !== "PENDING_REVIEW" &&
              latest.decision !== "RETRY_REQUESTED")
          ) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
              "No reviewable or failed generated Scene output to retry"
            );
          }
          const maxAttempts = snapshot.maxAttempts;
          if (snapshot.attemptCount >= maxAttempts) {
            throw new GeneratedSceneReviewError(
              "GENERATED_SCENE_RETRY_LIMIT_EXHAUSTED",
              "Scene retry limit reached"
            );
          }
          retryGeneration = snapshot.attemptCount + 1;
          if (latest.decision === "RETRY_REQUESTED") {
            return latest;
          }
          return this.reviewRepo.writeDecisionInTransaction(tx, {
            current: latest,
            decision: "RETRY_REQUESTED",
            decidedBy: input.actorUserId,
            decidedAt: this.nowIso(),
          });
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
        });
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
    executionPlanId: string
  ): Promise<readonly GeneratedSceneReviewReadModel[]> {
    const persistence =
      this.dependencies.persistenceRepository ??
      new AiStorySceneExecutionPersistenceRepository();
    const compilation = await persistence.getByExecutionPlanId(executionPlanId);
    const reconstructed = reconstructAiStoryProviderSpend(
      await listAiStoryProviderAttemptCostRecords(executionPlanId)
    );
    const reviews = await this.reviewRepo.listByExecutionPlanId(executionPlanId);
    const snapshotByScene = groupReviews(reviews);
    const maxAttempts = resolveAiStorySceneMaxAttempts();
    const intents = (compilation?.intents ?? [])
      .slice()
      .sort((a, b) => a.identity.sceneOrder - b.identity.sceneOrder);

    const models: GeneratedSceneReviewReadModel[] = [];
    for (const intent of intents) {
      models.push(
        await this.buildReadModel({
          executionPlanId,
          sceneExecutionId: intent.identity.sceneExecutionId,
          sceneId: intent.identity.sceneId,
          sceneOrder: intent.identity.sceneOrder,
          reviews: snapshotByScene.get(intent.identity.sceneExecutionId) ?? [],
          spendAttempts: reconstructed.attempts.filter(
            (attempt) => attempt.sceneExecutionId === intent.identity.sceneExecutionId
          ),
          sceneKnownCost:
            reconstructed.projection.scenes.find(
              (row) => row.sceneExecutionId === intent.identity.sceneExecutionId
            )?.knownAmount ?? null,
          maxAttempts,
        })
      );
    }
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
    const latestAttempt = attempts[attempts.length - 1] ?? null;
    const running = latestAttempt?.outcome === "unknown" && latestReview?.decision === "RETRY_REQUESTED";
    const reviewState = approved
      ? "APPROVED"
      : latestReview?.decision ?? "PENDING_REVIEW";
    const attemptCount = Math.max(attempts.length, input.reviews.length);
    return GeneratedSceneReviewReadModelSchema.parse({
      sceneExecutionId: input.sceneExecutionId,
      sceneId: input.sceneId,
      sceneOrder: input.sceneOrder,
      reviewState: running && reviewState === "RETRY_REQUESTED" ? "RETRY_REQUESTED" : reviewState,
      approvedAttemptId: approved?.providerAttemptId ?? null,
      approvedSceneResultId: approved?.sceneResultId ?? null,
      latestAttemptId: latestAttempt?.attemptId ?? latestReview?.providerAttemptId ?? null,
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
    approvedAttemptId: decision.decision === "APPROVED" ? decision.providerAttemptId : null,
    approvedSceneResultId: decision.decision === "APPROVED" ? decision.sceneResultId : null,
    latestAttemptId: latest?.attemptId ?? null,
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
