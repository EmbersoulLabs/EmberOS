import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  AiStoryGenerationResultService,
  assertLocalGenerationDuration,
  inspectLocalGenerationMp4,
  materializeLocalGpuGenerationResult,
  validateLocalGenerationMedia,
  type AiStoryVisualEvidenceProvider,
} from "@ceo-agent/agents";
import {
  AiStoryGenerationResultRepository,
  AiStoryLocalGenerationRepository,
  getDb,
  schema,
  validateGenerationResult,
} from "@ceo-agent/db";
import {
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  LOCAL_GPU_WORKER_WORKFLOW,
  localGpuWorkspaceAssetPath,
  mapLocalGpuAudioPolicy,
  positiveDurationSecToMs,
  type AiStoryGenerationResult,
  type AiStoryLocalGenerationPackage,
  type LocalGpuEnvironment,
} from "@ceo-agent/shared";
import { compileAiStoryAudioQcExpectation } from "@ceo-agent/shared/server";
import { downloadStorageBytes, uploadStorageBytesImmutable } from "./storage";

type WorkerDb = ReturnType<typeof getDb>;
type ReleaseRow = typeof schema.aiStorySceneReleaseStates.$inferSelect;

const reportedPermanentFailures = new Set<string>();

/** Visual product identity and speech stay with the human reviewer. */
const measuredMediaOnly: AiStoryVisualEvidenceProvider = {
  providerId: "local-gpu-measured-media",
  contractVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  analyze: async () => [],
};

function contentHashOf(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function permanentFinalizationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "LOCAL_GENERATION_MEDIA_DURATION_OUT_OF_RANGE"
    || message === "LOCAL_GENERATION_MEDIA_TYPE_INVALID"
    || message === "LOCAL_GENERATION_NATIVE_AUDIO_REQUIRED"
    || message === "LOCAL_GPU_RESULT_HASH_MISMATCH"
    || message === "LOCAL_GPU_RESULT_SIZE_MISMATCH"
    || message === "LOCAL_GPU_RESULT_AUDIO_MISSING"
    || message === "LOCAL_GPU_RESULT_AUDIO_EXPECTATION_UNSUPPORTED"
    || message === "LOCAL_GPU_RESULT_STORAGE_CONFLICT";
}

async function findAcceptedLocalGpuResult(
  db: WorkerDb,
  pkg: AiStoryLocalGenerationPackage,
  jobId: string,
): Promise<AiStoryGenerationResult | null> {
  const rows = await db
    .select()
    .from(schema.aiStoryGenerationResults)
    .where(and(
      eq(schema.aiStoryGenerationResults.workspaceId, pkg.workspaceId),
      eq(schema.aiStoryGenerationResults.executionPlanId, pkg.executionPlanId),
      eq(schema.aiStoryGenerationResults.sceneExecutionId, pkg.sceneExecutionId),
      eq(schema.aiStoryGenerationResults.sourceKind, "LOCAL_GPU_WORKER"),
    ));
  for (const row of rows) {
    const result = validateGenerationResult(row.result);
    if (
      result.inputAuthority.localPackageId === pkg.packageId
      && "localGpuJobId" in result.inputAuthority
      && result.inputAuthority.localGpuJobId === jobId
    ) {
      return result;
    }
  }
  return null;
}

async function loadMatchingUpload(
  db: WorkerDb,
  pkg: AiStoryLocalGenerationPackage,
  expectedHash: string,
): Promise<{ asset: typeof schema.assets.$inferSelect; bytes: Buffer }> {
  const rows = await db
    .select()
    .from(schema.assets)
    .where(and(
      eq(schema.assets.orgId, pkg.organizationId),
      eq(schema.assets.workspaceId, pkg.workspaceId),
      eq(schema.assets.campaignId, pkg.campaignId),
      isNull(schema.assets.deletedAt),
    ));
  const uploadPrefix = `${pkg.workspaceId}/ai-story/local-generation/${pkg.packageId}/`;
  const candidates = rows.filter((asset) => {
    const metadata = asset.metadata ?? {};
    return metadata.localGenerationPackageId === pkg.packageId
      && metadata.executionPlanId === pkg.executionPlanId
      && metadata.localGenerationUnitId === pkg.unitId
      && (asset.storagePath.startsWith(uploadPrefix) || asset.storagePath.startsWith(`${pkg.workspaceId}/ai-story/local-gpu/`));
  });
  for (const asset of candidates) {
    let bytes: Buffer;
    try {
      bytes = await downloadStorageBytes(asset.storagePath);
    } catch {
      continue;
    }
    if (contentHashOf(bytes) === expectedHash) return { asset, bytes };
  }
  throw new Error("LOCAL_GPU_RESULT_ASSET_NOT_FOUND");
}

