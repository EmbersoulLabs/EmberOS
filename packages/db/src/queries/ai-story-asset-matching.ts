import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetMatchingResultSchema,
  AiStoryAssetRegistryEntrySchema,
  type AiStoryAssetMatchingResult,
} from "@ceo-agent/shared";
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
}
