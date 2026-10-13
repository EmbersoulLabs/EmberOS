import {
  LocalGpuGenerationInputAuthoritySchema,
  localGpuResultStoragePath,
  type LocalGpuGenerationInputAuthority,
} from "@ceo-agent/shared";
import type { AiStoryGenerationResult } from "@ceo-agent/shared";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

const localSourceAuthorityShape = {
  parse(value: unknown): { localSourceAuthorityId: string; localSourceAuthorityFingerprint: string; workspaceId: string } | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const localSourceAuthorityId = record.localSourceAuthorityId;
    const localSourceAuthorityFingerprint = record.localSourceAuthorityFingerprint;
    const workspaceId = record.workspaceId;
    if (typeof localSourceAuthorityId !== "string" || typeof localSourceAuthorityFingerprint !== "string" || typeof workspaceId !== "string") {
      return null;
    }
    return { localSourceAuthorityId, localSourceAuthorityFingerprint, workspaceId };
  },
};

export type LocalGpuStoredPackageLineage = {
  packageId: string;
  packageFingerprint: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  executionPlanId: string;
  runtimeAuthorizationId: string;
  sceneExecutionId: string;
  unitId: string;
  characterAuthority: unknown;
  productAuthority: unknown;
  references: unknown;
  generationMode: unknown;
  generateAudio: boolean;
  audioBlocked: boolean;
  sourceAuthority: unknown;
  planningAuthority: unknown;
};

export type LocalGpuStoredReleaseLineage = {
  executionMode: string;
  releaseState: string;
  orgId: string;
  workspaceId: string;
  executionPlanId: string;
  sceneExecutionId: string;
  runtimeAuthorizationId: string;
  currentLocalGenerationPackageId: string | null;
};

export type LocalGpuStoredAssetLineage = {
  status: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  contentHash: string | null;
  storagePath: string | null;
  byteSize: number | null;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function expectedLocalGpuGenerationInputAuthority(input: {
  authority: LocalGpuGenerationInputAuthority;
  packageRow: LocalGpuStoredPackageLineage;
}): LocalGpuGenerationInputAuthority {
  return LocalGpuGenerationInputAuthoritySchema.parse({
    localGpuEnvironment: input.authority.localGpuEnvironment,
    localGpuJobId: input.authority.localGpuJobId,
    localGpuWorkflow: input.authority.localGpuWorkflow,
    audioPolicy: input.authority.audioPolicy,
    plannedDurationMs: input.authority.plannedDurationMs,
    actualDurationMs: input.authority.actualDurationMs,
    fps: input.authority.fps,
    hasAudio: input.authority.hasAudio,
    workspaceId: input.packageRow.workspaceId,
    storyId: input.packageRow.storyId,
    storyVersionId: input.packageRow.storyVersionId,
    sceneExecutionId: input.packageRow.sceneExecutionId,
    localPackageId: input.packageRow.packageId,
    localPackageFingerprint: input.packageRow.packageFingerprint,
    characterAuthority: input.packageRow.characterAuthority,
    productAuthority: input.packageRow.productAuthority,
    references: input.packageRow.references,
    generationMode: input.packageRow.generationMode,
    generateAudio: input.packageRow.generateAudio,
    audioBlocked: input.packageRow.audioBlocked,
    sourceAuthority: input.packageRow.sourceAuthority,
    planningAuthority: input.packageRow.planningAuthority,
  });
}

/** Rejects a LOCAL_GPU_WORKER result whose stored package, release, or asset lineage does not match. */
export function assertLocalGpuWorkerResultLineage(input: {
  result: AiStoryGenerationResult;
  authority: LocalGpuGenerationInputAuthority;
  serverEnvironment: "staging" | "production" | null;
  packageRow: LocalGpuStoredPackageLineage;
  release: LocalGpuStoredReleaseLineage;
  asset: LocalGpuStoredAssetLineage;
  plan: { id: string; orgId: string; workspaceId: string; campaignId: string; storyId: string; storyVersionId: string };
  runtimeAuthorizationId: string;
}): void {
  if (input.result.source.sourceKind !== "LOCAL_GPU_WORKER") {
    throw new Error("LOCAL_GPU_GENERATION_RESULT_AUTHORITY_INVALID");
  }
  if (input.serverEnvironment && input.authority.localGpuEnvironment !== input.serverEnvironment) {
    throw new Error("LOCAL_GPU_ENVIRONMENT_ISOLATION");
  }
  if (input.authority.actualDurationMs !== input.result.media.durationMs) {
    throw new Error("LOCAL_GPU_DURATION_AUTHORITY_MISMATCH");
  }
  const source = localSourceAuthorityShape.parse(input.packageRow.sourceAuthority);
  const storagePath = localGpuResultStoragePath(input.packageRow.workspaceId, input.result.media.contentHash);
  const expected = expectedLocalGpuGenerationInputAuthority(input);
  const sameWorkspace = input.packageRow.workspaceId === input.plan.workspaceId
    && input.packageRow.workspaceId === input.result.ownership.workspaceId
    && input.authority.workspaceId === input.packageRow.workspaceId
    && input.release.workspaceId === input.plan.workspaceId
    && input.asset.workspaceId === input.plan.workspaceId
    && source?.workspaceId === input.packageRow.workspaceId;
  if (!sameWorkspace) throw new Error("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
  if (input.release.executionMode !== "LOCAL_GPU" || input.release.releaseState !== "RELEASED") {
    throw new Error("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
  }
  if (!source
    || source.localSourceAuthorityId !== input.result.localSourceAuthorityId
    || source.localSourceAuthorityFingerprint !== input.result.localSourceAuthorityFingerprint
    || input.packageRow.packageId !== input.authority.localPackageId
    || input.packageRow.packageFingerprint !== input.authority.localPackageFingerprint
    || input.packageRow.orgId !== input.plan.orgId
    || input.packageRow.campaignId !== input.plan.campaignId
    || input.packageRow.storyId !== input.plan.storyId
    || input.packageRow.storyVersionId !== input.plan.storyVersionId
    || input.packageRow.executionPlanId !== input.plan.id
    || input.packageRow.runtimeAuthorizationId !== input.runtimeAuthorizationId
    || input.packageRow.sceneExecutionId !== input.result.sceneExecutionId
    || input.packageRow.unitId !== input.result.generationUnitId
    || input.release.orgId !== input.plan.orgId
    || input.release.executionPlanId !== input.plan.id
    || input.release.sceneExecutionId !== input.result.sceneExecutionId
    || input.release.runtimeAuthorizationId !== input.runtimeAuthorizationId
    || input.release.currentLocalGenerationPackageId !== input.packageRow.packageId
    || input.asset.status !== "ready"
    || input.asset.orgId !== input.plan.orgId
    || input.asset.campaignId !== input.plan.campaignId
    || input.asset.contentHash !== input.result.media.contentHash
    || input.asset.storagePath !== storagePath
    || input.asset.byteSize !== input.result.media.byteSize
    || input.result.media.storagePath !== storagePath
    || input.result.media.durableObjectReference !== storagePath
    || input.result.inputAuthorityFingerprint !== canonicalPersistenceHash(expected)
    || stable(input.authority) !== stable(expected)) {
    throw new Error("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
  }
}