async function persistMeasuredReview(
  pkg: AiStoryLocalGenerationPackage,
  result: AiStoryGenerationResult,
  actorUserId: string,
  probe: Awaited<ReturnType<typeof validateLocalGenerationMedia>>,
): Promise<void> {
  const results = new AiStoryGenerationResultRepository();
  if (await results.latestQc(pkg.workspaceId, result.generationResultId)) return;
  if (await results.decision(result.generationResultId)) return;
  const expectationKind = "audioQcExpectationKind" in pkg ? pkg.audioQcExpectationKind : undefined;
  if (expectationKind !== "NO_DIALOGUE_WITH_AMBIENT_AUDIO") {
    throw new Error("LOCAL_GPU_RESULT_AUDIO_EXPECTATION_UNSUPPORTED");
  }
  const expectation = compileAiStoryAudioQcExpectation({
    applicability: "REQUIRED",
    expectationKind,
    orgId: pkg.organizationId,
    workspaceId: pkg.workspaceId,
    storyId: pkg.storyId,
    storyVersionId: pkg.storyVersionId,
    sceneExecutionId: pkg.sceneExecutionId,
    speakerRole: "NONE",
  });
  const evidence = {
    orgId: pkg.organizationId,
    workspaceId: pkg.workspaceId,
    storyId: pkg.storyId,
    storyVersionId: pkg.storyVersionId,
    sceneExecutionId: pkg.sceneExecutionId,
    mediaAssetId: result.media.assetId,
    generationResultId: result.generationResultId,
    providerAttemptId: null,
    mediaFacts: {
      hasVideoStream: true,
      hasAudioStream: probe.hasAudio,
      videoDurationMs: probe.durationMs,
      audioDurationMs: probe.audioDurationMs ?? null,
      audioCodec: probe.audioCodec ?? null,
      sampleRate: probe.audioSampleRate ?? null,
      channelCount: probe.audioChannelCount ?? null,
      decodable: true,
      mediaContentHash: result.media.contentHash,
    },
    nativeDurationToleranceMs: null,
    executedDialogueAuthorityId: null,
    executedDialogueFingerprint: null,
    durableVoiceDna: null,
    semanticInstructionFingerprint: null,
    ttsRequest: null,
    ttsResult: null,
    finalMix: null,
    detachedTtsUsed: false,
    humanReview: null,
  };
  const evaluation = await new AiStoryGenerationResultService().evaluateLocal(
    result,
    pkg,
    measuredMediaOnly,
    actorUserId,
    { expectation, evidence },
  );
  console.info(
    `[local-gpu] post-qc ${evaluation.evaluation.aggregateStatus} for ${result.generationResultId}; autoApproved=${evaluation.evaluation.autoApproved}`,
  );
}

/**
 * Idempotent completion for one Desktop COMPLETED upload.
 * Reads the existing object, validates it, then persists the generation result and review handoff.
 * Does not submit a job and does not approve the scene.
 */
