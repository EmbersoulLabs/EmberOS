import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_CERTIFIED_LOCAL_WORKFLOWS,
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_VIDEO_EXECUTION_MODES,
  AiStoryGenerationResultSchema,
  AiStoryLocalGenerationPackageSchema,
  AiStoryPostGenerationQcEvaluationSchema,
  AiStoryPostGenerationQcInputPackageSchema,
  LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS,
  LocalGpuGenerationInputAuthoritySchema,
  localGpuResultStoragePath,
} from "@ceo-agent/shared";
import { canonicalPersistenceHash, materializeGenerationResult } from "@ceo-agent/db";
import { assertLocalGpuWorkerResultLineage } from "../packages/db/src/queries/ai-story-local-gpu-result-authority";
import { materializeLocalGenerationResult } from "../packages/agents/src/ai-story/generation-result-service";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"a".repeat(64)}`;
const contentHash = `sha256:${"b".repeat(64)}`;
const now = "2026-10-01T00:00:00.000Z";

function packageRow() {
  return {
    packageId: id(1),
    packageFingerprint: hash,
    orgId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    storyId: id(5),
    storyVersionId: id(6),
    executionPlanId: id(7),
    runtimeAuthorizationId: id(8),
    sceneExecutionId: id(9),
    unitId: id(9),
    characterAuthority: null,
    productAuthority: null,
    references: [],
    generationMode: "TEXT_TO_VIDEO",
    generateAudio: true,
    audioBlocked: false,
    sourceAuthority: {
      localSourceAuthorityId: id(30),
      localSourceAuthorityFingerprint: hash,
      workspaceId: id(3),
    },
    planningAuthority: {
      planningLineageSource: "LEGACY_COMPILED_V1",
      sceneVersion: 1,
      scriptVersionId: null,
      handoffId: null,
      handoffFingerprint: null,
    },
  };
}

function authority() {
  const stored = packageRow();
  return LocalGpuGenerationInputAuthoritySchema.parse({
    localGpuEnvironment: "staging",
    localGpuJobId: id(31),
    localGpuWorkflow: "DESKTOP_WORKFLOW_UNBOUND",
    workspaceId: stored.workspaceId,
    storyId: stored.storyId,
    storyVersionId: stored.storyVersionId,
    sceneExecutionId: stored.sceneExecutionId,
    audioPolicy: "PRESERVE",
    plannedDurationMs: 6000,
    actualDurationMs: 4000,
    fps: 24,
    hasAudio: true,
    localPackageId: stored.packageId,
    localPackageFingerprint: stored.packageFingerprint,
    characterAuthority: stored.characterAuthority,
    productAuthority: stored.productAuthority,
    references: stored.references,
    generationMode: stored.generationMode,
    generateAudio: stored.generateAudio,
    audioBlocked: stored.audioBlocked,
    sourceAuthority: stored.sourceAuthority,
    planningAuthority: stored.planningAuthority,
  });
}

function gpuResult() {
  const stored = packageRow();
  const bound = authority();
  const storagePath = localGpuResultStoragePath(stored.workspaceId, contentHash);
  return materializeGenerationResult({
    ownership: {
      orgId: stored.orgId,
      workspaceId: stored.workspaceId,
      campaignId: stored.campaignId,
      storyId: stored.storyId,
      storyVersionId: stored.storyVersionId,
      animationPackageId: id(17),
      executionPlanId: stored.executionPlanId,
    },
    runtimeAuthorizationId: stored.runtimeAuthorizationId,
    generationUnitId: stored.unitId,
    sceneExecutionId: stored.sceneExecutionId,
    sceneId: "scene-1",
    sceneOrder: 1,
    source: {
      sourceKind: "LOCAL_GPU_WORKER",
      providerAttemptId: null,
      localGenerationOutputId: null,
      localWorkerOutputId: id(25),
    },
    compiledRequestId: null,
    compiledRequestFingerprint: null,
    localSourceAuthorityId: id(30),
    localSourceAuthorityFingerprint: hash,
    inputAuthorityFingerprint: canonicalPersistenceHash(bound),
    inputAuthority: bound,
    media: {
      assetId: id(15),
      contentHash,
      durableObjectReference: storagePath,
      storagePath,
      byteSize: 2000,
      mediaType: "video/mp4",
      durationMs: 4000,
      width: 720,
      height: 1280,
      readable: true,
      decodable: true,
    },
    createdAt: now,
  });
}

function lineage(overrides: {
  authority?: ReturnType<typeof authority>;
  releaseMode?: string;
  workspaceId?: string;
} = {}) {
  const stored = packageRow();
  const bound = overrides.authority ?? authority();
  const result = gpuResult();
  return {
    result,
    authority: bound,
    serverEnvironment: null as "staging" | "production" | null,
    packageRow: stored,
    release: {
      executionMode: overrides.releaseMode ?? "LOCAL_GPU",
      releaseState: "RELEASED",
      orgId: stored.orgId,
      workspaceId: overrides.workspaceId ?? stored.workspaceId,
      executionPlanId: stored.executionPlanId,
      sceneExecutionId: stored.sceneExecutionId,
      runtimeAuthorizationId: stored.runtimeAuthorizationId,
      currentLocalGenerationPackageId: stored.packageId,
    },
    asset: {
      status: "ready",
      orgId: stored.orgId,
      workspaceId: stored.workspaceId,
      campaignId: stored.campaignId,
      contentHash,
      storagePath: result.media.storagePath,
      byteSize: 2000,
    },
    plan: {
      id: stored.executionPlanId,
      orgId: stored.orgId,
      workspaceId: stored.workspaceId,
      campaignId: stored.campaignId,
      storyId: stored.storyId,
      storyVersionId: stored.storyVersionId,
    },
    runtimeAuthorizationId: stored.runtimeAuthorizationId,
  };
}

function manualPackage() {
  return AiStoryLocalGenerationPackageSchema.parse({
    version: "local-generation-package.v1",
    packageId: id(1),
    packageFingerprint: hash,
    executionMode: "MANUAL_LOCAL",
    organizationId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    storyId: id(5),
    storyVersionId: id(6),
    executionPlanId: id(7),
    runtimeAuthorizationId: id(8),
    unitId: id(9),
    sceneExecutionId: id(9),
    sceneId: "scene-1",
    order: 1,
    durationSec: 4,
    aspectRatio: "9:16",
    resolutionIntent: "720p",
    recommendedWorkflow: "WAN_T2V",
    generationMode: "TEXT_TO_VIDEO",
    prompt: "A deterministic synthetic Scene.",
    negativePrompt: "",
    dialogue: [],
    generateAudio: false,
    audioBlocked: true,
    characterAuthority: null,
    productAuthority: null,
    worldDescription: "Synthetic room",
    mustKeep: [],
    mustAvoid: [],
    qcRequirements: [],
    continuityRequirements: [],
    previousUnitEndState: [],
    currentUnitStartState: [],
    expectedEndState: [],
    references: [],
    sourceAuthority: {
      schedulingAuthorityId: id(10),
      schedulingAuthorityFingerprint: hash,
      plannerSnapshotId: id(11),
      compiledRequestId: id(12),
      compiledRequestFingerprint: hash,
      sceneFingerprint: hash,
      semanticPlanFingerprint: hash,
      preGenerationQcEvaluationId: id(13),
      preGenerationQcFingerprint: hash,
      directorFingerprint: hash,
      motionFingerprint: hash,
      castSnapshotFingerprint: hash,
      locationSnapshotFingerprint: hash,
      productSnapshotFingerprint: hash,
    },
    planningAuthority: {
      planningLineageSource: "LEGACY_COMPILED_V1",
      sceneVersion: 1,
      scriptVersionId: null,
      handoffId: null,
      handoffFingerprint: null,
    },
    instructions: "Render locally",
    state: "AWAITING_LOCAL_OUTPUT",
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: now,
  });
}

function qcInput(sourceKind: "LOCAL_GPU_WORKER" | "MANUAL_LOCAL" | "REMOTE_PROVIDER") {
  const workspaceId = id(3);
  const local = sourceKind === "LOCAL_GPU_WORKER";
  return {
    postQcInputId: id(40),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    orgId: id(2),
    workspaceId,
    campaignId: id(4),
    storyId: id(5),
    storyVersionId: id(6),
    planningLineageSource: "LEGACY_COMPILED_V1" as const,
    scriptVersionId: null,
    handoffId: null,
    sceneExecutionId: id(9),
    sceneId: "scene-1",
    sceneVersion: 1,
    sceneFingerprint: hash,
    sceneExecutionFingerprint: hash,
    providerAttemptId: sourceKind === "REMOTE_PROVIDER" ? "attempt-1" : null,
    generationResultId: id(41),
    sourceKind,
    generationMode: "TEXT_TO_VIDEO" as const,
    privateMediaAssetId: id(15),
    privateMediaContentHash: contentHash,
    compiledRequestId: local ? null : id(12),
    compiledRequestFingerprint: local ? null : hash,
    ...(local ? { localSourceAuthorityId: id(30), localSourceAuthorityFingerprint: hash } : {}),
    semanticPlanFingerprint: hash,
    preGenerationQcEvaluationId: id(13),
    preGenerationQcFingerprint: hash,
    handoffFingerprint: null,
    directorFingerprint: hash,
    motionFingerprint: hash,
    shotRecipeFingerprint: null,
    castSnapshotFingerprint: hash,
    locationSnapshotFingerprint: hash,
    productSnapshotFingerprint: hash,
    entryState: [],
    scriptActions: [],
    requiredExitState: [],
    mustKeep: [],
    mustAvoid: [],
    newAudienceInformation: [],
    requiredEvidence: [],
    requirements: [{
      requirementId: "output-integrity",
      dimension: "OUTPUT_INTEGRITY" as const,
      summary: "Durable video is readable.",
      required: true,
      waiverPolicy: "NON_WAIVABLE_INTEGRITY" as const,
      sourceOwner: "POST_PROCESSING" as const,
      visuallyObservable: false,
    }],
    providerMetadata: { sourceKind },
    media: {
      durableObjectReference: local
        ? localGpuResultStoragePath(workspaceId, contentHash)
        : `${workspaceId}/ai-story/local/output.mp4`,
      mediaType: "video/mp4" as const,
      byteSize: 2000,
      durationMs: 4000,
      width: 720,
      height: 1280,
      readable: true,
      decodable: true,
    },
    createdAt: now,
  };
}

function evaluation(sourceKind: "LOCAL_GPU_WORKER" | "MANUAL_LOCAL" | "REMOTE_PROVIDER", compiled: string | null) {
  return {
    postQcEvaluationId: id(42),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    evaluationVersion: 1,
    postQcInputId: id(40),
    orgId: id(2),
    workspaceId: id(3),
    providerAttemptId: sourceKind === "REMOTE_PROVIDER" ? "attempt-1" : null,
    generationResultId: id(41),
    sourceKind,
    mediaAssetId: id(15),
    mediaContentHash: contentHash,
    sceneExecutionId: id(9),
    sceneFingerprint: hash,
    compiledRequestFingerprint: compiled,
    generationMode: "TEXT_TO_VIDEO" as const,
    observations: [],
    findings: [],
    aggregateStatus: "POST_QC_REQUIRES_HUMAN_CONFIRMATION" as const,
    evidenceUnavailable: false,
    eligibleForHumanReview: true as const,
    autoApproved: false as const,
    autoRetryAuthorized: false as const,
    autoReleaseAuthorized: false as const,
    creativeAuthority: false as const,
    evaluationFingerprint: hash,
    evaluatedAt: now,
  };
}

describe("LOCAL_GPU V1 core phase 1", () => {
  it("keeps REMOTE_PROVIDER and MANUAL_LOCAL while adding a repeatable LOCAL_GPU mode", () => {
    const sql = readFileSync(join(root, "packages/db/sql/ai-story-local-gpu-execution-mode-v1.sql"), "utf8");
    const predecessor = readFileSync(join(root, "packages/db/sql/ai-story-sequential-manual-local-package-v3.sql"), "utf8");
    expect(predecessor).toContain("CHECK (execution_mode IN ('REMOTE_PROVIDER', 'MANUAL_LOCAL'))");
    expect(sql).toContain("ARRAY['MANUAL_LOCAL', 'REMOTE_PROVIDER']");
    expect(sql).toContain("ARRAY['LOCAL_GPU', 'MANUAL_LOCAL', 'REMOTE_PROVIDER']");
    expect(sql).toContain("RETURN;");
    expect(sql).not.toMatch(/UPDATE\s+ai_story_scene_release_states/i);
    expect(sql).not.toContain("ai_story_scene_release_state_v2_check");
    expect(sql).not.toContain("ai_story_scene_release_manual_gate_shape_check");
    expect(sql).toContain("DROP CONSTRAINT ai_story_scene_release_execution_mode_check");
    expect(sql.match(/DROP CONSTRAINT/g)).toEqual(["DROP CONSTRAINT"]);
  });

  it("accepts a LOCAL_GPU_WORKER result only when package, release, and asset lineage match", () => {
    const bound = lineage();
    expect(bound.result.source.sourceKind).toBe("LOCAL_GPU_WORKER");
    expect(bound.result.source.providerAttemptId).toBeNull();
    expect(() => assertLocalGpuWorkerResultLineage(bound)).not.toThrow();
  });

  it("rejects a forged package fingerprint, another workspace, and a Manual Local release", () => {
    const forged = LocalGpuGenerationInputAuthoritySchema.parse({
      ...authority(),
      localPackageFingerprint: `sha256:${"c".repeat(64)}`,
    });
    expect(() => assertLocalGpuWorkerResultLineage(lineage({ authority: forged }))).toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
    expect(() => assertLocalGpuWorkerResultLineage(lineage({ workspaceId: id(99) }))).toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
    expect(() => assertLocalGpuWorkerResultLineage(lineage({ releaseMode: "MANUAL_LOCAL" }))).toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
    expect(() => assertLocalGpuWorkerResultLineage(lineage({ releaseMode: "REMOTE_PROVIDER" }))).toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
  });

  it("rejects a package that has no local-source authority", () => {
    const bound = lineage();
    bound.packageRow = { ...bound.packageRow, sourceAuthority: { schedulingAuthorityId: id(10) } };
    expect(() => assertLocalGpuWorkerResultLineage(bound)).toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
  });

  it("keeps Manual Local materialization on its existing source", () => {
    const pkg = manualPackage();
    const result = materializeLocalGenerationResult({
      package: pkg,
      output: {
        outputId: id(14),
        packageId: pkg.packageId,
        unitId: pkg.unitId,
        sceneExecutionId: pkg.sceneExecutionId,
        assetId: id(15),
        contentHash: hash,
        mediaType: "video/mp4",
        durationSec: 4,
        width: 720,
        height: 1280,
        uploadedBy: id(16),
        uploadedAt: now,
        qcState: "PENDING",
        continuityFrameAssetId: null,
      },
      animationPackageId: id(17),
      sceneId: "scene-1",
      sceneOrder: 0,
      storagePath: `${pkg.workspaceId}/ai-story/local/output.mp4`,
      byteSize: 2000,
      decodable: true,
    });
    expect(result.source).toEqual({
      sourceKind: "MANUAL_LOCAL",
      providerAttemptId: null,
      localGenerationOutputId: id(14),
      localWorkerOutputId: null,
    });
    expect(result.compiledRequestId).toBe(id(12));
  });

  it("accepts LOCAL_GPU local-package QC and still requires human review", () => {
    expect(AiStoryPostGenerationQcInputPackageSchema.parse(qcInput("LOCAL_GPU_WORKER")).sourceKind).toBe("LOCAL_GPU_WORKER");
    expect(AiStoryPostGenerationQcInputPackageSchema.parse(qcInput("MANUAL_LOCAL")).sourceKind).toBe("MANUAL_LOCAL");
    const reviewed = AiStoryPostGenerationQcEvaluationSchema.parse(evaluation("LOCAL_GPU_WORKER", null));
    expect(reviewed.autoApproved).toBe(false);
    expect(reviewed.eligibleForHumanReview).toBe(true);
    expect(reviewed.autoRetryAuthorized).toBe(false);
    expect(AiStoryPostGenerationQcEvaluationSchema.parse(evaluation("MANUAL_LOCAL", null)).sourceKind).toBe("MANUAL_LOCAL");
    expect(AiStoryPostGenerationQcEvaluationSchema.safeParse(evaluation("REMOTE_PROVIDER", null)).success).toBe(false);
    expect(AiStoryPostGenerationQcEvaluationSchema.safeParse({ ...evaluation("LOCAL_GPU_WORKER", null), autoApproved: true }).success).toBe(false);
  });

  it("rejects GPU QC that borrows compiled remote lineage or another workspace path", () => {
    const forged = qcInput("LOCAL_GPU_WORKER");
    expect(AiStoryPostGenerationQcInputPackageSchema.safeParse({
      ...forged,
      compiledRequestId: id(12),
      compiledRequestFingerprint: hash,
    }).success).toBe(false);
    expect(AiStoryPostGenerationQcInputPackageSchema.safeParse({
      ...forged,
      media: { ...forged.media, durableObjectReference: `${id(99)}/ai-story/local-gpu/${contentHash.slice(7)}.mp4` },
    }).success).toBe(false);
    expect(AiStoryGenerationResultSchema.safeParse({
      ...gpuResult(),
      localSourceAuthorityId: undefined,
      localSourceAuthorityFingerprint: undefined,
    }).success).toBe(false);
  });

  it("leaves production routing, Native Dialogue dispatch, and the Product-only candidate disabled", () => {
    const execute = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"), "utf8");
    const processors = readFileSync(join(root, "apps/worker/src/processors/index.ts"), "utf8");
    expect(execute).not.toContain("LOCAL_GPU");
    expect(processors).not.toContain("ai-story-local-gpu-execution-cycle");
    expect(existsSync(join(root, "apps/worker/src/ai-story-local-gpu-execution-cycle.ts"))).toBe(false);
    expect(existsSync(join(root, "packages/agents/src/ai-story/local-gpu-adapter.ts"))).toBe(false);
    expect([...AI_STORY_CERTIFIED_LOCAL_WORKFLOWS]).toEqual(["MINIMAX_H3_NATIVE_DIALOGUE"]);
    expect([...AI_STORY_VIDEO_EXECUTION_MODES]).toEqual(["MANUAL_LOCAL", "REMOTE_PROVIDER"]);
    expect([...LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS]).toEqual([
      "MINIMAX_H3_NATIVE_DIALOGUE",
      "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1",
    ]);
    expect(LocalGpuGenerationInputAuthoritySchema.safeParse({
      ...authority(),
      localGpuWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
    }).success).toBe(false);
    expect(LocalGpuGenerationInputAuthoritySchema.safeParse({
      ...authority(),
      localGpuWorkflow: "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1",
    }).success).toBe(false);
    expect(readFileSync(join(root, "packages/shared/src/ai-story-local-gpu-result-authority.ts"), "utf8")).not.toContain("7c9efbee-c50e-454d-941d-5af165f21355");
  });
});
