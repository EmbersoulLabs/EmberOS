import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../client";

export type AiStorySceneReleaseState = "AUTHORIZED_NOT_RELEASED" | "RELEASED";
export type AiStorySceneReleaseRow = typeof schema.aiStorySceneReleaseStates.$inferSelect;

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
        .where(and(eq(schema.aiStorySceneResults.sceneResultId, approved.sceneResultId), eq(schema.aiStorySceneResults.sceneExecutionId, first.sceneExecutionId), eq(schema.aiStorySceneResults.status, "SUCCEEDED"))).limit(1);
      if (!result) throw new Error("FIRST_SCENE_DURABLE_RESULT_REQUIRED");
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
}
