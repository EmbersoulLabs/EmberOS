import { and, desc, eq } from "drizzle-orm";
import {
  findInflightPhotoSceneMarketing,
  getBusinessProfileByWorkspace,
  getDb,
  getOfficialSceneVersion,
  getPhotoSceneGeneration,
  insertPhotoSceneGeneration,
  latestCampaignPhotoSceneExtraction,
  latestCampaignPhotoSceneMarketing,
  schema,
} from "@ceo-agent/db";
import { enqueuePhotoSceneCompose } from "@ceo-agent/queue";
import {
  fingerprintPhotoSceneMarketingIdentityV1,
  fingerprintPhotoSceneSnapshot,
} from "@ceo-agent/shared/photo-scene-marketing.server";
import {
  PhotoSceneAssetAuthorityError,
  PhotoSceneFrozenSceneSelectionV1Schema,
  PhotoSceneMarketingError,
  PhotoSceneOfficialSceneError,
  assertPhotoSceneGenerationAccess,
  emitPhotoSceneOpsEvent,
  evaluateMarketingRetry,
  extractBoundedMarketingCopy,
  freezeBrandSnapshot,
  freezeMarketingImageInput,
  freezeMarketingPackageSnapshot,
  joinInflightMarketing,
  marketingFingerprintIdentity,
  readPhotoSceneMetadata,
  userSafeMarketingMessage,
} from "@ceo-agent/shared";
import { mapOfficialSceneVersionRow } from "@/lib/photo-scene-official-scenes";
import {
  mapPhotoSceneApiError,
  toGenerationDto,
  type PhotoSceneGenerationClientDto,
} from "@/lib/photo-scene-extraction";

type Db = ReturnType<typeof getDb>;

export { mapPhotoSceneApiError, toGenerationDto };
export type { PhotoSceneGenerationClientDto };

function mapMarketingApiError(error: unknown): { message: string; code: string; status: number } {
  if (error instanceof PhotoSceneMarketingError) {
    const status = error.code === "WORKSPACE_ISOLATION" ? 403 : 400;
    return { message: userSafeMarketingMessage(error.code), code: error.code, status };
  }
  if (error instanceof PhotoSceneOfficialSceneError) {
    return {
      message: userSafeMarketingMessage("SCENE_NOT_FOUND"),
      code: error.code,
      status: error.code === "WORKSPACE_ISOLATION" ? 403 : 400,
    };
  }
  try {
    return mapPhotoSceneApiError(error);
  } catch {
    if (error instanceof PhotoSceneAssetAuthorityError) {
      return { message: userSafeMarketingMessage("WORKSPACE_ISOLATION"), code: error.code, status: 403 };
    }
    throw error;
  }
}

export { mapMarketingApiError };

