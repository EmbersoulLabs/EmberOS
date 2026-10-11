import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AI_STORY_NO_ASSET_CONFIRMATION_AUTHORITY_VERSION,
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetMatchingResultSchema,
  AiStoryAssetRegistryEntrySchema,
  AiStorySceneGroundingError,
  buildScenePlanningGroundingContext,
  matchAnalyzedAssetsToStory,
  type AiStoryAssetMatchingResult,
} from "@ceo-agent/shared";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { AiStoryAssetPlannerPersistenceError } from "./ai-story-asset-aware-execution-planner";

type Db = ReturnType<typeof getDb>;

function fileKind(type: string) {
  switch (type.toLowerCase()) {
    case "image":
      return "IMAGE" as const;
    case "video":
      return "VIDEO" as const;
    case "audio":
      return "AUDIO" as const;
    case "pdf":
    case "document":
      return "DOCUMENT" as const;
    default:
      return "OTHER" as const;
  }
}

export class AiStoryAssetMatchingRepository {
  constructor(private readonly db: Db = getDb()) {}

  /**
   * Loads the one accepted matching authority for the exact frozen Story
   * Version and resolves its immutable semantic Snapshot lineage. No analyzer
   * or storage read is performed here.
   */
  async loadScenePlanningGroundingContext(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
  }) {
    const rows = await this.db
      .select({ result: schema.aiStoryAssetMatchingResults.result })
      .from(schema.aiStoryAssetMatchingResults)
      .where(and(
        eq(schema.aiStoryAssetMatchingResults.orgId, input.orgId),
        eq(schema.aiStoryAssetMatchingResults.workspaceId, input.workspaceId),
        eq(schema.aiStoryAssetMatchingResults.storyId, input.storyId),
        eq(schema.aiStoryAssetMatchingResults.storyVersionId, input.storyVersionId),
      ))
      .orderBy(desc(schema.aiStoryAssetMatchingResults.createdAt))
      .limit(2);
    if (rows.length !== 1) {
      throw new AiStorySceneGroundingError(
        "SCENE_GROUNDING_AUTHORITY_REQUIRED",
        rows.length === 0
          ? "Scene Planning requires an accepted Asset matching result for the frozen Story Version"
          : "Scene Planning found ambiguous accepted Asset matching authority for the frozen Story Version",
      );
    }
    const result = AiStoryAssetMatchingResultSchema.parse(rows[0]!.result);
    if (
      result.orgId !== input.orgId ||
      result.workspaceId !== input.workspaceId ||
      result.storyId !== input.storyId ||
      result.storyVersionId !== input.storyVersionId
    ) {
      throw new AiStorySceneGroundingError(
        "SCENE_GROUNDING_STALE_STORY_VERSION",
        "Accepted Asset matching authority does not belong to the current frozen Story Version",
      );
    }
    const snapshotIds = result.bindings
      .filter((binding) => binding.status === "ACTIVE" && binding.role !== "UNUSED")
      .map((binding) => binding.analysisSnapshotId);
    const snapshotRows = snapshotIds.length === 0 ? [] : await this.db
      .select()
      .from(schema.assetAnalysisSnapshots)
      .where(and(
        eq(schema.assetAnalysisSnapshots.orgId, input.orgId),
        eq(schema.assetAnalysisSnapshots.workspaceId, input.workspaceId),
        inArray(schema.assetAnalysisSnapshots.snapshotId, snapshotIds),
      ));
    return buildScenePlanningGroundingContext({
      result,
      snapshots: snapshotRows.map((row) => AiStoryAssetAnalysisSnapshotSchema.parse({
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
      })),
    });
  }

  /** Reads persisted intelligence only. It has no storage or analyzer dependency. */
  async loadEligibleAnalyzedAssets(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly analyzerVersion: string;
    readonly schemaVersion: string;
    readonly assetIds?: readonly string[];
  }) {
    if (input.assetIds && input.assetIds.length === 0) return [];
    const rows = await this.db
      .select({
        asset: schema.assets,
        snapshot: schema.assetAnalysisSnapshots,
      })
      .from(schema.assets)
      .innerJoin(
        schema.assetAnalysisSnapshots,
        and(
          eq(
            schema.assetAnalysisSnapshots.workspaceId,
            schema.assets.workspaceId
          ),
          eq(
            schema.assetAnalysisSnapshots.analyzedContentHash,
            schema.assets.contentHash
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
      .where(
        and(
          eq(schema.assets.orgId, input.orgId),
          eq(schema.assets.workspaceId, input.workspaceId),
          isNull(schema.assets.deletedAt),
          ...(input.assetIds
            ? [inArray(schema.assets.id, [...input.assetIds])]
            : [])
        )
      );
    return rows.flatMap(({ asset, snapshot }) => {
      if (!asset.contentHash || !asset.mimeType) return [];
      return [
        {
          registry: AiStoryAssetRegistryEntrySchema.parse({
            assetId: asset.id,
            orgId: asset.orgId,
            workspaceId: asset.workspaceId,
            contentHash: asset.contentHash,
            mimeType: asset.mimeType,
            fileKind: fileKind(asset.type),
            storageRef: asset.storagePath,
            createdAt: asset.createdAt.toISOString(),
          }),
          snapshot: AiStoryAssetAnalysisSnapshotSchema.parse({
            snapshotId: snapshot.snapshotId,
            orgId: snapshot.orgId,
            workspaceId: snapshot.workspaceId,
            sourceAssetId: snapshot.sourceAssetId,
            analyzedContentHash: snapshot.analyzedContentHash,
            analyzerVersion: snapshot.analyzerVersion,
            schemaVersion: snapshot.schemaVersion,
            analysis: snapshot.analysis,
            analysisFingerprint: snapshot.analysisFingerprint,
            createdAt: snapshot.createdAt.toISOString(),
          }),
        },
      ];
    });
  }

  async acceptMatchingResult(input: {
    readonly result: AiStoryAssetMatchingResult;
    readonly resultFingerprint: string;
  }): Promise<AiStoryAssetMatchingResult> {
    const result = AiStoryAssetMatchingResultSchema.parse(input.result);
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
      .where(eq(schema.aiStoryVersions.id, result.storyVersionId))
      .limit(1);
    if (
      !storyVersion ||
      storyVersion.storyId !== result.storyId ||
      storyVersion.orgId !== result.orgId ||
      storyVersion.workspaceId !== result.workspaceId
    ) {
      throw new AiStoryAssetPlannerPersistenceError(
        "STORY_ASSET_BINDING_SCOPE_MISMATCH",
        "Story Asset matching result is outside frozen Story authority"
      );
    }

    const assetIds = result.bindings.map((binding) => binding.assetId);
    const snapshotIds = result.bindings.map(
      (binding) => binding.analysisSnapshotId
    );
    const assets =
      assetIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.assets)
            .where(
              and(
                eq(schema.assets.orgId, result.orgId),
                eq(schema.assets.workspaceId, result.workspaceId),
                inArray(schema.assets.id, assetIds),
                isNull(schema.assets.deletedAt)
              )
            );
    const snapshots =
      snapshotIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.assetAnalysisSnapshots)
            .where(
              and(
                eq(schema.assetAnalysisSnapshots.orgId, result.orgId),
                eq(
                  schema.assetAnalysisSnapshots.workspaceId,
                  result.workspaceId
                ),
                inArray(
                  schema.assetAnalysisSnapshots.snapshotId,
                  snapshotIds
                )
              )
            );
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const snapshotById = new Map(
      snapshots.map((snapshot) => [snapshot.snapshotId, snapshot])
    );
    for (const binding of result.bindings) {
      const asset = assetById.get(binding.assetId);
      const snapshot = snapshotById.get(binding.analysisSnapshotId);
      if (
        binding.storyId !== result.storyId ||
        binding.storyVersionId !== result.storyVersionId ||
        binding.orgId !== result.orgId ||
        binding.workspaceId !== result.workspaceId ||
        !asset ||
        !snapshot ||
        asset.contentHash !== binding.assetContentHash ||
        snapshot.analyzedContentHash !== binding.analysisContentHash ||
        binding.assetContentHash !== binding.analysisContentHash
      ) {
        throw new AiStoryAssetPlannerPersistenceError(
          "STORY_ASSET_BINDING_SCOPE_MISMATCH",
          "Matching binding does not pin exact Workspace Asset and analysis authority"
        );
      }
    }

    const inserted = await this.db.transaction(async (tx) => {
      if (result.bindings.length > 0) {
        await tx
          .insert(schema.aiStoryAssetBindings)
          .values(
            result.bindings.map((binding) => ({
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
            }))
          )
          .onConflictDoNothing();
      }
      return tx
        .insert(schema.aiStoryAssetMatchingResults)
        .values({
          matchingResultId: result.matchingResultId,
          orgId: result.orgId,
          workspaceId: result.workspaceId,
          storyId: result.storyId,
          storyVersionId: result.storyVersionId,
          contractVersion: result.contractVersion,
          result,
          resultFingerprint: input.resultFingerprint,
          matcherVersion: result.matcherVersion,
          createdAt: new Date(result.createdAt),
        })
        .onConflictDoNothing()
        .returning({ result: schema.aiStoryAssetMatchingResults.result });
    });
    if (inserted[0]) {
      return AiStoryAssetMatchingResultSchema.parse(inserted[0].result);
    }
    const [existing] = await this.db
      .select({ result: schema.aiStoryAssetMatchingResults.result })
      .from(schema.aiStoryAssetMatchingResults)
      .where(
        and(
          eq(
            schema.aiStoryAssetMatchingResults.workspaceId,
            result.workspaceId
          ),
          eq(
            schema.aiStoryAssetMatchingResults.resultFingerprint,
            input.resultFingerprint
          )
        )
      )
      .limit(1);
    const replay = existing
      ? AiStoryAssetMatchingResultSchema.parse(existing.result)
      : null;
    if (!replay || JSON.stringify(replay) !== JSON.stringify(result)) {
      throw new AiStoryAssetPlannerPersistenceError(
        "EXECUTION_PLANNER_IMMUTABLE_CONFLICT",
        "Story Asset matching fingerprint conflicts with existing authority"
      );
    }
    return replay;
  }

  /**
   * Explicit reference-free confirmation for one frozen Story Version.
   * Uses the same matching result table as analyzed-asset acceptance.
   * It does not read Asset bytes or call a model.
   */
  async confirmNoReferenceAssets(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly confirmedBy: string;
    readonly confirmedAt: string;
    readonly nativeDialogueDesired?: boolean;
  }): Promise<AiStoryAssetMatchingResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ai_stories where id=${input.storyId} for update`);
      await tx.execute(sql`select id from ai_story_versions where id=${input.storyVersionId} for update`);
      const [story] = await tx
        .select({
          id: schema.aiStories.id,
          orgId: schema.aiStories.orgId,
          workspaceId: schema.aiStories.workspaceId,
          currentVersionId: schema.aiStories.currentVersionId,
        })
        .from(schema.aiStories)
        .where(eq(schema.aiStories.id, input.storyId))
        .limit(1);
      const [version] = await tx
        .select({
          id: schema.aiStoryVersions.id,
          storyId: schema.aiStoryVersions.storyId,
          versionNumber: schema.aiStoryVersions.versionNumber,
          frozenAt: schema.aiStoryVersions.frozenAt,
        })
        .from(schema.aiStoryVersions)
        .where(eq(schema.aiStoryVersions.id, input.storyVersionId))
        .limit(1);
      if (
        !story ||
        !version ||
        story.orgId !== input.orgId ||
        story.workspaceId !== input.workspaceId ||
        version.storyId !== input.storyId
      ) {
        throw new AiStoryAssetPlannerPersistenceError(
          "STORY_ASSET_BINDING_SCOPE_MISMATCH",
          "No-asset confirmation is outside the authorized Story Workspace"
        );
      }
      if (story.currentVersionId !== input.storyVersionId) {
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_STALE_VERSION",
          "No-asset confirmation does not match the current frozen Story Version"
        );
      }
      if (!version.frozenAt) {
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_VERSION_NOT_FROZEN",
          "Story Version must be frozen before no-asset confirmation"
        );
      }
      const boundAssets = await tx
        .select({ assetId: schema.assets.id })
        .from(schema.aiStoryAssetLinks)
        .innerJoin(
          schema.assets,
          eq(schema.assets.id, schema.aiStoryAssetLinks.assetId)
        )
        .where(and(
          eq(schema.aiStoryAssetLinks.storyId, input.storyId),
          eq(schema.assets.orgId, input.orgId),
          eq(schema.assets.workspaceId, input.workspaceId),
          isNull(schema.assets.deletedAt),
        ));
      if (boundAssets.length > 0) {
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_ASSETS_PRESENT",
          "Reference assets are already bound. Use the existing Asset Matching flow."
        );
      }
      const existingRows = await tx
        .select({ result: schema.aiStoryAssetMatchingResults.result })
        .from(schema.aiStoryAssetMatchingResults)
        .where(and(
          eq(schema.aiStoryAssetMatchingResults.orgId, input.orgId),
          eq(schema.aiStoryAssetMatchingResults.workspaceId, input.workspaceId),
          eq(schema.aiStoryAssetMatchingResults.storyId, input.storyId),
          eq(schema.aiStoryAssetMatchingResults.storyVersionId, input.storyVersionId),
        ));
      if (existingRows.length > 1) {
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_CONFLICT",
          "This frozen Story Version already has more than one Asset matching result"
        );
      }
      if (existingRows.length === 1) {
        const existing = AiStoryAssetMatchingResultSchema.parse(existingRows[0]!.result);
        const confirmation = existing.noAssetConfirmation;
        if (
          existing.assetRecommendationStatus === "CONFIRMED_NO_ASSETS" &&
          existing.bindings.length === 0 &&
          confirmation?.storyId === input.storyId &&
          confirmation.storyVersionId === input.storyVersionId
        ) {
          return existing;
        }
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_CONFLICT",
          "This frozen Story Version already has a different Asset matching result"
        );
      }
      const confirmedAt = new Date(input.confirmedAt).toISOString();
      const matchingResultId = deterministicUuidFromFingerprint(
        "ai-story-no-asset-confirmation",
        sha256CanonicalIntegrityHash({
          orgId: input.orgId,
          workspaceId: input.workspaceId,
          storyId: input.storyId,
          storyVersionId: input.storyVersionId,
          authorityVersion: AI_STORY_NO_ASSET_CONFIRMATION_AUTHORITY_VERSION,
        })
      );
      const result = matchAnalyzedAssetsToStory({
        matchingResultId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        storyId: input.storyId,
        storyVersionId: input.storyVersionId,
        storyVersionNumber: version.versionNumber,
        requirements: {
          nativeDialogueDesired: input.nativeDialogueDesired === true,
        },
        assets: [],
        semanticDecisions: [],
        bindingIdByAssetId: {},
        noAssetConfirmation: {
          storyId: input.storyId,
          storyVersionId: input.storyVersionId,
          confirmedBy: input.confirmedBy,
          confirmedAt,
          authorityVersion: AI_STORY_NO_ASSET_CONFIRMATION_AUTHORITY_VERSION,
        },
        matcherVersion: "emberos-story-asset-grounding-matcher.v1",
        createdAt: confirmedAt,
      });
      const resultFingerprint = sha256CanonicalIntegrityHash({ result });
      const inserted = await tx
        .insert(schema.aiStoryAssetMatchingResults)
        .values({
          matchingResultId: result.matchingResultId,
          orgId: result.orgId,
          workspaceId: result.workspaceId,
          storyId: result.storyId,
          storyVersionId: result.storyVersionId,
          contractVersion: result.contractVersion,
          result,
          resultFingerprint,
          matcherVersion: result.matcherVersion,
          createdAt: new Date(result.createdAt),
        })
        .onConflictDoNothing()
        .returning({ result: schema.aiStoryAssetMatchingResults.result });
      if (!inserted[0]) {
        throw new AiStoryAssetPlannerPersistenceError(
          "NO_ASSET_CONFIRMATION_CONFLICT",
          "No-asset confirmation conflicted with existing Asset matching authority"
        );
      }
      return AiStoryAssetMatchingResultSchema.parse(inserted[0].result);
    });
  }
}
