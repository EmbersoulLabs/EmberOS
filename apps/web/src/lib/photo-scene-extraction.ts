import { and, eq } from "drizzle-orm";
import {
  findInflightPhotoSceneExtraction,
  findReusablePhotoSceneExtraction,
  getDb,
  getPhotoSceneGeneration,
  insertPhotoSceneGeneration,
  latestCampaignPhotoSceneExtraction,
  schema,
} from "@ceo-agent/db";
import { enqueuePhotoSceneExtract } from "@ceo-agent/queue";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "@ceo-agent/shared/photo-scene-extraction.server";
import {
  PhotoSceneAssetAuthorityError,
  PhotoSceneExtractionError,
  assertPhotoSceneGenerationAccess,
  assertSameWorkspaceCampaignBind,
  emitPhotoSceneOpsEvent,
  evaluateExtractionRetry,
  evaluateExtractionReuse,
  extractionFingerprintIdentity,
  freezePhotoSceneExtractionInput,
  joinInflightExtraction,
  photoSceneMetadata,
  readPhotoSceneMetadata,
  userSafeExtractionMessage,
  type PhotoSceneExtractionInputCapsuleV1,
  type PhotoSceneGenerationSnapshot,
} from "@ceo-agent/shared";
import { finalizeStoredSourceAssetIdentity } from "@/lib/source-asset-content-hash";
import { signPrivateCampaignAsset } from "@/lib/asset-signed-delivery";

type Db = ReturnType<typeof getDb>;

function asSnapshot(
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
    inputCapsule: row.inputCapsule as PhotoSceneExtractionInputCapsuleV1,
    inputFingerprint: row.inputFingerprint,
    outputAssetId: row.outputAssetId,
    providerKey: row.providerKey,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
    boundedError: row.boundedError,
    costUsd: row.costUsd,
  };
}

export type PhotoSceneGenerationClientDto = {
  id: string;
  campaignId: string;
  operation: string;
  status: string;
  sourceAssetId: string;
  sourceContentHash: string;
  outputAssetId: string | null;
  attemptCount: number;
  errorCode: string | null;
  boundedError: string | null;
  reused: boolean;
  costUsd: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  previewUrl?: string;
  downloadUrl?: string;
};

export async function toGenerationDto(
  db: Db,
  row: typeof schema.photoSceneGenerations.$inferSelect,
  options?: { reused?: boolean }
): Promise<PhotoSceneGenerationClientDto> {
  const dto: PhotoSceneGenerationClientDto = {
    id: row.id,
    campaignId: row.campaignId,
    operation: row.operation,
    status: row.status,
    sourceAssetId: row.sourceAssetId,
    sourceContentHash: row.sourceContentHash,
    outputAssetId: row.outputAssetId,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
    boundedError: row.boundedError,
    reused: options?.reused === true,
    costUsd: row.costUsd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
  if (row.status === "ready" && row.outputAssetId) {
    const [output] = await db
      .select()
      .from(schema.assets)
      .where(
        and(eq(schema.assets.id, row.outputAssetId), eq(schema.assets.workspaceId, row.workspaceId))
      )
      .limit(1);
    if (output) {
      try {
        dto.previewUrl = await signPrivateCampaignAsset({
          workspaceId: row.workspaceId,
          storagePath: output.storagePath,
        });
        dto.downloadUrl = await signPrivateCampaignAsset({
          workspaceId: row.workspaceId,
          storagePath: output.storagePath,
          download: row.operation === "marketing_image" ? "marketing-image.png" : "extracted-product.png",
        });
      } catch {
        /* preview is best-effort; persisted identity remains READY */
      }
    }
  }
  return dto;
}

async function loadOutputAsset(
  db: Db,
  workspaceId: string,
  outputAssetId: string | null
) {
  if (!outputAssetId) return null;
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, outputAssetId), eq(schema.assets.workspaceId, workspaceId)))
    .limit(1);
  return asset ?? null;
}

