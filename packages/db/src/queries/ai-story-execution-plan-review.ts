/**
 * Sprint 3 Phase 2B PR 2B.1 — Execution Plan Human Review repository.
 *
 * Append-only review facts subordinate to the Execution Plan Aggregate Root.
 * Never mutates plans, scenes, snapshots, or QC rows. Never unlocks execution
 * or creates Queue / Outbox / Provider work.
 */
import { and, asc, eq } from "drizzle-orm";
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
import { getWorkspaceMembership, ROLE_HIERARCHY } from "./tenant";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

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

function assertEquivalentFact<T extends { deterministicFingerprint: string; factId: string }>(
  existing: T,
  requested: T,
  label: string
): void {
  if (
    existing.factId !== requested.factId ||
    existing.deterministicFingerprint !== requested.deterministicFingerprint ||
    canonicalPersistenceHash(existing) !== canonicalPersistenceHash(requested)
  ) {
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
      await this.assertReviewerAuthorized(plan.workspaceId, input.openedBy);

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
      await this.assertReviewerAuthorized(plan.workspaceId, input.reviewedBy);
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
      await this.assertReviewerAuthorized(plan.workspaceId, input.reviewedBy);
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
    executionPlanId: string
  ): Promise<LogicalReviewProjection | null> {
    const plan = await this.requirePlanOrNull(executionPlanId, this.db);
    if (!plan) return null;
    return this.readProjection(executionPlanId, plan, this.db);
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

  private async assertReviewerAuthorized(workspaceId: string, userId: string) {
    const member = await getWorkspaceMembership(workspaceId, userId);
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
    db: QueryDb
  ): Promise<LogicalReviewProjection> {
    const [openedRow] = await db
      .select()
      .from(schema.aiStoryReviewOpenedFacts)
      .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, executionPlanId))
      .limit(1);
    const sceneRows = await db
      .select()
      .from(schema.aiStorySceneIntentReviewFacts)
      .where(eq(schema.aiStorySceneIntentReviewFacts.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneIntentReviewFacts.acceptedAt));
    const storyRows = await db
      .select()
      .from(schema.aiStoryStoryReviewFacts)
      .where(eq(schema.aiStoryStoryReviewFacts.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStoryStoryReviewFacts.acceptedAt));

    const opened = openedRow ? ReviewOpenedFactSchema.parse(openedRow.fact) : null;
    const sceneDecisions = sceneRows.map((row) =>
      SceneIntentReviewDecisionSchema.parse(row.fact)
    );
    const storyDecision = storyRows[storyRows.length - 1]
      ? StoryReviewDecisionSchema.parse(storyRows[storyRows.length - 1]!.fact)
      : null;

    const requiredSceneRows = await db
      .select({ id: schema.aiStorySceneExecutions.id })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));
    const requiredSceneExecutionIds = requiredSceneRows.map((row) => row.id);
    const latest = latestSceneDecisions(sceneDecisions);
    const latestSceneDecisionBySceneExecutionId = Object.fromEntries(latest.entries());

    return LogicalReviewProjectionSchema.parse({
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
    });
  }
}