export async function requestMarketingImage(
  db: Db,
  input: {
    campaign: typeof schema.campaigns.$inferSelect;
    userId: string;
    generateAgain?: boolean;
  }
): Promise<{ dto: PhotoSceneGenerationClientDto; status: number }> {
  const extraction = await latestCampaignPhotoSceneExtraction(db, {
    workspaceId: input.campaign.workspaceId,
    campaignId: input.campaign.id,
  });
  if (!extraction || extraction.status !== "ready" || !extraction.outputAssetId) {
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "A ready extracted product is required");
  }
  const [extracted] = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.id, extraction.outputAssetId),
        eq(schema.assets.workspaceId, input.campaign.workspaceId)
      )
    )
    .limit(1);
  if (!extracted) {
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "Extracted product asset is missing");
  }
  const role = readPhotoSceneMetadata(extracted.metadata ?? undefined)?.role;
  if (role !== "extracted_product") {
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "A ready extracted product is required");
  }

  const [selection] = await db
    .select()
    .from(schema.photoSceneSceneSelections)
    .where(
      and(
        eq(schema.photoSceneSceneSelections.workspaceId, input.campaign.workspaceId),
        eq(schema.photoSceneSceneSelections.campaignId, input.campaign.id)
      )
    )
    .limit(1);
  if (!selection) {
    throw new PhotoSceneMarketingError("SCENE_NOT_FOUND", "Save an official scene placement first");
  }
  const frozen = PhotoSceneFrozenSceneSelectionV1Schema.parse(selection.frozenSelection);
  const catalog = await getOfficialSceneVersion(db, frozen.sceneId, frozen.sceneVersion);
  if (!catalog) {
    throw new PhotoSceneMarketingError("SCENE_VERSION_NOT_AVAILABLE", "Frozen official scene version was not found");
  }
  const scene = mapOfficialSceneVersionRow(catalog);

  const profile = await getBusinessProfileByWorkspace(input.campaign.workspaceId);
  const brandSnapshot = freezeBrandSnapshot({
    profileId: profile?.id ?? null,
    profileVersion: profile?.version ?? null,
    companyName: profile?.companyName ?? null,
    logo: profile?.logo ?? null,
    brandColors: profile?.brandColors ?? [],
    brandFonts: profile?.brandFonts ?? [],
  });
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.campaignId, input.campaign.id), eq(schema.tasks.workspaceId, input.campaign.workspaceId))
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1);
  const copy = extractBoundedMarketingCopy(task?.strategyJson ?? input.campaign.strategyJson ?? {});
  const marketingSnapshot = freezeMarketingPackageSnapshot({
    campaignId: input.campaign.id,
    taskId: task?.id ?? null,
    campaignName: input.campaign.name,
    campaignBrief: input.campaign.campaignBrief,
    hook: copy.hook,
    cta: copy.cta,
  });
  const brandSnapshotHash = fingerprintPhotoSceneSnapshot(brandSnapshot);
  const marketingSnapshotHash = fingerprintPhotoSceneSnapshot(marketingSnapshot);
  const capsule = freezeMarketingImageInput({
    orgId: input.campaign.orgId,
    workspaceId: input.campaign.workspaceId,
    campaignId: input.campaign.id,
    extracted,
    scene,
    frozenScene: frozen,
    brandSnapshot,
    brandSnapshotHash,
    marketingSnapshot,
    marketingSnapshotHash,
  });
  const fingerprint = fingerprintPhotoSceneMarketingIdentityV1(marketingFingerprintIdentity(capsule));

  if (!input.generateAgain) {
    const inflight = await findInflightPhotoSceneMarketing(db, {
      workspaceId: input.campaign.workspaceId,
      fingerprint,
    });
    const join = joinInflightMarketing({
      workspaceId: input.campaign.workspaceId,
      fingerprint,
      candidate: inflight,
    });
    if (join.join && inflight) {
      return { dto: await toGenerationDto(db, inflight), status: 200 };
    }
  } else {
    const inflight = await findInflightPhotoSceneMarketing(db, {
      workspaceId: input.campaign.workspaceId,
      fingerprint,
    });
    if (inflight) {
      return { dto: await toGenerationDto(db, inflight), status: 200 };
    }
  }

  try {
    const created = await insertPhotoSceneGeneration(db, {
      orgId: input.campaign.orgId,
      workspaceId: input.campaign.workspaceId,
      campaignId: input.campaign.id,
      operation: "marketing_image",
      status: "queued",
      sourceAssetId: capsule.extractedProductAssetId,
      sourceContentHash: capsule.extractedProductContentHash,
      inputCapsule: capsule,
      inputFingerprint: fingerprint,
      attemptCount: 1,
      createdBy: input.userId,
      providerKey: "deterministic_compositor",
      costUsd: "0",
    });
    await enqueuePhotoSceneCompose({
      generationId: created.id,
      workspaceId: created.workspaceId,
      orgId: created.orgId,
      campaignId: created.campaignId,
      attempt: created.attemptCount,
    });
    emitPhotoSceneOpsEvent({
      event: input.generateAgain ? "generate_again.created" : "composition.created",
      stage: "photo_scene.compose",
      outcome: input.generateAgain ? "generated_again" : "enqueued",
      orgId: created.orgId,
      workspaceId: created.workspaceId,
      campaignId: created.campaignId,
      generationId: created.id,
      sourceAssetId: created.sourceAssetId,
      attempt: created.attemptCount,
      providerKey: "deterministic_compositor",
    });
    return { dto: await toGenerationDto(db, created), status: 202 };
  } catch (err) {
    const raced = await findInflightPhotoSceneMarketing(db, {
      workspaceId: input.campaign.workspaceId,
      fingerprint,
    });
    if (raced) return { dto: await toGenerationDto(db, raced), status: 200 };
    throw err;
  }
}

export async function retryMarketingComposition(
  db: Db,
  input: { generationId: string; workspaceId: string; orgId: string }
): Promise<PhotoSceneGenerationClientDto> {
  const generation = await getPhotoSceneGeneration(db, input.generationId, input.workspaceId);
  if (!generation) {
    throw new PhotoSceneMarketingError("WORKSPACE_ISOLATION", "Generation was not found");
  }
  assertPhotoSceneGenerationAccess({
    generation,
    expectedOrgId: input.orgId,
    expectedWorkspaceId: input.workspaceId,
  });
  const decision = evaluateMarketingRetry({
    generation,
    expectedWorkspaceId: input.workspaceId,
    expectedFingerprint: generation.inputFingerprint,
    expectedExtractedAssetId: generation.sourceAssetId,
    expectedExtractedHash: generation.sourceContentHash,
  });
  if (!decision.ok) {
    if (generation.status === "queued" || generation.status === "processing") {
      return toGenerationDto(db, generation);
    }
    if (generation.status === "ready") {
      return toGenerationDto(db, generation);
    }
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "This marketing image cannot be retried");
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
    throw new PhotoSceneMarketingError("OUTPUT_FINALIZATION_FAILED", "Retry could not be persisted");
  }
  await enqueuePhotoSceneCompose({
    generationId: updated.id,
    workspaceId: updated.workspaceId,
    orgId: updated.orgId,
    campaignId: updated.campaignId,
    attempt: updated.attemptCount,
  });
  emitPhotoSceneOpsEvent({
    event: "composition.retry",
    stage: "photo_scene.compose",
    outcome: "retrying",
    orgId: updated.orgId,
    workspaceId: updated.workspaceId,
    campaignId: updated.campaignId,
    generationId: updated.id,
    sourceAssetId: updated.sourceAssetId,
    attempt: updated.attemptCount,
    providerKey: "deterministic_compositor",
  });
  return toGenerationDto(db, updated);
}

export async function readLatestCampaignMarketing(
  db: Db,
  input: { campaignId: string; workspaceId: string; orgId: string }
): Promise<PhotoSceneGenerationClientDto | null> {
  const generation = await latestCampaignPhotoSceneMarketing(db, {
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