export async function requestProductExtraction(
  db: Db,
  input: {
    campaign: typeof schema.campaigns.$inferSelect;
    sourceAssetId: string;
    userId: string;
  }
): Promise<{ dto: PhotoSceneGenerationClientDto; status: number }> {
  const [source] = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.id, input.sourceAssetId),
        eq(schema.assets.workspaceId, input.campaign.workspaceId)
      )
    )
    .limit(1);
  if (!source) {
    throw new PhotoSceneExtractionError("INVALID_SOURCE", "Source asset was not found");
  }

  assertSameWorkspaceCampaignBind({
    asset: source,
    campaign: {
      id: input.campaign.id,
      orgId: input.campaign.orgId,
      workspaceId: input.campaign.workspaceId,
    },
  });

  const finalized = await finalizeStoredSourceAssetIdentity(db, source);
  const capsule = freezePhotoSceneExtractionInput({
    orgId: input.campaign.orgId,
    workspaceId: input.campaign.workspaceId,
    campaignId: input.campaign.id,
    source: finalized,
  });
  const fingerprint = fingerprintPhotoSceneExtractionIdentityV1(
    extractionFingerprintIdentity(capsule)
  );

  const photoScene = readPhotoSceneMetadata(finalized.metadata ?? undefined);
  if (!photoScene) {
    await db
      .update(schema.assets)
      .set({
        metadata: {
          ...(finalized.metadata ?? {}),
          photoScene: photoSceneMetadata("product_source"),
        },
      })
      .where(
        and(eq(schema.assets.id, finalized.id), eq(schema.assets.workspaceId, finalized.workspaceId))
      );
  }
  await db
    .insert(schema.campaignAssetRefs)
    .values({ campaignId: input.campaign.id, assetId: finalized.id })
    .onConflictDoNothing();

  const ready = await findReusablePhotoSceneExtraction(db, {
    workspaceId: input.campaign.workspaceId,
    fingerprint,
  });
  if (ready) {
    const outputAsset = await loadOutputAsset(db, ready.workspaceId, ready.outputAssetId);
    const decision = evaluateExtractionReuse({
      workspaceId: input.campaign.workspaceId,
      fingerprint,
      sourceContentHash: capsule.sourceContentHash,
      candidate: { generation: asSnapshot(ready), outputAsset },
    });
    if (decision.reuse) {
      emitPhotoSceneOpsEvent({
        event: "extraction.reused",
        stage: "photo_scene.extract",
        outcome: "reused",
        orgId: input.campaign.orgId,
        workspaceId: input.campaign.workspaceId,
        campaignId: input.campaign.id,
        generationId: ready.id,
        sourceAssetId: capsule.sourceAssetId,
        outputAssetId: ready.outputAssetId ?? undefined,
      });
      return { dto: await toGenerationDto(db, ready, { reused: true }), status: 200 };
    }
  }

  const inflight = await findInflightPhotoSceneExtraction(db, {
    workspaceId: input.campaign.workspaceId,
    fingerprint,
  });
  const join = joinInflightExtraction({
    workspaceId: input.campaign.workspaceId,
    fingerprint,
    candidate: inflight ? asSnapshot(inflight) : null,
  });
  if (join.join && inflight) {
    return { dto: await toGenerationDto(db, inflight, { reused: false }), status: 200 };
  }

  try {
    const created = await insertPhotoSceneGeneration(db, {
      orgId: input.campaign.orgId,
      workspaceId: input.campaign.workspaceId,
      campaignId: input.campaign.id,
      operation: "product_extraction",
      status: "queued",
      sourceAssetId: capsule.sourceAssetId,
      sourceContentHash: capsule.sourceContentHash,
      inputCapsule: capsule,
      inputFingerprint: fingerprint,
      attemptCount: 1,
      createdBy: input.userId,
    });
    await enqueuePhotoSceneExtract({
      generationId: created.id,
      workspaceId: created.workspaceId,
      orgId: created.orgId,
      campaignId: created.campaignId,
      attempt: created.attemptCount,
    });
    return { dto: await toGenerationDto(db, created), status: 202 };
  } catch (err) {
    const raced = await findInflightPhotoSceneExtraction(db, {
      workspaceId: input.campaign.workspaceId,
      fingerprint,
    });
    if (raced) {
      return { dto: await toGenerationDto(db, raced), status: 200 };
    }
    const reusedAfterRace = await findReusablePhotoSceneExtraction(db, {
      workspaceId: input.campaign.workspaceId,
      fingerprint,
    });
    if (reusedAfterRace) {
      return { dto: await toGenerationDto(db, reusedAfterRace, { reused: true }), status: 200 };
    }
    throw err;
  }
}

