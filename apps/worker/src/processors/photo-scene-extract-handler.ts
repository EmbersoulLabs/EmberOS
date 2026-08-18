import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { executeProductExtraction } from "@ceo-agent/agents/photo-scene/execute-product-extraction";
import { resolveBackgroundRemovalProvider } from "@ceo-agent/agents/photo-scene/background-removal";
import {
  PhotoSceneExtractionInputCapsuleV1Schema,
  boundPhotoSceneOpsMessage,
  emitPhotoSceneOpsEvent,
  isExtractionErrorCategory,
  userSafeExtractionMessage,
  type PhotoSceneGenerationSnapshot,
} from "@ceo-agent/shared";
import { downloadStorageFile, uploadStorageFile } from "../storage";
import { hashSourceAssetBytes } from "../source-asset-content-hash";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function asGenerationSnapshot(
  row: typeof schema.photoSceneGenerations.$inferSelect
): PhotoSceneGenerationSnapshot {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    operation: row.operation,
    status: row.status,
    sourceAssetId: row.sourceAssetId,
    sourceContentHash: row.sourceContentHash,
    inputCapsule: PhotoSceneExtractionInputCapsuleV1Schema.parse(row.inputCapsule),
    inputFingerprint: row.inputFingerprint,
    outputAssetId: row.outputAssetId,
    providerKey: row.providerKey,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
    boundedError: row.boundedError,
    costUsd: row.costUsd,
  };
}