export async function ingestCompletedLocalGpuUpload(input: {
  readonly db: WorkerDb;
  readonly release: ReleaseRow;
  readonly pkg: AiStoryLocalGenerationPackage;
  readonly jobId: string;
  readonly environment: LocalGpuEnvironment;
  readonly desktop: {
    readonly contentHash: string;
    readonly durationMs: number;
    readonly fps: number;
    readonly hasAudio: boolean;
    readonly byteSize: number | null;
  };
}): Promise<void> {
  const existing = await findAcceptedLocalGpuResult(input.db, input.pkg, input.jobId);
  if (existing) {
    const bytes = await downloadStorageBytes(existing.media.storagePath);
    if (contentHashOf(bytes) !== existing.media.contentHash) {
      throw new Error("LOCAL_GPU_RESULT_HASH_MISMATCH");
    }
    const probe = await validateLocalGenerationMedia(bytes, existing.media.contentHash, input.pkg.generateAudio);
    await persistMeasuredReview(input.pkg, existing, input.release.releasedBy!, probe);
    return;
  }
  const { asset, bytes } = await loadMatchingUpload(input.db, input.pkg, input.desktop.contentHash);
  const inspected = inspectLocalGenerationMp4(bytes);
  if (inspected.contentHash !== input.desktop.contentHash) {
    throw new Error("LOCAL_GPU_RESULT_HASH_MISMATCH");
  }
  if (input.desktop.byteSize !== null && input.desktop.byteSize !== bytes.length) {
    throw new Error("LOCAL_GPU_RESULT_SIZE_MISMATCH");
  }
  const probe = await validateLocalGenerationMedia(bytes, inspected.contentHash, input.pkg.generateAudio);
  const plannedDurationMs = positiveDurationSecToMs(input.pkg.durationSec);
  assertLocalGenerationDuration({
    actualSec: probe.durationMs / 1000,
    targetSec: plannedDurationMs / 1000,
  });
  if (!probe.hasAudio && input.desktop.hasAudio) {
    throw new Error("LOCAL_GPU_RESULT_AUDIO_MISSING");
  }
  const fps = probe.frameRate ?? input.desktop.fps;
  if (!fps) throw new Error("LOCAL_GPU_RESULT_EVIDENCE_INCOMPLETE");
  const canonicalPath = localGpuWorkspaceAssetPath(input.pkg.workspaceId, inspected.contentHash);
  const copied = await uploadStorageBytesImmutable(canonicalPath, bytes, "video/mp4");
  if (copied === "already_exists") {
    const stored = await downloadStorageBytes(canonicalPath);
    if (contentHashOf(stored) !== inspected.contentHash) {
      throw new Error("LOCAL_GPU_RESULT_STORAGE_CONFLICT");
    }
  }
  const now = new Date();
  await input.db
    .update(schema.assets)
    .set({
      status: "ready",
      contentHash: inspected.contentHash,
      fileSizeBytes: bytes.length,
      durationSec: String(probe.durationMs / 1000),
      width: probe.width,
      height: probe.height,
      storagePath: canonicalPath,
      mimeType: "video/mp4",
      updatedAt: now,
      metadata: {
        ...(asset.metadata ?? {}),
        localGpuJobId: input.jobId,
        measuredFps: fps,
        plannedDurationMs,
        actualDurationMs: probe.durationMs,
        desktopDurationMs: input.desktop.durationMs,
      },
    })
    .where(and(
      eq(schema.assets.id, asset.id),
      eq(schema.assets.workspaceId, input.pkg.workspaceId),
      eq(schema.assets.orgId, input.pkg.organizationId),
    ));
  const packageExpectation = "audioQcExpectationKind" in input.pkg ? input.pkg.audioQcExpectationKind : undefined;
  const audioPolicy = mapLocalGpuAudioPolicy({
    generateAudio: input.pkg.generateAudio,
    audioBlocked: input.pkg.audioBlocked,
    expectationKind: packageExpectation,
  });
  const [scene] = await input.db
    .select()
    .from(schema.aiStorySceneExecutions)
    .where(eq(schema.aiStorySceneExecutions.id, input.pkg.sceneExecutionId))
    .limit(1);
  const [plan] = await input.db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, input.pkg.executionPlanId))
    .limit(1);
  if (!scene || !plan || !input.release.releasedBy) throw new Error("GENERATION_RESULT_UNIT_MISMATCH");
  const materialized = materializeLocalGpuGenerationResult({
    package: input.pkg,
    serverEnvironment: input.environment,
    jobId: input.jobId,
    workflow: LOCAL_GPU_WORKER_WORKFLOW,
    audioPolicy,
    plannedDurationMs,
    animationPackageId: plan.animationPackageId,
    sceneId: scene.sceneId,
    sceneOrder: scene.sceneOrder,
    assetId: asset.id,
    contentHash: inspected.contentHash,
    byteSize: bytes.length,
    actualDurationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps,
    hasAudio: probe.hasAudio,
    createdAt: (asset.createdAt ?? now).toISOString(),
  });
  const accepted = await new AiStoryGenerationResultRepository(input.db).accept(materialized);
  await persistMeasuredReview(input.pkg, accepted.result, input.release.releasedBy, probe);
}

/** Completes result-marked LOCAL_GPU releases that never persisted a generation result. */
export async function recoverCompletedLocalGpuResults(input: {
  readonly db: WorkerDb;
  readonly environment: LocalGpuEnvironment;
  readonly readResult: (jobId: string, release: ReleaseRow, pkg: AiStoryLocalGenerationPackage) => Promise<{
    contentHash: string;
    durationMs: number;
    fps: number;
    hasAudio: boolean;
    byteSize: number | null;
  }>;
}): Promise<void> {
  const releases = await input.db
    .select()
    .from(schema.aiStorySceneReleaseStates)
    .where(and(
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    ));
  const packages = new AiStoryLocalGenerationRepository(input.db);
  for (const release of releases) {
    const gate = release.gateProviderAttemptId;
    if (!gate?.startsWith("result:") || !release.currentLocalGenerationPackageId || !release.releasedBy) continue;
    const jobId = gate.slice("result:".length);
    if (reportedPermanentFailures.has(jobId)) continue;
    const pkg = await packages.getExecutablePackage({
      workspaceId: release.workspaceId,
      executionPlanId: release.executionPlanId,
      packageId: release.currentLocalGenerationPackageId,
    });
    if (!pkg) continue;
    try {
      const desktop = await input.readResult(jobId, release, pkg);
      await ingestCompletedLocalGpuUpload({
        db: input.db,
        release,
        pkg,
        jobId,
        environment: input.environment,
        desktop,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (permanentFinalizationFailure(error)) reportedPermanentFailures.add(jobId);
      console.warn(`[local-gpu] result finalization pending for ${jobId}: ${message}`);
    }
  }
}