export async function retryProductExtraction(
  db: Db,
  input: {
    generationId: string;
    workspaceId: string;
    orgId: string;
  }
): Promise<PhotoSceneGenerationClientDto> {
  const generation = await getPhotoSceneGeneration(db, input.generationId, input.workspaceId);
  if (!generation) {
    throw new PhotoSceneExtractionError("WORKSPACE_ISOLATION", "Generation was not found");
  }
  assertPhotoSceneGenerationAccess({
    generation,
    expectedOrgId: input.orgId,
    expectedWorkspaceId: input.workspaceId,
  });
  const decision = evaluateExtractionRetry({
    generation: asSnapshot(generation),
    expectedWorkspaceId: input.workspaceId,
    expectedFingerprint: generation.inputFingerprint,
    expectedSourceAssetId: generation.sourceAssetId,
    expectedSourceContentHash: generation.sourceContentHash,
  });
  if (!decision.ok) {
    if (generation.status === "queued" || generation.status === "processing") {
      return toGenerationDto(db, generation);
    }
    if (generation.status === "ready") {
      return toGenerationDto(db, generation, { reused: true });
    }
    throw new PhotoSceneExtractionError("INVALID_SOURCE", "This extraction cannot be retried");
  }

  const [updated] = await db
    .update(schema.photoSceneGenerations)
    .set({
      status: "queued",
      attemptCount: generation.attemptCount + 1,
      errorCode: null,
      boundedError: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.photoSceneGenerations.id, generation.id),
        eq(schema.photoSceneGenerations.workspaceId, generation.workspaceId),
        eq(schema.photoSceneGenerations.inputFingerprint, generation.inputFingerprint),
        eq(schema.photoSceneGenerations.sourceAssetId, generation.sourceAssetId),
        eq(schema.photoSceneGenerations.sourceContentHash, generation.sourceContentHash)
      )
    )
    .returning();
  if (!updated) {
    throw new PhotoSceneExtractionError("OUTPUT_FINALIZATION_FAILED", "Retry could not be persisted");
  }
  await enqueuePhotoSceneExtract({
    generationId: updated.id,
    workspaceId: updated.workspaceId,
    orgId: updated.orgId,
    campaignId: updated.campaignId,
    attempt: updated.attemptCount,
  });
  emitPhotoSceneOpsEvent({
    event: "extraction.retry",
    stage: "photo_scene.extract",
    outcome: "retrying",
    orgId: updated.orgId,
    workspaceId: updated.workspaceId,
    campaignId: updated.campaignId,
    generationId: updated.id,
    sourceAssetId: updated.sourceAssetId,
    attempt: updated.attemptCount,
  });
  return toGenerationDto(db, updated);
}

export async function readProductExtraction(
  db: Db,
  input: { generationId: string; workspaceId: string; orgId: string }
): Promise<PhotoSceneGenerationClientDto> {
  const generation = await getPhotoSceneGeneration(db, input.generationId, input.workspaceId);
  if (!generation) {
    throw new PhotoSceneExtractionError("WORKSPACE_ISOLATION", "Generation was not found");
  }
  assertPhotoSceneGenerationAccess({
    generation,
    expectedOrgId: input.orgId,
    expectedWorkspaceId: input.workspaceId,
  });
  return toGenerationDto(db, generation);
}

export async function readLatestCampaignExtraction(
  db: Db,
  input: { campaignId: string; workspaceId: string; orgId: string }
): Promise<PhotoSceneGenerationClientDto | null> {
  const generation = await latestCampaignPhotoSceneExtraction(db, {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
  });
  if (!generation) return null;
  assertPhotoSceneGenerationAccess({
    generation,
    expectedOrgId: input.orgId,
    expectedWorkspaceId: input.workspaceId,
  });
  return toGenerationDto(db, generation);
}

export function mapPhotoSceneApiError(error: unknown): {
  message: string;
  code: string;
  status: number;
} {
  if (error instanceof PhotoSceneExtractionError) {
    const status = error.code === "WORKSPACE_ISOLATION" ? 403 : 400;
    return {
      message: userSafeExtractionMessage(error.code),
      code: error.code,
      status,
    };
  }
  if (error instanceof PhotoSceneAssetAuthorityError) {
    const isolation = error.code === "WORKSPACE_ISOLATION" || error.code === "CAMPAIGN_ISOLATION";
    return {
      message: userSafeExtractionMessage(isolation ? "WORKSPACE_ISOLATION" : "INVALID_SOURCE"),
      code: error.code,
      status: isolation ? 403 : 400,
    };
  }
  throw error;
}