export async function processPhotoSceneExtractJob(data: {
  generationId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
}): Promise<void> {
  const db = getDb();
  const started = Date.now();
  const [generation] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.id, data.generationId),
        eq(schema.photoSceneGenerations.workspaceId, data.workspaceId),
        eq(schema.photoSceneGenerations.orgId, data.orgId)
      )
    )
    .limit(1);

  if (!generation) {
    emitPhotoSceneOpsEvent({
      event: "extraction.missing",
      stage: "photo_scene.extract",
      outcome: "failed",
      orgId: data.orgId,
      workspaceId: data.workspaceId,
      campaignId: data.campaignId,
      generationId: data.generationId,
      failureClass: "INVALID_SOURCE",
    });
    return;
  }

  if (generation.status === "ready") return;

  await db
    .update(schema.photoSceneGenerations)
    .set({
      status: "processing",
      startedAt: generation.startedAt ?? new Date(),
      updatedAt: new Date(),
      errorCode: null,
      boundedError: null,
    })
    .where(
      and(
        eq(schema.photoSceneGenerations.id, generation.id),
        eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId)
      )
    );

  const provider = resolveBackgroundRemovalProvider();

  emitPhotoSceneOpsEvent({
    event: "extraction.started",
    stage: "photo_scene.extract",
    outcome: "started",
    orgId: generation.orgId,
    workspaceId: generation.workspaceId,
    campaignId: generation.campaignId,
    generationId: generation.id,
    sourceAssetId: generation.sourceAssetId,
    attempt: generation.attemptCount,
    providerKey: provider.key,
  });

  const workDir = join(tmpdir(), `photo-scene-extract-${generation.id}`);
  await mkdir(workDir, { recursive: true });

  try {
    const result = await executeProductExtraction({
      generation: asGenerationSnapshot({ ...generation, status: "processing" }),
      io: {
        provider,
        hashBytes: hashSourceAssetBytes,
        readSourceBytes: async (storagePath) => {
          const localPath = join(workDir, "source.bin");
          await downloadStorageFile(storagePath, localPath);
          return readFile(localPath);
        },
        writeOutputObject: async (storagePath, bytes, mimeType) => {
          const localPath = join(workDir, "output.png");
          await writeFile(localPath, bytes);
          await uploadStorageFile(storagePath, localPath, mimeType);
        },
        loadSourceAsset: async (assetId) => {
          const [asset] = await db
            .select()
            .from(schema.assets)
            .where(
              and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, generation.workspaceId))
            )
            .limit(1);
          return asset ?? null;
        },
        persistReady: async (ready) => {
          await db.insert(schema.assets).values({
            id: ready.outputAsset.id,
            orgId: ready.outputAsset.orgId,
            workspaceId: ready.outputAsset.workspaceId,
            campaignId: ready.outputAsset.campaignId,
            type: ready.outputAsset.type,
            storagePath: ready.outputAsset.storagePath,
            mimeType: ready.outputAsset.mimeType,
            width: ready.width,
            height: ready.height,
            fileSizeBytes: ready.fileSizeBytes,
            contentHash: ready.outputAsset.contentHash,
            metadata: ready.outputAsset.metadata,
          });
          await db
            .insert(schema.campaignAssetRefs)
            .values({
              campaignId: ready.outputAsset.campaignId,
              assetId: ready.outputAsset.id,
            })
            .onConflictDoNothing();
          const [updated] = await db
            .update(schema.photoSceneGenerations)
            .set({
              status: "ready",
              outputAssetId: ready.outputAsset.id,
              providerKey: ready.providerKey === "none" ? null : ready.providerKey,
              costUsd: ready.costUsd,
              errorCode: null,
              boundedError: null,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.photoSceneGenerations.id, ready.generationId),
                eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId)
              )
            )
            .returning();
          if (!updated?.outputAssetId) {
            throw new Error("Generation READY write did not persist outputAssetId");
          }
        },
        persistFailed: async (failed) => {
          await db
            .update(schema.photoSceneGenerations)
            .set({
              status: "failed",
              errorCode: failed.errorCode,
              boundedError: failed.boundedError,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.photoSceneGenerations.id, failed.generationId),
                eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId)
              )
            );
        },
      },
    });

    emitPhotoSceneOpsEvent({
      event: result.status === "ready" ? "extraction.completed" : "extraction.failed",
      stage: "photo_scene.extract",
      outcome: result.status === "ready" ? "completed" : "failed",
      orgId: generation.orgId,
      workspaceId: generation.workspaceId,
      campaignId: generation.campaignId,
      generationId: generation.id,
      sourceAssetId: generation.sourceAssetId,
      outputAssetId: result.outputAssetId,
      attempt: generation.attemptCount,
      providerKey: provider.key,
      durationMs: Date.now() - started,
      failureClass:
        result.errorCode === "WORKSPACE_ISOLATION" ? "AUTHORIZATION_DENIAL" : result.errorCode,
    });
  } catch (err) {
    const code = isExtractionErrorCategory((err as { code?: string }).code)
      ? (err as { code: "PROVIDER_UNAVAILABLE" }).code
      : "PROVIDER_UNAVAILABLE";
    await db
      .update(schema.photoSceneGenerations)
      .set({
        status: "failed",
        errorCode: code,
        boundedError: userSafeExtractionMessage(code),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.photoSceneGenerations.id, generation.id),
          eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId)
        )
      );
    emitPhotoSceneOpsEvent({
      event: "extraction.failed",
      stage: "photo_scene.extract",
      outcome: "failed",
      orgId: generation.orgId,
      workspaceId: generation.workspaceId,
      campaignId: generation.campaignId,
      generationId: generation.id,
      sourceAssetId: generation.sourceAssetId,
      attempt: generation.attemptCount,
      providerKey: provider.key,
      durationMs: Date.now() - started,
      failureClass: code,
      message: boundPhotoSceneOpsMessage(err),
    });
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function markPhotoSceneExtractJobFailed(data: {
  generationId?: string;
  workspaceId?: string;
  orgId?: string;
  campaignId?: string;
}): Promise<void> {
  if (!data.generationId || !data.workspaceId) return;
  const db = getDb();
  const [generation] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.id, data.generationId),
        eq(schema.photoSceneGenerations.workspaceId, data.workspaceId)
      )
    )
    .limit(1);
  if (!generation || generation.status === "ready" || generation.status === "failed") return;
  await db
    .update(schema.photoSceneGenerations)
    .set({
      status: "failed",
      errorCode: "PROVIDER_UNAVAILABLE",
      boundedError: userSafeExtractionMessage("PROVIDER_UNAVAILABLE"),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.photoSceneGenerations.id, generation.id),
        eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId)
      )
    );
}
