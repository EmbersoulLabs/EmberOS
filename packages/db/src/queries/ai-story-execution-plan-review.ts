/**
 * Sprint 3 Phase 2B PR 2B.1 — Execution Plan Human Review repository.
 *
 * Append-only review facts subordinate to the Execution Plan Aggregate Root.
 * Never mutates plans, scenes, snapshots, or QC rows. Never unlocks execution
 * or creates Queue / Outbox / Provider work.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  AI_STORY_EXECUTION_CONTRACT_VERSION,
  LogicalReviewProjectionSchema,
  ReviewOpenedFactSchema,
  SceneIntentReviewDecisionSchema,
  StoryReviewDecisionSchema,
  type HumanReviewDecision,
  type LogicalReviewProjection,
  type LogicalReviewStatus,
  type ReviewOpenedFact,
  type SceneIntentReviewDecision,
  type StoryReviewDecision,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";
import {
  assertExecutionPlanOwnershipChain,
  assertExecutionPlanOwnershipChainInSingleQuery,
  assertPlanOwnershipColumnsMatch,
  assertSceneMatchesPlan,
  assertSnapshotMatchesWorkspace,
  OwnershipIntegrityViolationError,
  planOwnershipFromRow,
} from "./ai-story-ownership";
import { ROLE_HIERARCHY } from "./tenant";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export const EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION =
  "execution-plan-review-post-story-fact-trace.v1" as const;
export const EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES = [
  "execution_plan_review.plan_read",
  "execution_plan_review.ownership_chain_read",
  "execution_plan_review.opened_fact_read",
  "execution_plan_review.scene_review_fact_read",
  "execution_plan_review.story_review_fact_read",
  "execution_plan_review.required_scene_read",
  "execution_plan_review.projection_assembly",
] as const;
export type ExecutionPlanReviewProjectionSubstage =
  (typeof EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES)[number];
export type ExecutionPlanReviewProjectionSubstageTiming = {
  readonly stage: ExecutionPlanReviewProjectionSubstage;
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: number;
  readonly roundTripCount: number;
  readonly rowCount: number | null;
  readonly ownershipQueryPhaseTiming?: ExecutionPlanOwnershipQueryPhaseTiming;
};

export type ExecutionPlanOwnershipQueryPhaseTiming = {
  readonly remainingRuntimeBudgetMsAtEntry: number | null;
  readonly connectionAcquireMs: number | null;
  readonly poolWaitMs: number | null;
  readonly queryDispatchMs: number | null;
  readonly dbExecutionMs: number | null;
  readonly networkReturnMs: number | null;
  readonly dbExecutionAndNetworkMs: number | null;
  readonly rowDecodeMs: number | null;
  readonly totalWallMs: number | null;
};

const executionPlanReviewQueryCounts: Record<ExecutionPlanReviewProjectionSubstage, number> = {
  "execution_plan_review.plan_read": 1,
  "execution_plan_review.ownership_chain_read": 1,
  "execution_plan_review.opened_fact_read": 1,
  "execution_plan_review.scene_review_fact_read": 1,
  "execution_plan_review.story_review_fact_read": 1,
  "execution_plan_review.required_scene_read": 1,
  "execution_plan_review.projection_assembly": 0,
};

export class ExecutionPlanReviewProjectionTimingRecorder {
  private active: {
    stage: ExecutionPlanReviewProjectionSubstage;
    startedAt: number;
    dispatchedAt: number | null;
    remainingRuntimeBudgetMsAtEntry: number | null;
  } | null = null;
  constructor(
    private readonly remainingRuntimeBudgetMs?: () => number
  ) {}
  private readonly rows = new Map<ExecutionPlanReviewProjectionSubstage, ExecutionPlanReviewProjectionSubstageTiming>(
    EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES.map((stage) => [stage, {
      stage,
      status: "NOT_REACHED",
      durationMs: null,
      queryCount: executionPlanReviewQueryCounts[stage],
      roundTripCount: executionPlanReviewQueryCounts[stage],
      rowCount: null,
    }])
  );
  async run<T>(stage: ExecutionPlanReviewProjectionSubstage, operation: () => Promise<T>, rowCount: (value: T) => number | null): Promise<T> {
    const startedAt = performance.now();
    const isOwnershipQuery = stage === "execution_plan_review.ownership_chain_read";
    const remainingRuntimeBudgetMsAtEntry = isOwnershipQuery
      ? Math.max(0, Math.round(this.remainingRuntimeBudgetMs?.() ?? 0)) || null
      : null;
    this.active = { stage, startedAt, dispatchedAt: null, remainingRuntimeBudgetMsAtEntry };
    const dispatchStartedAt = performance.now();
    try {
      const pendingOperation = operation();
      const dispatchedAt = performance.now();
      if (this.active?.stage === stage) this.active.dispatchedAt = dispatchedAt;
      const value = await pendingOperation;
      const returnedAt = performance.now();
      const rowCountStartedAt = performance.now();
      const completedRowCount = rowCount(value);
      const completedAt = performance.now();
      this.rows.set(stage, {
        ...this.rows.get(stage)!,
        status: "COMPLETED",
        durationMs: Math.round(completedAt - startedAt),
        rowCount: completedRowCount,
        ...(isOwnershipQuery ? {
          ownershipQueryPhaseTiming: {
            remainingRuntimeBudgetMsAtEntry,
            connectionAcquireMs: null,
            poolWaitMs: null,
            queryDispatchMs: Math.round(dispatchedAt - dispatchStartedAt),
            dbExecutionMs: null,
            networkReturnMs: null,
            dbExecutionAndNetworkMs: Math.round(returnedAt - dispatchedAt),
            rowDecodeMs: Math.round(completedAt - rowCountStartedAt),
            totalWallMs: Math.round(completedAt - startedAt),
          },
        } : {}),
      });
      this.active = null;
      return value;
    } catch (error) {
      this.rows.set(stage, { ...this.rows.get(stage)!, status: "FAILED", durationMs: Math.round(performance.now() - startedAt) });
      this.active = null;
      throw error;
    }
  }
  markTimedOut(): void {
    if (!this.active) return;
    const { stage, startedAt, dispatchedAt, remainingRuntimeBudgetMsAtEntry } = this.active;
    const timedOutAt = performance.now();
    const isOwnershipQuery = stage === "execution_plan_review.ownership_chain_read";
    const existing = this.rows.get(stage)!;
    this.rows.set(stage, {
      ...existing,
      status: "TIMED_OUT",
      durationMs: Math.round(timedOutAt - startedAt),
      ...(isOwnershipQuery ? {
        ownershipQueryPhaseTiming: {
          remainingRuntimeBudgetMsAtEntry:
            remainingRuntimeBudgetMsAtEntry,
          connectionAcquireMs: null,
          poolWaitMs: null,
          queryDispatchMs: dispatchedAt === null ? null : Math.round(dispatchedAt - startedAt),
          dbExecutionMs: null,
          networkReturnMs: null,
          dbExecutionAndNetworkMs:
            dispatchedAt === null ? null : Math.round(timedOutAt - dispatchedAt),
          rowDecodeMs: null,
          totalWallMs: Math.round(timedOutAt - startedAt),
        },
      } : {}),
    });
    this.active = null;
  }
  snapshot(): readonly ExecutionPlanReviewProjectionSubstageTiming[] {
    return EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES.map((stage) => this.rows.get(stage)!);
  }
}

const REVIEWER_MIN_ROLE: WorkspaceRole = "operator";

export class ExecutionPlanReviewIdentityConflictError extends Error {
  readonly code = "EXECUTION_PLAN_REVIEW_IDENTITY_CONFLICT";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanReviewIdentityConflictError";
  }
}

export class ExecutionPlanReviewOwnershipError extends Error {
  readonly code = "EXECUTION_PLAN_REVIEW_OWNERSHIP_INVALID";
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanReviewOwnershipError";
  }
}

export class ExecutionPlanReviewStateError extends Error {
  readonly code = "EXECUTION_PLAN_REVIEW_STATE_INVALID";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanReviewStateError";
  }
}

export type OpenExecutionPlanReviewInput = {
  readonly executionPlanId: string;
  readonly openedBy: string;
  readonly openedAt?: string;
};

export type AppendSceneIntentReviewInput = {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly decision: HumanReviewDecision;
  readonly reviewedBy: string;
  readonly reviewedAt?: string;
  readonly rationale?: string;
};

export type AppendStoryReviewInput = {
  readonly executionPlanId: string;
  readonly decision: HumanReviewDecision;
  readonly reviewedBy: string;
  readonly reviewedAt?: string;
  readonly rationale?: string;
};

export interface ExecutionPlanReviewStore {
  openReview(input: OpenExecutionPlanReviewInput): Promise<ReviewOpenedFact>;
  appendSceneIntentDecision(
    input: AppendSceneIntentReviewInput
  ): Promise<SceneIntentReviewDecision>;
  appendStoryDecision(input: AppendStoryReviewInput): Promise<StoryReviewDecision>;
  getLogicalProjection(executionPlanId: string): Promise<LogicalReviewProjection | null>;
}

function assertEquivalentFact<T extends {
  deterministicFingerprint: string;
  factId: string;
  reviewedAt?: string;
  openedAt?: string;
}>(existing: T, requested: T, label: string): void {
  if (
    existing.factId !== requested.factId ||
    existing.deterministicFingerprint !== requested.deterministicFingerprint
  ) {
    throw new ExecutionPlanReviewIdentityConflictError(
      `A different ${label} is already accepted for this deterministic identity`
    );
  }

  // First-accepted timestamps are authoritative. Exclude them from replay equivalence
  // so identical decision identity does not 409 solely due to a new reviewedAt/openedAt.
  const {
    reviewedAt: _existingReviewedAt,
    openedAt: _existingOpenedAt,
    ...existingStable
  } = existing;
  const {
    reviewedAt: _requestedReviewedAt,
    openedAt: _requestedOpenedAt,
    ...requestedStable
  } = requested;
  if (canonicalPersistenceHash(existingStable) !== canonicalPersistenceHash(requestedStable)) {
    throw new ExecutionPlanReviewIdentityConflictError(
      `A different ${label} is already accepted for this deterministic identity`
    );
  }
}

export function deriveLogicalReviewStatus(input: {
  readonly opened: ReviewOpenedFact | null;
  readonly sceneDecisions: readonly SceneIntentReviewDecision[];
  readonly storyDecision: StoryReviewDecision | null;
  readonly requiredSceneExecutionIds: readonly string[];
}): LogicalReviewStatus {
  const latestByScene = latestSceneDecisions(input.sceneDecisions);
  const hasSceneRejection = [...latestByScene.values()].some(
    (decision) => decision.decision === "REJECTED"
  );
  if (hasSceneRejection || input.storyDecision?.decision === "REJECTED") {
    return "REJECTED";
  }
  if (!input.opened) return "UNDER_REVIEW";
  if (input.storyDecision?.decision !== "APPROVED") return "UNDER_REVIEW";
  const allScenesApproved = input.requiredSceneExecutionIds.every(
    (sceneExecutionId) => latestByScene.get(sceneExecutionId)?.decision === "APPROVED"
  );
  return allScenesApproved ? "APPROVED" : "UNDER_REVIEW";
}

export function latestSceneDecisions(
  decisions: readonly SceneIntentReviewDecision[]
): Map<string, SceneIntentReviewDecision> {
  const latest = new Map<string, SceneIntentReviewDecision>();
  for (const decision of decisions) {
    const current = latest.get(decision.sceneExecutionId);
    if (!current || current.reviewedAt <= decision.reviewedAt) {
      latest.set(decision.sceneExecutionId, decision);
    }
  }
  return latest;
}

function buildOpenedFingerprint(executionPlanId: string): string {
  return canonicalPersistenceHash({
    kind: "review-opened",
    executionPlanId,
  });
}

function buildSceneDecisionFingerprint(input: {
  executionPlanId: string;
  sceneExecutionId: string;
  decision: HumanReviewDecision;
  reviewedBy: string;
  instructionHash: string;
  qcResultHash: string;
  rationale?: string;
}): string {
  return canonicalPersistenceHash({
    kind: "scene-intent-review",
    ...input,
  });
}

function buildStoryDecisionFingerprint(input: {
  executionPlanId: string;
  decision: HumanReviewDecision;
  reviewedBy: string;
  requiredSceneExecutionIds: readonly string[];
  approvedSceneExecutionIds: readonly string[];
  rationale?: string;
}): string {
  return canonicalPersistenceHash({
    kind: "story-review",
    ...input,
  });
}

export class ExecutionPlanReviewRepository implements ExecutionPlanReviewStore {
  constructor(private readonly db: Db = getDb()) {}

  async openReview(input: OpenExecutionPlanReviewInput): Promise<ReviewOpenedFact> {
    return this.db.transaction(async (tx) => {
      const plan = await this.requirePlan(input.executionPlanId, tx);
      await this.assertReviewerAuthorized(plan.workspaceId, input.openedBy, tx);

      const fingerprint = buildOpenedFingerprint(plan.id);
      const factId = deterministicPersistenceUuid("review-opened", fingerprint);
      const openedAt = input.openedAt ?? new Date().toISOString();
      const fact = ReviewOpenedFactSchema.parse({
        factId,
        executionPlanId: plan.id,
        orgId: plan.orgId,
        workspaceId: plan.workspaceId,
        campaignId: plan.campaignId,
        storyId: plan.storyId,
        storyVersionId: plan.storyVersionId,
        animationPackageId: plan.animationPackageId,
        openedBy: input.openedBy,
        openedAt,
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        deterministicFingerprint: fingerprint,
      });

      const [existing] = await tx
        .select()
        .from(schema.aiStoryReviewOpenedFacts)
        .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, plan.id))
        .limit(1);
      if (existing) {
        const accepted = ReviewOpenedFactSchema.parse(existing.fact);
        // Idempotent open: same plan returns the accepted open fact.
        // openedBy / openedAt from the first writer are authoritative.
        if (accepted.executionPlanId !== fact.executionPlanId) {
          throw new ExecutionPlanReviewIdentityConflictError(
            "Review open fact conflicts with the Execution Plan identity"
          );
        }
        return accepted;
      }

      const inserted = await tx
        .insert(schema.aiStoryReviewOpenedFacts)
        .values({
          factId: fact.factId,
          orgId: fact.orgId,
          workspaceId: fact.workspaceId,
          campaignId: fact.campaignId,
          storyId: fact.storyId,
          storyVersionId: fact.storyVersionId,
          animationPackageId: fact.animationPackageId,
          executionPlanId: fact.executionPlanId,
          openedBy: fact.openedBy,
          openedAt: new Date(fact.openedAt),
          contractVersion: fact.contractVersion,
          deterministicFingerprint: fact.deterministicFingerprint,
          fact,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted[0]) {
        const [acceptedRow] = await tx
          .select()
          .from(schema.aiStoryReviewOpenedFacts)
          .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, plan.id))
          .limit(1);
        if (!acceptedRow) {
          throw new ExecutionPlanReviewIdentityConflictError(
            "Review open fact identity conflict"
          );
        }
        return ReviewOpenedFactSchema.parse(acceptedRow.fact);
      }

      return ReviewOpenedFactSchema.parse(inserted[0].fact);
    });
  }

  async appendSceneIntentDecision(
    input: AppendSceneIntentReviewInput
  ): Promise<SceneIntentReviewDecision> {
    return this.db.transaction(async (tx) => {
      const plan = await this.requirePlan(input.executionPlanId, tx);
      await this.assertReviewerAuthorized(plan.workspaceId, input.reviewedBy, tx);
      await this.requireOpened(plan.id, tx);

      const projection = await this.readProjection(plan.id, plan, tx);

      const [scene] = await tx
        .select()
        .from(schema.aiStorySceneExecutions)
        .where(
          and(
            eq(schema.aiStorySceneExecutions.id, input.sceneExecutionId),
            eq(schema.aiStorySceneExecutions.executionPlanId, plan.id)
          )
        )
        .limit(1);
      if (!scene) {
        throw new ExecutionPlanReviewStateError(
          "Scene Execution does not belong to this Execution Plan"
        );
      }
      assertSceneMatchesPlan(plan, scene);

      const [snapshot] = await tx
        .select()
        .from(schema.aiStorySceneInstructionSnapshots)
        .where(
          eq(schema.aiStorySceneInstructionSnapshots.contentHash, scene.instructionHash)
        )
        .limit(1);
      if (!snapshot) {
        throw new ExecutionPlanReviewStateError(
          "Instruction Snapshot is required before Scene Intent review"
        );
      }
      assertSnapshotMatchesWorkspace(plan, snapshot);

      const validationRows = await tx
        .select()
        .from(schema.aiStorySceneIntentValidationResults)
        .where(
          eq(
            schema.aiStorySceneIntentValidationResults.sceneExecutionId,
            scene.id
          )
        )
        .orderBy(asc(schema.aiStorySceneIntentValidationResults.acceptedAt));
      if (validationRows.length === 0) {
        throw new ExecutionPlanReviewStateError(
          "AI QC validation result is required before Scene Intent review"
        );
      }
      const latestQc = validationRows[validationRows.length - 1]!;
      if (
        latestQc.orgId !== plan.orgId ||
        latestQc.workspaceId !== plan.workspaceId ||
        latestQc.executionPlanId !== plan.id ||
        latestQc.sceneExecutionId !== scene.id
      ) {
        throw new OwnershipIntegrityViolationError(
          "Intent Validation Result ownership does not match the Execution Plan Aggregate Root"
        );
      }
      if (input.decision === "APPROVED" && latestQc.status === "failed") {
        throw new ExecutionPlanReviewStateError(
          "Scene Intent cannot be approved while AI QC is blocking"
        );
      }

      const reviewedAt = input.reviewedAt ?? new Date().toISOString();
      const fingerprint = buildSceneDecisionFingerprint({
        executionPlanId: plan.id,
        sceneExecutionId: scene.id,
        decision: input.decision,
        reviewedBy: input.reviewedBy,
        instructionHash: scene.instructionHash,
        qcResultHash: latestQc.resultHash,
        rationale: input.rationale,
      });
      const factId = deterministicPersistenceUuid("scene-intent-review", fingerprint);
      const fact = SceneIntentReviewDecisionSchema.parse({
        factId,
        executionPlanId: plan.id,
        sceneExecutionId: scene.id,
        sceneId: scene.sceneId,
        sceneOrder: scene.sceneOrder,
        decision: input.decision,
        reviewedBy: input.reviewedBy,
        reviewedAt,
        rationale: input.rationale,
        instructionHash: scene.instructionHash,
        qcResultHash: latestQc.resultHash,
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        deterministicFingerprint: fingerprint,
      });

      const [existing] = await tx
        .select()
        .from(schema.aiStorySceneIntentReviewFacts)
        .where(
          eq(
            schema.aiStorySceneIntentReviewFacts.deterministicFingerprint,
            fingerprint
          )
        )
        .limit(1);
      if (existing) {
        const accepted = SceneIntentReviewDecisionSchema.parse(existing.fact);
        assertEquivalentFact(accepted, fact, "Scene Intent review fact");
        return accepted;
      }

      if (projection.status === "REJECTED") {
        throw new ExecutionPlanReviewStateError(
          "Rejected review is terminal and cannot accept further decisions"
        );
      }
      if (projection.status === "APPROVED") {
        throw new ExecutionPlanReviewStateError(
          "Approved review is terminal and cannot accept further Scene decisions"
        );
      }

      const inserted = await tx
        .insert(schema.aiStorySceneIntentReviewFacts)
        .values({
          factId: fact.factId,
          orgId: plan.orgId,
          workspaceId: plan.workspaceId,
          campaignId: plan.campaignId,
          storyId: plan.storyId,
          storyVersionId: plan.storyVersionId,
          animationPackageId: plan.animationPackageId,
          executionPlanId: plan.id,
          sceneExecutionId: scene.id,
          sceneId: scene.sceneId,
          sceneOrder: scene.sceneOrder,
          decision: fact.decision,
          reviewedBy: fact.reviewedBy,
          reviewedAt: new Date(fact.reviewedAt),
          instructionHash: fact.instructionHash,
          qcResultHash: fact.qcResultHash,
          contractVersion: fact.contractVersion,
          deterministicFingerprint: fact.deterministicFingerprint,
          fact,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted[0]) {
        const [acceptedRow] = await tx
          .select()
          .from(schema.aiStorySceneIntentReviewFacts)
          .where(
            eq(
              schema.aiStorySceneIntentReviewFacts.deterministicFingerprint,
              fingerprint
            )
          )
          .limit(1);
        if (!acceptedRow) {
          throw new ExecutionPlanReviewIdentityConflictError(
            "Scene Intent review fact identity conflict"
          );
        }
        const accepted = SceneIntentReviewDecisionSchema.parse(acceptedRow.fact);
        assertEquivalentFact(accepted, fact, "Scene Intent review fact");
        return accepted;
      }

      return SceneIntentReviewDecisionSchema.parse(inserted[0].fact);
    });
  }

  async appendStoryDecision(input: AppendStoryReviewInput): Promise<StoryReviewDecision> {
    return this.db.transaction(async (tx) => {
      const plan = await this.requirePlan(input.executionPlanId, tx);
      await this.assertReviewerAuthorized(plan.workspaceId, input.reviewedBy, tx);
      await this.requireOpened(plan.id, tx);

      const projection = await this.readProjection(plan.id, plan, tx);

      const sceneRows = await tx
        .select({ id: schema.aiStorySceneExecutions.id })
        .from(schema.aiStorySceneExecutions)
        .where(eq(schema.aiStorySceneExecutions.executionPlanId, plan.id))
        .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));
      const requiredIds = sceneRows.map((row) => row.id);
      if (requiredIds.length === 0) {
        throw new ExecutionPlanReviewStateError(
          "Execution Plan has no Scene Executions to review"
        );
      }

      const latestByScene = latestSceneDecisions(projection.sceneDecisions);
      const approvedSceneExecutionIds = requiredIds.filter(
        (id) => latestByScene.get(id)?.decision === "APPROVED"
      );

      if (input.decision === "APPROVED") {
        const missing = requiredIds.filter(
          (id) => latestByScene.get(id)?.decision !== "APPROVED"
        );
        if (missing.length > 0) {
          throw new ExecutionPlanReviewStateError(
            "Story approval requires every required Scene Intent to be approved"
          );
        }
      }

      const reviewedAt = input.reviewedAt ?? new Date().toISOString();
      const fingerprint = buildStoryDecisionFingerprint({
        executionPlanId: plan.id,
        decision: input.decision,
        reviewedBy: input.reviewedBy,
        requiredSceneExecutionIds: requiredIds,
        approvedSceneExecutionIds,
        rationale: input.rationale,
      });
      const factId = deterministicPersistenceUuid("story-review", fingerprint);
      const fact = StoryReviewDecisionSchema.parse({
        factId,
        executionPlanId: plan.id,
        decision: input.decision,
        reviewedBy: input.reviewedBy,
        reviewedAt,
        rationale: input.rationale,
        requiredSceneExecutionIds: requiredIds,
        approvedSceneExecutionIds,
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        deterministicFingerprint: fingerprint,
      });

      const [existing] = await tx
        .select()
        .from(schema.aiStoryStoryReviewFacts)
        .where(
          eq(schema.aiStoryStoryReviewFacts.deterministicFingerprint, fingerprint)
        )
        .limit(1);
      if (existing) {
        const accepted = StoryReviewDecisionSchema.parse(existing.fact);
        assertEquivalentFact(accepted, fact, "Story review fact");
        return accepted;
      }

      if (projection.status === "REJECTED") {
        throw new ExecutionPlanReviewStateError(
          "Rejected review is terminal and cannot accept further decisions"
        );
      }
      if (projection.storyDecision) {
        throw new ExecutionPlanReviewIdentityConflictError(
          "A conflicting Story review fact is already accepted for this Execution Plan"
        );
      }

      const inserted = await tx
        .insert(schema.aiStoryStoryReviewFacts)
        .values({
          factId: fact.factId,
          orgId: plan.orgId,
          workspaceId: plan.workspaceId,
          campaignId: plan.campaignId,
          storyId: plan.storyId,
          storyVersionId: plan.storyVersionId,
          animationPackageId: plan.animationPackageId,
          executionPlanId: plan.id,
          decision: fact.decision,
          reviewedBy: fact.reviewedBy,
          reviewedAt: new Date(fact.reviewedAt),
          contractVersion: fact.contractVersion,
          deterministicFingerprint: fact.deterministicFingerprint,
          fact,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted[0]) {
        const [acceptedRow] = await tx
          .select()
          .from(schema.aiStoryStoryReviewFacts)
          .where(
            eq(
              schema.aiStoryStoryReviewFacts.deterministicFingerprint,
              fingerprint
            )
          )
          .limit(1);
        if (!acceptedRow) {
          throw new ExecutionPlanReviewIdentityConflictError(
            "Story review fact identity conflict"
          );
        }
        const accepted = StoryReviewDecisionSchema.parse(acceptedRow.fact);
        assertEquivalentFact(accepted, fact, "Story review fact");
        return accepted;
      }

      return StoryReviewDecisionSchema.parse(inserted[0].fact);
    });
  }

  async getLogicalProjection(
    executionPlanId: string,
    db: QueryDb = this.db,
    timingRecorder: ExecutionPlanReviewProjectionTimingRecorder =
      new ExecutionPlanReviewProjectionTimingRecorder()
  ): Promise<LogicalReviewProjection | null> {
    const plan = await timingRecorder.run(
      "execution_plan_review.plan_read",
      () => this.requirePlanOrNull(executionPlanId, db),
      (row) => row ? 1 : 0
    );
    if (!plan) return null;
    return this.readProjection(executionPlanId, plan, db, timingRecorder);
  }

  private async requirePlanOrNull(executionPlanId: string, db: QueryDb) {
    const [plan] = await db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
      .limit(1);
    return plan ?? null;
  }

  private async requirePlan(executionPlanId: string, db: QueryDb) {
    const plan = await this.requirePlanOrNull(executionPlanId, db);
    if (!plan) {
      throw new ExecutionPlanReviewStateError("Execution Plan not found");
    }
    await assertExecutionPlanOwnershipChain(plan, db);
    return plan;
  }

  private async requireOpened(executionPlanId: string, db: QueryDb) {
    const [opened] = await db
      .select()
      .from(schema.aiStoryReviewOpenedFacts)
      .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, executionPlanId))
      .limit(1);
    if (!opened) {
      throw new ExecutionPlanReviewStateError(
        "Review must be opened before appending review facts"
      );
    }
    return ReviewOpenedFactSchema.parse(opened.fact);
  }

  private async assertReviewerAuthorized(
    workspaceId: string,
    userId: string,
    db: QueryDb
  ) {
    // Use the caller's transaction connection. Calling getWorkspaceMembership
    // here would check out a second global-pool connection while the transaction
    // already holds Vercel's sole max:1 connection, causing a self-deadlock.
    const [member] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.userId, userId)
        )
      )
      .limit(1);
    if (!member) {
      throw new ExecutionPlanReviewOwnershipError(
        "Reviewer is not a member of this workspace"
      );
    }
    if (
      ROLE_HIERARCHY[member.role as WorkspaceRole] < ROLE_HIERARCHY[REVIEWER_MIN_ROLE]
    ) {
      throw new ExecutionPlanReviewOwnershipError(
        "Reviewer lacks required workspace role"
      );
    }
  }

  private async readProjection(
    executionPlanId: string,
    plan: typeof schema.aiStoryExecutionPlans.$inferSelect,
    db: QueryDb,
    timingRecorder: ExecutionPlanReviewProjectionTimingRecorder =
      new ExecutionPlanReviewProjectionTimingRecorder()
  ): Promise<LogicalReviewProjection> {
    await timingRecorder.run(
      "execution_plan_review.ownership_chain_read",
      () => assertExecutionPlanOwnershipChainInSingleQuery(plan, db),
      () => 1
    );
    const expected = planOwnershipFromRow(plan);

    const openedRows = await timingRecorder.run(
      "execution_plan_review.opened_fact_read",
      () => db
        .select()
        .from(schema.aiStoryReviewOpenedFacts)
        .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, executionPlanId))
        .limit(1),
      (rows) => rows.length
    );
    const [openedRow] = openedRows;
    if (openedRow) {
      assertPlanOwnershipColumnsMatch(expected, {
        orgId: openedRow.orgId,
        workspaceId: openedRow.workspaceId,
        campaignId: openedRow.campaignId,
        storyId: openedRow.storyId,
        storyVersionId: openedRow.storyVersionId,
        animationPackageId: openedRow.animationPackageId,
        executionPlanId: openedRow.executionPlanId,
      }, "ReviewOpenedFact");
    }
    const sceneRows = await timingRecorder.run(
      "execution_plan_review.scene_review_fact_read",
      () => db
        .select()
        .from(schema.aiStorySceneIntentReviewFacts)
        .where(eq(schema.aiStorySceneIntentReviewFacts.executionPlanId, executionPlanId))
        .orderBy(asc(schema.aiStorySceneIntentReviewFacts.acceptedAt)),
      (rows) => rows.length
    );
    for (const row of sceneRows) {
      assertPlanOwnershipColumnsMatch(expected, {
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        campaignId: row.campaignId,
        storyId: row.storyId,
        storyVersionId: row.storyVersionId,
        animationPackageId: row.animationPackageId,
        executionPlanId: row.executionPlanId,
      }, "SceneIntentReviewFact");
    }
    const storyRows = await timingRecorder.run(
      "execution_plan_review.story_review_fact_read",
      () => db
        .select({
          orgId: schema.aiStoryStoryReviewFacts.orgId,
          workspaceId: schema.aiStoryStoryReviewFacts.workspaceId,
          campaignId: schema.aiStoryStoryReviewFacts.campaignId,
          storyId: schema.aiStoryStoryReviewFacts.storyId,
          storyVersionId: schema.aiStoryStoryReviewFacts.storyVersionId,
          animationPackageId: schema.aiStoryStoryReviewFacts.animationPackageId,
          executionPlanId: schema.aiStoryStoryReviewFacts.executionPlanId,
          fact: schema.aiStoryStoryReviewFacts.fact,
        })
        .from(schema.aiStoryStoryReviewFacts)
        .where(eq(schema.aiStoryStoryReviewFacts.executionPlanId, executionPlanId))
        .orderBy(desc(schema.aiStoryStoryReviewFacts.acceptedAt))
        .limit(1),
      (rows) => rows.length
    );
    for (const row of storyRows) {
      assertPlanOwnershipColumnsMatch(expected, {
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        campaignId: row.campaignId,
        storyId: row.storyId,
        storyVersionId: row.storyVersionId,
        animationPackageId: row.animationPackageId,
        executionPlanId: row.executionPlanId,
      }, "StoryReviewFact");
    }

    const opened = openedRow ? ReviewOpenedFactSchema.parse(openedRow.fact) : null;
    const sceneDecisions = sceneRows.map((row) =>
      SceneIntentReviewDecisionSchema.parse(row.fact)
    );
    const storyDecision = storyRows[0]
      ? StoryReviewDecisionSchema.parse(storyRows[0].fact)
      : null;

    const requiredSceneRows = await timingRecorder.run(
      "execution_plan_review.required_scene_read",
      () => db
        .select()
        .from(schema.aiStorySceneExecutions)
        .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId))
        .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder)),
      (rows) => rows.length
    );
    for (const scene of requiredSceneRows) {
      assertSceneMatchesPlan(plan, scene);
    }
    const requiredSceneExecutionIds = requiredSceneRows.map((row) => row.id);
    const latest = latestSceneDecisions(sceneDecisions);
    const latestSceneDecisionBySceneExecutionId = Object.fromEntries(latest.entries());

    return timingRecorder.run(
      "execution_plan_review.projection_assembly",
      async () => LogicalReviewProjectionSchema.parse({
      executionPlanId,
      orgId: plan.orgId,
      workspaceId: plan.workspaceId,
      status: deriveLogicalReviewStatus({
        opened,
        sceneDecisions,
        storyDecision,
        requiredSceneExecutionIds,
      }),
      opened,
      sceneDecisions,
      latestSceneDecisionBySceneExecutionId,
      storyDecision,
      derivedAt: new Date().toISOString(),
      }),
      () => 1
    );
  }
}
