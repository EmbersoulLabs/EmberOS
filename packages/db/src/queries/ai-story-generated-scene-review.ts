/**
 * EXEC-04 — generated Scene media review persistence.
 * Append-style decisions per (sceneExecutionId, providerAttemptId).
 * Never deletes prior attempts or cost rows.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  AI_STORY_GENERATED_SCENE_REVIEW_CONTRACT_VERSION,
  GeneratedSceneReviewFactSchema,
  resolveAiStorySceneMaxAttempts,
  type GeneratedSceneReviewFact,
  type GeneratedSceneReviewState,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export class GeneratedSceneReviewError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | "GENERATED_SCENE_REVIEW_DENIED"
      | "GENERATED_SCENE_REVIEW_NOT_FOUND"
      | "GENERATED_SCENE_REVIEW_STATE_CONFLICT"
      | "GENERATED_SCENE_APPROVAL_BINDING_INVALID"
      | "GENERATED_SCENE_RETRY_NOT_ELIGIBLE"
      | "GENERATED_SCENE_RETRY_LIMIT_EXHAUSTED"
      | "GENERATED_SCENE_RETRY_IN_FLIGHT"
      | "GENERATED_SCENE_POST_QC_REQUIRED"
      | "GENERATED_SCENE_IDENTITY_FORGED",
    message: string,
    status = 409
  ) {
    super(message);
    this.name = "GeneratedSceneReviewError";
    this.status = status;
  }
}

export type GeneratedSceneReviewLockSnapshot = {
  readonly sceneExecutionId: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly executionPlanId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly reviews: readonly GeneratedSceneReviewFact[];
  readonly results: readonly (typeof schema.aiStorySceneResults.$inferSelect)[];
  readonly correlations: readonly (typeof schema.aiStorySceneSchedulingCorrelations.$inferSelect)[];
  readonly supersededCorrelationIds: ReadonlySet<string>;
  readonly terminalWorkerExecutionIds: ReadonlySet<string>;
  readonly providerExecutions: ReadonlyMap<
    string,
    typeof schema.providerExecutions.$inferSelect
  >;
  readonly attemptCount: number;
  readonly maxAttempts: number;
};

export type GeneratedSceneReviewConnectionMetrics = {
  connectionAcquireCount: number;
  transactionCount: number;
  secondCheckoutAttempts: number;
  maxConcurrentConnectionsObserved: number;
  connectionWaitMs: number;
  transactionDurationMs: number;
};

export function createGeneratedSceneReviewConnectionMetrics(): GeneratedSceneReviewConnectionMetrics {
  return {
    connectionAcquireCount: 0,
    transactionCount: 0,
    secondCheckoutAttempts: 0,
    maxConcurrentConnectionsObserved: 0,
    connectionWaitMs: 0,
    transactionDurationMs: 0,
  };
}

function toFact(
  row: typeof schema.aiStoryGeneratedSceneReviews.$inferSelect
): GeneratedSceneReviewFact {
  return GeneratedSceneReviewFactSchema.parse(row.fact);
}

function reviewId(sceneExecutionId: string, providerAttemptId: string): string {
  return deterministicPersistenceUuid("ai-story-generated-scene-review", {
    sceneExecutionId,
    providerAttemptId,
  });
}

export function buildPendingGeneratedSceneReviewFact(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly sceneId: string;
  readonly providerAttemptId: string;
  readonly sceneResultId: string | null;
}): GeneratedSceneReviewFact {
  return GeneratedSceneReviewFactSchema.parse({
    generatedSceneReviewId: reviewId(input.sceneExecutionId, input.providerAttemptId),
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    executionPlanId: input.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    sceneId: input.sceneId,
    providerAttemptId: input.providerAttemptId,
    sceneResultId: input.sceneResultId,
    decision: "PENDING_REVIEW",
    decidedBy: null,
    decidedAt: null,
    rationale: null,
    contractVersion: AI_STORY_GENERATED_SCENE_REVIEW_CONTRACT_VERSION,
  });
}

export async function insertPendingGeneratedSceneReviewInTransaction(
  tx: QueryDb,
  input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly sceneId: string;
    readonly providerAttemptId: string;
    readonly sceneResultId: string | null;
  }
): Promise<GeneratedSceneReviewFact> {
  const fact = buildPendingGeneratedSceneReviewFact(input);
  await tx
    .insert(schema.aiStoryGeneratedSceneReviews)
    .values({
      generatedSceneReviewId: fact.generatedSceneReviewId,
      orgId: fact.orgId,
      workspaceId: fact.workspaceId,
      campaignId: fact.campaignId,
      storyId: fact.storyId,
      executionPlanId: fact.executionPlanId,
      sceneExecutionId: fact.sceneExecutionId,
      sceneId: fact.sceneId,
      providerAttemptId: fact.providerAttemptId,
      sceneResultId: fact.sceneResultId,
      decision: fact.decision,
      decidedBy: null,
      decidedAt: null,
      rationale: null,
      contractVersion: fact.contractVersion,
      fact,
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(schema.aiStoryGeneratedSceneReviews)
    .where(
      and(
        eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, input.sceneExecutionId),
        eq(schema.aiStoryGeneratedSceneReviews.providerAttemptId, input.providerAttemptId)
      )
    )
    .limit(1);
  if (!row) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
      "Pending generated Scene review could not be persisted"
    );
  }
  return toFact(row);
}

export class GeneratedSceneReviewRepository {
  private activeTransactions = 0;

  constructor(
    private readonly db: Db = getDb(),
    private readonly connectionMetrics?: GeneratedSceneReviewConnectionMetrics
  ) {}

  async listByExecutionPlanId(
    executionPlanId: string
  ): Promise<readonly GeneratedSceneReviewFact[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryGeneratedSceneReviews)
      .where(eq(schema.aiStoryGeneratedSceneReviews.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStoryGeneratedSceneReviews.createdAt));
    return rows.map(toFact);
  }

  async listWithRetryAuthorityByExecutionPlanId(executionPlanId: string) {
    const rows = await this.db
      .select({
        reviewFact: schema.aiStoryGeneratedSceneReviews.fact,
        eligibility: schema.aiStorySceneRetryEligibilityFacts.eligibility,
        retryInputRevisionId:
          schema.aiStorySceneAttemptInputRevisions.retryInputRevisionId,
        retryAuthorizationId:
          schema.aiStorySceneRetryAuthorizations.retryAuthorizationId,
        retryAuthorizationStatus: schema.aiStorySceneRetryAuthorizations.status,
      })
      .from(schema.aiStoryGeneratedSceneReviews)
      .leftJoin(
        schema.aiStorySceneRetryEligibilityFacts,
        eq(
          schema.aiStorySceneRetryEligibilityFacts.sourceReviewId,
          schema.aiStoryGeneratedSceneReviews.generatedSceneReviewId
        )
      )
      .leftJoin(
        schema.aiStorySceneAttemptInputRevisions,
        and(
          eq(
            schema.aiStorySceneAttemptInputRevisions.sourceReviewId,
            schema.aiStoryGeneratedSceneReviews.generatedSceneReviewId
          ),
          eq(
            schema.aiStorySceneAttemptInputRevisions.revisionNumber,
            schema.aiStorySceneRetryEligibilityFacts.nextAttemptNumber
          )
        )
      )
      .leftJoin(
        schema.aiStorySceneRetryAuthorizations,
        eq(
          schema.aiStorySceneRetryAuthorizations.retryInputRevisionId,
          schema.aiStorySceneAttemptInputRevisions.retryInputRevisionId
        )
      )
      .where(
        eq(schema.aiStoryGeneratedSceneReviews.executionPlanId, executionPlanId)
      )
      .orderBy(asc(schema.aiStoryGeneratedSceneReviews.createdAt));
    return rows.map((row) => ({
      review: GeneratedSceneReviewFactSchema.parse(row.reviewFact),
      retryEligibility: row.eligibility,
      retryInputRevisionId: row.retryInputRevisionId,
      retryAuthorizationId:
        row.retryAuthorizationStatus === "AUTHORIZED"
          ? row.retryAuthorizationId
          : null,
      retryPrepared: row.retryAuthorizationStatus === "CONSUMED",
    }));
  }

  async listApprovedSceneResultIds(
    executionPlanId: string
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({
        sceneResultId: schema.aiStoryGeneratedSceneReviews.sceneResultId,
      })
      .from(schema.aiStoryGeneratedSceneReviews)
      .where(
        and(
          eq(schema.aiStoryGeneratedSceneReviews.executionPlanId, executionPlanId),
          eq(schema.aiStoryGeneratedSceneReviews.decision, "APPROVED")
        )
      );
    return rows
      .map((row) => row.sceneResultId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async lockSceneForDecision(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly expectedWorkspaceId: string;
  }): Promise<GeneratedSceneReviewLockSnapshot> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${schema.aiStoryExecutionPlans.id}
        from ${schema.aiStoryExecutionPlans}
        where ${schema.aiStoryExecutionPlans.id} = ${input.executionPlanId}
        for update
      `);
      await tx.execute(sql`
        select ${schema.aiStorySceneExecutions.id}
        from ${schema.aiStorySceneExecutions}
        where ${schema.aiStorySceneExecutions.id} = ${input.sceneExecutionId}
        for update
      `);
      return loadLockedSnapshot(tx, input);
    });
  }

  async transactDecision<T>(
    input: {
      readonly executionPlanId: string;
      readonly sceneExecutionId: string;
      readonly expectedWorkspaceId: string;
    },
    work: (tx: Tx, snapshot: GeneratedSceneReviewLockSnapshot) => Promise<T>
  ): Promise<T> {
    const waitStartedAt = performance.now();
    if (this.connectionMetrics) {
      this.connectionMetrics.connectionAcquireCount += 1;
      this.connectionMetrics.transactionCount += 1;
      if (this.connectionMetrics.connectionAcquireCount > 1) {
        this.connectionMetrics.secondCheckoutAttempts += 1;
      }
    }
    return this.db.transaction(async (tx) => {
      // Entering the callback is the first point at which Drizzle has handed
      // this request its transaction receiver, so this measures acquisition
      // wait rather than time spent merely constructing the promise.
      const transactionStartedAt = performance.now();
      this.activeTransactions += 1;
      if (this.connectionMetrics) {
        this.connectionMetrics.connectionWaitMs += transactionStartedAt - waitStartedAt;
        this.connectionMetrics.maxConcurrentConnectionsObserved = Math.max(
          this.connectionMetrics.maxConcurrentConnectionsObserved,
          this.activeTransactions
        );
      }
      try {
      // Review decisions run in a serverless max:1 pool. Bound lock/query waits
      // inside the transaction so a conflicting writer fails closed instead of
      // occupying the only request connection until the platform timeout.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '12s'`);
      await tx.execute(sql`
        select ${schema.aiStoryExecutionPlans.id}
        from ${schema.aiStoryExecutionPlans}
        where ${schema.aiStoryExecutionPlans.id} = ${input.executionPlanId}
        for update
      `);
      await tx.execute(sql`
        select ${schema.aiStorySceneExecutions.id}
        from ${schema.aiStorySceneExecutions}
        where ${schema.aiStorySceneExecutions.id} = ${input.sceneExecutionId}
        for update
      `);
      const snapshot = await loadLockedSnapshot(tx, input);
        return await work(tx, snapshot);
      } finally {
        this.activeTransactions -= 1;
        if (this.connectionMetrics) {
          this.connectionMetrics.transactionDurationMs +=
            performance.now() - transactionStartedAt;
        }
      }
    });
  }

  async writeDecisionInTransaction(
    tx: QueryDb,
    input: {
      readonly current: GeneratedSceneReviewFact;
      readonly decision: GeneratedSceneReviewState;
      readonly decidedBy: string;
      readonly decidedAt: string;
      readonly rationale?: string | null;
    }
  ): Promise<GeneratedSceneReviewFact> {
    const fact = GeneratedSceneReviewFactSchema.parse({
      ...input.current,
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      rationale: input.rationale ?? null,
    });
    const [row] = await tx
      .update(schema.aiStoryGeneratedSceneReviews)
      .set({
        decision: fact.decision,
        decidedBy: fact.decidedBy,
        decidedAt: new Date(fact.decidedAt!),
        rationale: fact.rationale,
        fact,
        updatedAt: new Date(fact.decidedAt!),
      })
      .where(
        and(
          eq(
            schema.aiStoryGeneratedSceneReviews.generatedSceneReviewId,
            fact.generatedSceneReviewId
          ),
          eq(schema.aiStoryGeneratedSceneReviews.decision, "PENDING_REVIEW")
        )
      )
      .returning();
    if (!row) {
      throw new GeneratedSceneReviewError(
        "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
        "Generated Scene review decision already resolved"
      );
    }
    return toFact(row);
  }
}

async function loadLockedSnapshot(
  tx: QueryDb,
  input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly expectedWorkspaceId: string;
  }
): Promise<GeneratedSceneReviewLockSnapshot> {
  const [scene] = await tx
    .select()
    .from(schema.aiStorySceneExecutions)
    .where(
      and(
        eq(schema.aiStorySceneExecutions.id, input.sceneExecutionId),
        eq(schema.aiStorySceneExecutions.executionPlanId, input.executionPlanId)
      )
    )
    .limit(1);
  if (!scene) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_REVIEW_NOT_FOUND",
      "Scene Execution not found",
      404
    );
  }
  if (scene.workspaceId !== input.expectedWorkspaceId) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_IDENTITY_FORGED",
      "Scene Execution does not belong to this workspace",
      404
    );
  }

  // Keep every read on the transaction receiver and issue them sequentially.
  // Concurrent promises can cause receiver/pool churn in a max:1 serverless
  // process even though the logical operation owns one transaction.
  const reviews = await tx
    .select()
    .from(schema.aiStoryGeneratedSceneReviews)
    .where(eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, input.sceneExecutionId))
    .orderBy(asc(schema.aiStoryGeneratedSceneReviews.createdAt));
  const results = await tx
    .select()
    .from(schema.aiStorySceneResults)
    .where(eq(schema.aiStorySceneResults.sceneExecutionId, input.sceneExecutionId))
    .orderBy(asc(schema.aiStorySceneResults.projectedAt));
  const correlations = await tx
    .select()
    .from(schema.aiStorySceneSchedulingCorrelations)
    .where(
      eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, input.sceneExecutionId)
    )
    .orderBy(asc(schema.aiStorySceneSchedulingCorrelations.acceptedAt));

  const supersessions = await tx
    .select({
      sourceCorrelationId:
        schema.aiStoryPreDispatchBundleSupersessions.sourceCorrelationId,
    })
    .from(schema.aiStoryPreDispatchBundleSupersessions)
    .where(
      eq(
        schema.aiStoryPreDispatchBundleSupersessions.sceneExecutionId,
        input.sceneExecutionId
      )
    );
  const attemptRows = await tx
    .select({ attemptId: schema.providerAttempts.attemptId })
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .innerJoin(
      schema.providerAttempts,
      eq(
        schema.providerAttempts.attemptId,
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId
      )
    )
    .where(
      eq(
        schema.aiStoryProviderAttemptCompiledBindings.sceneExecutionId,
        input.sceneExecutionId
      )
    );

  const executionIds = correlations.map((row) => row.providerExecutionId);
  const executions =
    executionIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.providerExecutions)
          .where(inArray(schema.providerExecutions.executionId, executionIds));
  const workerResults =
    executionIds.length === 0
      ? []
      : await tx
          .select({
            providerExecutionId:
              schema.aiStoryWorkerExecutionResults.providerExecutionId,
            workerState: schema.aiStoryWorkerExecutionResults.workerState,
            acceptanceClassification:
              schema.aiStoryWorkerExecutionResults.acceptanceClassification,
            canonicalProviderState:
              schema.aiStoryWorkerExecutionResults.canonicalProviderState,
            reconciliationRequired:
              schema.aiStoryWorkerExecutionResults.reconciliationRequired,
            result: schema.aiStoryWorkerExecutionResults.result,
          })
          .from(schema.aiStoryWorkerExecutionResults)
          .where(
            inArray(
              schema.aiStoryWorkerExecutionResults.providerExecutionId,
              executionIds
            )
          );

  return {
    sceneExecutionId: scene.id,
    sceneId: scene.sceneId,
    sceneOrder: scene.sceneOrder,
    executionPlanId: scene.executionPlanId,
    orgId: scene.orgId,
    workspaceId: scene.workspaceId,
    campaignId: scene.campaignId,
    storyId: scene.storyId,
    reviews: reviews.map(toFact),
    results,
    correlations,
    supersededCorrelationIds: new Set(
      supersessions.map((row) => row.sourceCorrelationId)
    ),
    terminalWorkerExecutionIds: new Set(
      workerResults
        .filter(
          (row) =>
            !row.reconciliationRequired &&
            (row.workerState === "TERMINAL_SUCCESS" ||
              row.workerState === "TERMINAL_FAILURE" ||
              (row.workerState === "NOT_ACCEPTED" &&
                row.acceptanceClassification === "NOT_ACCEPTED" &&
                row.canonicalProviderState === "NOT_ACCEPTED" &&
                row.result.failureClassification?.terminal === true &&
                row.result.failureClassification.reconciliationRequired === false))
        )
        .map((row) => row.providerExecutionId)
    ),
    providerExecutions: new Map(executions.map((row) => [row.executionId, row])),
    attemptCount: new Set(attemptRows.map((row) => row.attemptId)).size,
    maxAttempts: resolveAiStorySceneMaxAttempts(),
  };
}

export function snapshotHasInFlightProviderExecution(
  snapshot: GeneratedSceneReviewLockSnapshot
): boolean {
  for (const correlation of snapshot.correlations) {
    if (snapshot.supersededCorrelationIds?.has(correlation.correlationId)) continue;
    if (snapshot.terminalWorkerExecutionIds?.has(correlation.providerExecutionId)) continue;
    const execution = snapshot.providerExecutions.get(correlation.providerExecutionId);
    if (!execution) return true;
    if (execution.status !== "SUCCEEDED" && execution.status !== "TERMINAL_FAILURE") {
      return true;
    }
  }
  return false;
}

export function snapshotApprovedReview(
  snapshot: GeneratedSceneReviewLockSnapshot
): GeneratedSceneReviewFact | null {
  return snapshot.reviews.find((review) => review.decision === "APPROVED") ?? null;
}

export function snapshotLatestReview(
  snapshot: GeneratedSceneReviewLockSnapshot
): GeneratedSceneReviewFact | null {
  return snapshot.reviews[snapshot.reviews.length - 1] ?? null;
}
