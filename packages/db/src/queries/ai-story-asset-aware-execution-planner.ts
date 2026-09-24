import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  AiStoryAssetAnalysisResultSchema,
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetAwareExecutionPlanSchema,
  AiStoryAssetBindingSchema,
  type AiStoryAssetAnalysisSnapshot,
  type AiStoryAssetAwareExecutionPlan,
  type AiStoryAssetBinding,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export class AiStoryAssetPlannerPersistenceError extends Error {
  constructor(
    readonly code:
      | "ASSET_ANALYSIS_SCOPE_MISMATCH"
      | "ASSET_ANALYSIS_IMMUTABLE_CONFLICT"
      | "ASSET_ANALYSIS_FAILED"
      | "STORY_ASSET_BINDING_SCOPE_MISMATCH"
      | "EXECUTION_PLANNER_IMMUTABLE_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "AiStoryAssetPlannerPersistenceError";
  }
}

function snapshotFromRow(
  row: typeof schema.assetAnalysisSnapshots.$inferSelect
): AiStoryAssetAnalysisSnapshot {
  return AiStoryAssetAnalysisSnapshotSchema.parse({
    snapshotId: row.snapshotId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    sourceAssetId: row.sourceAssetId,
    analyzedContentHash: row.analyzedContentHash,
    analyzerVersion: row.analyzerVersion,
    schemaVersion: row.schemaVersion,
    analysis: row.analysis,
    analysisFingerprint: row.analysisFingerprint,
    createdAt: row.createdAt.toISOString(),
  });
}

export class AiStoryAssetAwareExecutionPlannerRepository {
  constructor(private readonly db: Db = getDb()) {}

