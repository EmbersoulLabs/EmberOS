import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../client";

export type AiStorySceneReleaseState = "AUTHORIZED_NOT_RELEASED" | "RELEASED";
export type AiStorySceneReleaseRow = typeof schema.aiStorySceneReleaseStates.$inferSelect;
export type AiStoryNextSceneReleaseResult = {
  readonly rows: readonly AiStorySceneReleaseRow[];
  readonly selectedSceneExecutionId: string | null;
  readonly selectedSceneOrder: number | null;
  readonly newlyReleased: boolean;
};

export class AiStorySceneReleaseRepository {
  constructor(private readonly db = getDb()) {}

  async initialize(input: {
    executionPlanId: string; runtimeAuthorizationId: string; workspaceId: string;
    orderedSceneExecutionIds: readonly string[]; actorUserId: string; releasedAt: Date;
  }): Promise<readonly AiStorySceneReleaseRow[]> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.executionPlanId}))`);
      for (let index = 0; index < input.orderedSceneExecutionIds.length; index += 1) {
        const first = index === 0;
        await tx.insert(schema.aiStorySceneReleaseStates).values({
          sceneExecutionId: input.orderedSceneExecutionIds[index]!,
          executionPlanId: input.executionPlanId,
          runtimeAuthorizationId: input.runtimeAuthorizationId,
          workspaceId: input.workspaceId,
          sceneOrder: index + 1,
          releaseState: first ? "RELEASED" : "AUTHORIZED_NOT_RELEASED",
          releaseStage: first ? 1 : null,
          releasedBy: first ? input.actorUserId : null,
          releasedAt: first ? input.releasedAt : null,
        }).onConflictDoNothing();
      }
    });
    return this.list(input.executionPlanId);
  }

  async list(executionPlanId: string): Promise<readonly AiStorySceneReleaseRow[]> {
    return this.db.select().from(schema.aiStorySceneReleaseStates)
      .where(eq(schema.aiStorySceneReleaseStates.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
  }

  async releaseRemaining(input: {
    executionPlanId: string; workspaceId: string; actorUserId: string; releasedAt: Date;
  }): Promise<{ rows: readonly AiStorySceneReleaseRow[]; newlyReleasedSceneIds: readonly string[] }> {
    const newlyReleasedSceneIds = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.executionPlanId}))`);
      const rows = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId), eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId)))
        .orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
      if (rows.length < 2 || rows[0]?.releaseState !== "RELEASED") throw new Error("STAGED_RELEASE_NOT_INITIALIZED");
      const first = rows[0]!;
      const [approved] = await tx.select().from(schema.aiStoryGeneratedSceneReviews)
        .where(and(eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, first.sceneExecutionId), eq(schema.aiStoryGeneratedSceneReviews.decision, "APPROVED"))).limit(1);
      if (!approved || !approved.sceneResultId || !approved.providerAttemptId) throw new Error("FIRST_SCENE_EXACT_APPROVAL_REQUIRED");
      const [result] = await tx.select().from(schema.aiStorySceneResults)
        .where(and(
          eq(schema.aiStorySceneResults.sceneResultId, approved.sceneResultId),
          eq(schema.aiStorySceneResults.sceneExecutionId, first.sceneExecutionId),
          eq(schema.aiStorySceneResults.providerAttemptId, approved.providerAttemptId),
          eq(schema.aiStorySceneResults.status, "SUCCEEDED")
        )).limit(1);
      if (!result) throw new Error("FIRST_SCENE_DURABLE_RESULT_REQUIRED");
      const [attempt] = await tx.select().from(schema.providerAttempts)
        .where(and(
          eq(schema.providerAttempts.attemptId, approved.providerAttemptId),
          eq(schema.providerAttempts.status, "SUCCEEDED")
        )).limit(1);
      if (!attempt || attempt.executionId !== result.providerExecutionId) {
        throw new Error("FIRST_SCENE_EXACT_ATTEMPT_REQUIRED");
      }
      const correlations = await tx.select().from(schema.aiStorySceneSchedulingCorrelations)
        .where(eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, first.sceneExecutionId));
      if (!correlations.some((row) => row.providerExecutionId === attempt.executionId)) {
        throw new Error("FIRST_SCENE_EXACT_ATTEMPT_REQUIRED");
      }
      const executionIds = correlations.map((row) => row.providerExecutionId);
      const executions = executionIds.length === 0 ? [] : await tx.select()
        .from(schema.providerExecutions)
        .where(inArray(schema.providerExecutions.executionId, executionIds));
      if (
        executions.length !== executionIds.length ||
        executions.some((row) => row.status !== "SUCCEEDED" && row.status !== "TERMINAL_FAILURE")
      ) {
        throw new Error("FIRST_SCENE_RETRY_OR_EXECUTION_IN_FLIGHT");
      }
      const held = rows.filter((row) => row.sceneOrder > 1 && row.releaseState === "AUTHORIZED_NOT_RELEASED");
      if (held.length === 0) return [];
      const ids: string[] = [];
      for (const row of held) {
        const [updated] = await tx.update(schema.aiStorySceneReleaseStates).set({
          releaseState: "RELEASED", releaseStage: 2, releasedBy: input.actorUserId,
          releasedAt: input.releasedAt, updatedAt: input.releasedAt,
          gateSceneExecutionId: first.sceneExecutionId,
          gateProviderAttemptId: approved.providerAttemptId,
          gateSceneResultId: approved.sceneResultId,
        }).where(and(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, row.sceneExecutionId), eq(schema.aiStorySceneReleaseStates.releaseState, "AUTHORIZED_NOT_RELEASED"))).returning();
        if (updated) ids.push(updated.sceneExecutionId);
      }
      return ids;
    });
    return { rows: await this.list(input.executionPlanId), newlyReleasedSceneIds };
  }

  /**
   * Releases at most one server-selected Scene. The advisory transaction lock
   * makes the selection + transition atomic for an Execution Plan.
   */
  async releaseNextEligible(input: {
    executionPlanId: string; workspaceId: string; actorUserId: string; releasedAt: Date;
  }): Promise<AiStoryNextSceneReleaseResult> {
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.executionPlanId}))`);
      const rows = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
          eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId)
        ))
        .orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
      if (rows.length < 2 || rows[0]?.releaseState !== "RELEASED") {
        throw new Error("STAGED_RELEASE_NOT_INITIALIZED");
      }

      // The client never selects a Scene. The first held row is authoritative.
      const candidate = rows.find((row) => row.releaseState === "AUTHORIZED_NOT_RELEASED");
      if (!candidate) {
        const lastReleased = rows.at(-1);
        return lastReleased && lastReleased.sceneOrder > 1
          ? { row: lastReleased, newlyReleased: false }
          : null;
      }

      const priorRows = rows.filter((row) => row.sceneOrder < candidate.sceneOrder);
      let immediateGate: {
        sceneExecutionId: string;
        providerAttemptId: string;
        sceneResultId: string;
      } | null = null;

      // Strict sequential gate: every prior Scene must have an exact durable
      // APPROVED review bound to its successful result and provider attempt.
      for (const prior of priorRows) {
        if (prior.releaseState !== "RELEASED") throw new Error("PRIOR_SCENE_APPROVAL_REQUIRED");
        const [approved] = await tx.select().from(schema.aiStoryGeneratedSceneReviews)
          .where(and(
            eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, prior.sceneExecutionId),
            eq(schema.aiStoryGeneratedSceneReviews.decision, "APPROVED")
          )).limit(1);
        if (!approved || !approved.sceneResultId || !approved.providerAttemptId) {
          // A replay after this predecessor was released converges on that same
          // Scene. The scheduler's durable uniqueness contract prevents a
          // duplicate execution/outbox/provider attempt.
          if (prior.sceneOrder === candidate.sceneOrder - 1 && prior.sceneOrder > 1) {
            return { row: prior, newlyReleased: false };
          }
          throw new Error("PRIOR_SCENE_APPROVAL_REQUIRED");
        }
        const [result] = await tx.select().from(schema.aiStorySceneResults)
          .where(and(
            eq(schema.aiStorySceneResults.sceneResultId, approved.sceneResultId),
            eq(schema.aiStorySceneResults.sceneExecutionId, prior.sceneExecutionId),
            eq(schema.aiStorySceneResults.providerAttemptId, approved.providerAttemptId),
            eq(schema.aiStorySceneResults.status, "SUCCEEDED")
          )).limit(1);
        if (!result) throw new Error("PRIOR_SCENE_DURABLE_RESULT_REQUIRED");
        const [attempt] = await tx.select().from(schema.providerAttempts)
          .where(and(
            eq(schema.providerAttempts.attemptId, approved.providerAttemptId),
            eq(schema.providerAttempts.status, "SUCCEEDED")
          )).limit(1);
        if (!attempt || attempt.executionId !== result.providerExecutionId) {
          throw new Error("PRIOR_SCENE_EXACT_ATTEMPT_REQUIRED");
        }
        const correlations = await tx.select().from(schema.aiStorySceneSchedulingCorrelations)
          .where(eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, prior.sceneExecutionId));
        if (!correlations.some((row) => row.providerExecutionId === attempt.executionId)) {
          throw new Error("PRIOR_SCENE_EXACT_ATTEMPT_REQUIRED");
        }
        const executionIds = correlations.map((row) => row.providerExecutionId);
        const executions = executionIds.length === 0 ? [] : await tx.select()
          .from(schema.providerExecutions)
          .where(inArray(schema.providerExecutions.executionId, executionIds));
        if (
          executions.length !== executionIds.length ||
          executions.some((row) => row.status !== "SUCCEEDED" && row.status !== "TERMINAL_FAILURE")
        ) {
          throw new Error("PRIOR_SCENE_RETRY_OR_EXECUTION_IN_FLIGHT");
        }
        if (prior.sceneOrder === candidate.sceneOrder - 1) {
          immediateGate = {
            sceneExecutionId: prior.sceneExecutionId,
            providerAttemptId: approved.providerAttemptId,
            sceneResultId: approved.sceneResultId,
          };
        }
      }
      if (!immediateGate) throw new Error("PRIOR_SCENE_APPROVAL_REQUIRED");

      const [updated] = await tx.update(schema.aiStorySceneReleaseStates).set({
        releaseState: "RELEASED",
        releaseStage: candidate.sceneOrder,
        releasedBy: input.actorUserId,
        releasedAt: input.releasedAt,
        updatedAt: input.releasedAt,
        gateSceneExecutionId: immediateGate.sceneExecutionId,
        gateProviderAttemptId: immediateGate.providerAttemptId,
        gateSceneResultId: immediateGate.sceneResultId,
      }).where(and(
        eq(schema.aiStorySceneReleaseStates.sceneExecutionId, candidate.sceneExecutionId),
        eq(schema.aiStorySceneReleaseStates.releaseState, "AUTHORIZED_NOT_RELEASED")
      )).returning();
      return updated ? { row: updated, newlyReleased: true } : null;
    });

    return {
      rows: await this.list(input.executionPlanId),
      selectedSceneExecutionId: outcome?.row.sceneExecutionId ?? null,
      selectedSceneOrder: outcome?.row.sceneOrder ?? null,
      newlyReleased: outcome?.newlyReleased ?? false,
    };
  }
}