  async findReusableAnalysis(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly contentHash: string;
    readonly analyzerVersion: string;
    readonly schemaVersion: string;
  }): Promise<AiStoryAssetAnalysisSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(schema.assetAnalysisSnapshots)
      .where(
        and(
          eq(schema.assetAnalysisSnapshots.orgId, input.orgId),
          eq(schema.assetAnalysisSnapshots.workspaceId, input.workspaceId),
          eq(
            schema.assetAnalysisSnapshots.analyzedContentHash,
            input.contentHash
          ),
          eq(
            schema.assetAnalysisSnapshots.analyzerVersion,
            input.analyzerVersion
          ),
          eq(schema.assetAnalysisSnapshots.schemaVersion, input.schemaVersion)
        )
      )
      .limit(1);
    return row ? snapshotFromRow(row) : null;
  }

  /**
   * Cross-process single-flight boundary. The transaction-scoped advisory lock
   * serializes one exact Workspace/content/analyzer/schema cache identity.
   * Raw-byte loading and analyzer invocation occur only inside the cache-miss
   * callback after the lock and second lookup.
   */
  async resolveAnalysisOnce(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly assetId: string;
    readonly contentHash: string;
    readonly analyzerVersion: string;
    readonly schemaVersion: string;
    readonly analyze: () => Promise<
      import("@ceo-agent/shared").AiStoryAssetAnalysisSnapshot["analysis"]
    >;
    readonly now?: () => Date;
  }): Promise<{
    readonly snapshot: AiStoryAssetAnalysisSnapshot;
    readonly cacheStatus: "HIT" | "MISS";
    readonly analyzerInvoked: boolean;
  }> {
    const key = [
      input.workspaceId,
      input.contentHash,
      input.analyzerVersion,
      input.schemaVersion,
    ].join(":");
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      );
      const [asset] = await tx
        .select({
          orgId: schema.assets.orgId,
          workspaceId: schema.assets.workspaceId,
          contentHash: schema.assets.contentHash,
          deletedAt: schema.assets.deletedAt,
        })
        .from(schema.assets)
        .where(eq(schema.assets.id, input.assetId))
        .limit(1);
      if (
        !asset ||
        asset.deletedAt ||
        asset.orgId !== input.orgId ||
        asset.workspaceId !== input.workspaceId ||
        asset.contentHash !== input.contentHash
      ) {
        throw new AiStoryAssetPlannerPersistenceError(
          "ASSET_ANALYSIS_SCOPE_MISMATCH",
          "Finalized Asset is missing, out of scope, or has different content"
        );
      }
      const [cached] = await tx
        .select()
        .from(schema.assetAnalysisSnapshots)
        .where(
          and(
            eq(schema.assetAnalysisSnapshots.orgId, input.orgId),
            eq(schema.assetAnalysisSnapshots.workspaceId, input.workspaceId),
            eq(
              schema.assetAnalysisSnapshots.analyzedContentHash,
              input.contentHash
            ),
            eq(
              schema.assetAnalysisSnapshots.analyzerVersion,
              input.analyzerVersion
            ),
            eq(
              schema.assetAnalysisSnapshots.schemaVersion,
              input.schemaVersion
            )
          )
        )
        .limit(1);
      if (cached) {
        return {
          kind: "SUCCESS" as const,
          snapshot: snapshotFromRow(cached),
          cacheStatus: "HIT" as const,
          analyzerInvoked: false,
        };
      }

      const startedAt = (input.now ?? (() => new Date()))();
      let analysis: import("@ceo-agent/shared").AiStoryAssetAnalysisSnapshot["analysis"];
      try {
        analysis = AiStoryAssetAnalysisResultSchema.parse(
          await input.analyze()
        );
      } catch (error) {
        const completedAt = (input.now ?? (() => new Date()))();
        const errorCode =
          error instanceof AiStoryAssetPlannerPersistenceError
            ? error.code
            : "ASSET_ANALYZER_INVOCATION_FAILED";
        await tx.insert(schema.assetAnalysisAttempts).values({
          attemptId: randomUUID(),
          orgId: input.orgId,
          workspaceId: input.workspaceId,
          assetId: input.assetId,
          contentHash: input.contentHash,
          analyzerVersion: input.analyzerVersion,
          schemaVersion: input.schemaVersion,
          status: "FAILED",
          snapshotId: null,
          errorCode,
          startedAt,
          completedAt,
        });
        return { kind: "FAILURE" as const, errorCode };
      }

      const analysisFingerprint = canonicalPersistenceHash({
        kind: "asset-analysis-snapshot.v1",
        workspaceId: input.workspaceId,
        contentHash: input.contentHash,
        analyzerVersion: input.analyzerVersion,
        schemaVersion: input.schemaVersion,
        analysis,
      });
      const snapshotId = deterministicPersistenceUuid(
        "asset-analysis-snapshot",
        {
          workspaceId: input.workspaceId,
          contentHash: input.contentHash,
          analyzerVersion: input.analyzerVersion,
          schemaVersion: input.schemaVersion,
        }
      );
      const completedAt = (input.now ?? (() => new Date()))();
      const [inserted] = await tx
        .insert(schema.assetAnalysisSnapshots)
        .values({
          snapshotId,
          orgId: input.orgId,
          workspaceId: input.workspaceId,
          sourceAssetId: input.assetId,
          analyzedContentHash: input.contentHash,
          analyzerVersion: input.analyzerVersion,
          schemaVersion: input.schemaVersion,
          analysis,
          analysisFingerprint,
          createdAt: completedAt,
        })
        .returning();
      if (!inserted) {
        throw new AiStoryAssetPlannerPersistenceError(
          "ASSET_ANALYSIS_IMMUTABLE_CONFLICT",
          "Analysis Snapshot could not be persisted under its cache authority"
        );
      }
      await tx.insert(schema.assetAnalysisAttempts).values({
        attemptId: randomUUID(),
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        contentHash: input.contentHash,
        analyzerVersion: input.analyzerVersion,
        schemaVersion: input.schemaVersion,
        status: "SUCCEEDED",
        snapshotId,
        errorCode: null,
        startedAt,
        completedAt,
      });
      return {
        kind: "SUCCESS" as const,
        snapshot: snapshotFromRow(inserted),
        cacheStatus: "MISS" as const,
        analyzerInvoked: true,
      };
    });
    if (outcome.kind === "FAILURE") {
      throw new AiStoryAssetPlannerPersistenceError(
        "ASSET_ANALYSIS_FAILED",
        `Asset analysis failed with explicit outcome ${outcome.errorCode}`
      );
    }
    return outcome;
  }

  async acceptAnalysisSnapshot(
    value: AiStoryAssetAnalysisSnapshot
  ): Promise<AiStoryAssetAnalysisSnapshot> {
    const snapshot = AiStoryAssetAnalysisSnapshotSchema.parse(value);
    const [asset] = await this.db
      .select({
        orgId: schema.assets.orgId,
        workspaceId: schema.assets.workspaceId,
        contentHash: schema.assets.contentHash,
        deletedAt: schema.assets.deletedAt,
      })
      .from(schema.assets)
      .where(eq(schema.assets.id, snapshot.sourceAssetId))
      .limit(1);
    if (
      !asset ||
      asset.deletedAt ||
      asset.orgId !== snapshot.orgId ||
      asset.workspaceId !== snapshot.workspaceId ||
      asset.contentHash !== snapshot.analyzedContentHash
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "ASSET_ANALYSIS_SCOPE_MISMATCH",
        "Analysis Snapshot source Asset is missing, out of scope, or has different bytes"
      );
    }

    const inserted = await this.db
      .insert(schema.assetAnalysisSnapshots)
      .values({
        snapshotId: snapshot.snapshotId,
        orgId: snapshot.orgId,
        workspaceId: snapshot.workspaceId,
        sourceAssetId: snapshot.sourceAssetId,
        analyzedContentHash: snapshot.analyzedContentHash,
        analyzerVersion: snapshot.analyzerVersion,
        schemaVersion: snapshot.schemaVersion,
        analysis: snapshot.analysis,
        analysisFingerprint: snapshot.analysisFingerprint,
        createdAt: new Date(snapshot.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return snapshotFromRow(inserted[0]);

    const existing = await this.findReusableAnalysis({
      orgId: snapshot.orgId,
      workspaceId: snapshot.workspaceId,
      contentHash: snapshot.analyzedContentHash,
      analyzerVersion: snapshot.analyzerVersion,
      schemaVersion: snapshot.schemaVersion,
    });
    if (!existing || existing.analysisFingerprint !== snapshot.analysisFingerprint) {
      throw new AiStoryAssetPlannerPersistenceError(
        "ASSET_ANALYSIS_IMMUTABLE_CONFLICT",
        "Content-addressed analysis cache key conflicts with different analysis"
      );
    }
    return existing;
  }

  async bindStoryAsset(value: AiStoryAssetBinding): Promise<AiStoryAssetBinding> {
    const binding = AiStoryAssetBindingSchema.parse(value);
    const [authority] = await this.db
      .select({
        storyOrgId: schema.aiStories.orgId,
        storyWorkspaceId: schema.aiStories.workspaceId,
        assetOrgId: schema.assets.orgId,
        assetWorkspaceId: schema.assets.workspaceId,
        assetContentHash: schema.assets.contentHash,
        assetDeletedAt: schema.assets.deletedAt,
        analysisOrgId: schema.assetAnalysisSnapshots.orgId,
        analysisWorkspaceId: schema.assetAnalysisSnapshots.workspaceId,
        analysisContentHash:
          schema.assetAnalysisSnapshots.analyzedContentHash,
      })
      .from(schema.aiStories)
      .innerJoin(
        schema.aiStoryVersions,
        and(
          eq(schema.aiStoryVersions.id, binding.storyVersionId),
          eq(schema.aiStoryVersions.storyId, schema.aiStories.id)
        )
      )
      .innerJoin(schema.assets, eq(schema.assets.id, binding.assetId))
      .innerJoin(
        schema.assetAnalysisSnapshots,
        eq(
          schema.assetAnalysisSnapshots.snapshotId,
          binding.analysisSnapshotId
        )
      )
      .where(eq(schema.aiStories.id, binding.storyId))
      .limit(1);
    if (
      !authority ||
      authority.storyOrgId !== binding.orgId ||
      authority.assetOrgId !== binding.orgId ||
      authority.analysisOrgId !== binding.orgId ||
      authority.storyWorkspaceId !== binding.workspaceId ||
      authority.assetWorkspaceId !== binding.workspaceId ||
      authority.analysisWorkspaceId !== binding.workspaceId ||
      authority.assetDeletedAt !== null ||
      authority.assetContentHash !== binding.assetContentHash ||
      authority.analysisContentHash !== binding.analysisContentHash
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "STORY_ASSET_BINDING_SCOPE_MISMATCH",
        "Story, Asset, and immutable analysis must share Workspace and content identity"
      );
    }
    const inserted = await this.db
      .insert(schema.aiStoryAssetBindings)
      .values({
        bindingId: binding.bindingId,
        orgId: binding.orgId,
        workspaceId: binding.workspaceId,
        storyId: binding.storyId,
        storyVersionId: binding.storyVersionId,
        assetId: binding.assetId,
        assetContentHash: binding.assetContentHash,
        analysisSnapshotId: binding.analysisSnapshotId,
        analysisContentHash: binding.analysisContentHash,
        role: binding.role,
        required: binding.required,
        reason: binding.reason,
        trace: binding.trace,
        status: binding.status,
        createdAt: new Date(binding.createdAt),
      })
      .onConflictDoNothing()
      .returning({ bindingId: schema.aiStoryAssetBindings.bindingId });
    if (inserted[0]) return binding;
    const [existing] = await this.db
      .select()
      .from(schema.aiStoryAssetBindings)
      .where(eq(schema.aiStoryAssetBindings.bindingId, binding.bindingId))
      .limit(1);
    if (
      !existing ||
      existing.orgId !== binding.orgId ||
      existing.workspaceId !== binding.workspaceId ||
      existing.storyId !== binding.storyId ||
      existing.storyVersionId !== binding.storyVersionId ||
      existing.assetId !== binding.assetId ||
      existing.assetContentHash !== binding.assetContentHash ||
      existing.analysisSnapshotId !== binding.analysisSnapshotId ||
      existing.analysisContentHash !== binding.analysisContentHash ||
      existing.role !== binding.role ||
      existing.required !== binding.required ||
      existing.reason !== binding.reason ||
      JSON.stringify(existing.trace) !== JSON.stringify(binding.trace) ||
      existing.status !== binding.status
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "STORY_ASSET_BINDING_SCOPE_MISMATCH",
        "Story Asset binding identity conflicts with existing authority"
      );
    }
    return binding;
  }

  async acceptPlannerSnapshot(input: {
    readonly plan: AiStoryAssetAwareExecutionPlan;
    readonly planningFingerprint: string;
  }): Promise<AiStoryAssetAwareExecutionPlan> {
    const plan = AiStoryAssetAwareExecutionPlanSchema.parse(input.plan);
    const [storyVersion] = await this.db
      .select({
        storyId: schema.aiStoryVersions.storyId,
        orgId: schema.aiStories.orgId,
        workspaceId: schema.aiStories.workspaceId,
      })
      .from(schema.aiStoryVersions)
      .innerJoin(
        schema.aiStories,
        eq(schema.aiStories.id, schema.aiStoryVersions.storyId)
      )
      .where(eq(schema.aiStoryVersions.id, plan.storyVersionId))
      .limit(1);
    if (
      !storyVersion ||
      storyVersion.storyId !== plan.storyId ||
      storyVersion.orgId !== plan.orgId ||
      storyVersion.workspaceId !== plan.workspaceId
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "EXECUTION_PLANNER_IMMUTABLE_CONFLICT",
        "Planner Snapshot Story Version is missing or outside Workspace authority"
      );
    }
    const inserted = await this.db
      .insert(schema.aiStoryExecutionPlannerSnapshots)
      .values({
        plannerSnapshotId: plan.plannerSnapshotId,
        orgId: plan.orgId,
        workspaceId: plan.workspaceId,
        storyId: plan.storyId,
        storyVersionId: plan.storyVersionId,
        assetDecisionStatus: plan.assetDecisionStatus,
        requirements: plan.requirements,
        audioIntent: plan.audioIntent,
        providerCapabilityRequirements: plan.providerCapabilityRequirements,
        resolvedGenerationMode: plan.resolvedGenerationMode,
        plan,
        planningFingerprint: input.planningFingerprint,
        plannerVersion: plan.plannerVersion,
        createdAt: new Date(plan.createdAt),
      })
      .onConflictDoNothing()
      .returning({ plan: schema.aiStoryExecutionPlannerSnapshots.plan });
    if (inserted[0]) {
      return AiStoryAssetAwareExecutionPlanSchema.parse(inserted[0].plan);
    }
    const [existing] = await this.db
      .select({ plan: schema.aiStoryExecutionPlannerSnapshots.plan })
      .from(schema.aiStoryExecutionPlannerSnapshots)
      .where(
        and(
          eq(
            schema.aiStoryExecutionPlannerSnapshots.workspaceId,
            plan.workspaceId
          ),
          eq(
            schema.aiStoryExecutionPlannerSnapshots.planningFingerprint,
            input.planningFingerprint
          )
        )
      )
      .limit(1);
    const replay = existing
      ? AiStoryAssetAwareExecutionPlanSchema.parse(existing.plan)
      : null;
    if (
      !replay ||
      replay.plannerSnapshotId !== plan.plannerSnapshotId ||
      JSON.stringify(replay) !== JSON.stringify(plan)
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "EXECUTION_PLANNER_IMMUTABLE_CONFLICT",
        "Planner fingerprint conflicts with different immutable planning authority"
      );
    }
    return replay;
  }
}
