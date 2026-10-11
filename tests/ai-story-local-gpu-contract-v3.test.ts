import { describe, expect, it } from "vitest";
import {
  LOCAL_GPU_CLAIM_ORDER,
  LOCAL_GPU_CREATIVE_BINDING_KEYS_V2,
  LOCAL_GPU_CREATIVE_BINDING_KEYS_V3,
  LOCAL_GPU_T2V_WORKFLOW,
  LOCAL_GPU_V3_E2E_CERTIFIED,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  assertLocalGpuCreativeBinding,
  buildLocalGpuDesktopSubmit,
  buildLocalGpuZeroAssetT2VSubmit,
  localGpuCanonicalCreativeJob,
  localGpuCreativeBindingDigest,
  localGpuCreativeBindingForV2Body,
  selectLocalGpuV3Workflow,
} from "@ceo-agent/shared/server";
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { signLocalGpuRequest, verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import { buildLocalGpuDesktopSubmitV2 } from "@ceo-agent/shared/server";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"a".repeat(64)}`;
const workspaceId = id(3);
const storyId = id(5);
const storyVersionId = id(6);
const secret = "contract-v3-test-secret";
const now = new Date("2026-10-11T00:00:00.000Z");
const upload = { environment: "staging" as const, method: "PUT", url: "https://uploads.example.test/scene.mp4" };
const actor = { userId: id(16), workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const };
const runtimeCapabilities = {
  contractVersion: 3 as const,
  workflowIds: [LOCAL_GPU_T2V_WORKFLOW],
  runtimeExecutableWorkflows: [LOCAL_GPU_T2V_WORKFLOW],
};

function code(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof LocalGpuContractError ? error.message : String(error);
  }
  return "";
}

function t2v(overrides: Record<string, unknown> = {}) {
  return buildLocalGpuZeroAssetT2VSubmit({
    environment: "staging",
    jobId: id(90),
    sceneExecutionId: id(40),
    workspaceId,
    storyId,
    storyVersionId,
    prompt: "A quiet product story with room tone.",
    plannedDurationMs: 6000,
    aspectRatio: "9:16",
    seed: 11,
    audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    upload,
    assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
    confirmationStoryId: storyId,
    confirmationStoryVersionId: storyVersionId,
    director: { camera: "slow push in", motion: "hold the ending" },
    ...overrides,
  });
}

function adapter(http: ConstructorParameters<typeof LocalGpuCloudAdapter>[1], environment: "staging" | "production" = "staging") {
  return new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: environment,
    LOCAL_GPU_SIGNING_SECRET: secret,
    LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
  }), http, { now: () => now, nonce: () => "nonce-v3" });
}

describe("zero-asset contract V3", () => {
  it("builds a WITHOUT_ASSET T2V job with an empty reference list and no fabricated frame", () => {
    const result = t2v();
    expect(result.body.contractVersion).toBe(3);
    expect(result.body.assetMode).toBe("WITHOUT_ASSET");
    expect(result.body.workflow).toBe("MINIMAX_H3_T2V");
    expect(result.body.references).toEqual([]);
    expect(result.body.firstFrame).toBeNull();
    expect(result.body.lastFrame).toBeNull();
    expect(result.body.audioReferences).toBeNull();
    expect(result.body.videoReferences).toBeNull();
    expect(result.body.dialogue).toBeNull();
    expect(result.body.voiceInstructions).toBeNull();
    expect(result.body.audioPolicy).toBe("NO_DIALOGUE_WITH_AMBIENT_AUDIO");
    expect(result.speechReviewRequired).toBe(true);
    expect(result.body.director).toEqual({ guidance: "PROMPT_GUIDANCE", camera: "slow push in", motion: "hold the ending" });
    expect(Object.keys(result.canonicalJob)).toEqual([...LOCAL_GPU_CREATIVE_BINDING_KEYS_V3]);
    expect(result.creativeBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(result.body).not.toHaveProperty("remoteProviderFallback");
    expect(LOCAL_GPU_V3_E2E_CERTIFIED).toBe(false);
  });

  it("requires confirmed no-asset authority and does not route an empty scene through R2V", () => {
    expect(code(() => t2v({ assetRecommendationStatus: "ASSET_RECOMMENDATION_REQUIRED" }))).toBe("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    expect(code(() => t2v({ confirmationStoryId: id(8) }))).toBe("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    expect(code(() => t2v({ imageReferenceCount: 1 }))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET" }).workflow).toBe(LOCAL_GPU_T2V_WORKFLOW);
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET", imageReferenceCount: 1 }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET", nativeDialogue: true }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITH_ASSET", audioReferenceCount: 1, imageReferenceCount: 1 }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITH_ASSET", videoReferenceCount: 1, imageReferenceCount: 1 }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  });

  it("keeps silent output distinct from ambient preservation", () => {
    expect(t2v({ audioPolicy: "SILENT_OUTPUT" }).body.audioPolicy).toBe("SILENT_OUTPUT");
    expect(t2v({ audioPolicy: "PRESERVE" }).body.audioPolicy).toBe("PRESERVE");
    expect(t2v({ audioPolicy: "NATIVE" }).body.audioPolicy).toBe("NATIVE");
    expect(t2v({ audioPolicy: "REMOVE_AUDIO" }).body.audioPolicy).toBe("REMOVE_AUDIO");
  });

  it("rejects a tampered creative binding and keeps V2 hashes shorter than V3", () => {
    const result = t2v();
    const tampered = { ...result.canonicalJob, prompt: "changed" };
    expect(localGpuCreativeBindingDigest(tampered)).not.toBe(result.creativeBinding);
    expect(code(() => assertLocalGpuCreativeBinding(tampered, result.creativeBinding))).toBe("LOCAL_GPU_CREATIVE_BINDING_MISMATCH");
    const v2 = buildLocalGpuDesktopSubmitV2({
      environment: "staging",
      jobId: id(90),
      sceneExecutionId: id(40),
      workspaceId,
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      prompt: "A product scene",
      plannedDurationMs: 6000,
      upload,
      audioPolicy: "PRESERVE",
      creative: { characters: [], products: [{ subjectId: id(22), variantId: "matte-black" }] },
      references: [{
        approval: "APPROVED",
        role: "PRODUCT",
        subjectId: id(22),
        variantId: "matte-black",
        assetUrl: "https://assets.example.test/product.png",
        contentHash: hash,
      }],
    });
    const v2Job = localGpuCanonicalCreativeJob({
      contractVersion: 2,
      assetMode: "WITH_ASSET",
      jobId: v2.body.jobId,
      sceneExecutionId: v2.body.sceneExecutionId,
      workspaceId: v2.body.workspaceId,
      workflow: v2.body.workflow,
      prompt: v2.body.prompt,
      durationSec: v2.body.durationSec,
      audioPolicy: v2.body.audioPolicy,
      aspectRatio: null,
      megapixels: null,
      voiceInstructions: null,
      seed: null,
      references: v2.body.references,
      firstFrame: v2.body.firstFrame,
    });
    expect(Object.keys(v2Job)).toEqual([...LOCAL_GPU_CREATIVE_BINDING_KEYS_V2]);
    expect(localGpuCreativeBindingForV2Body(v2.body)).toBe(localGpuCreativeBindingDigest(v2Job));
    const v1 = buildLocalGpuDesktopSubmit({
      environment: "staging",
      jobId: id(90),
      sceneExecutionId: id(40),
      workspaceId,
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      prompt: "A product scene",
      plannedDurationMs: 6000,
      references: [{ approval: "APPROVED", role: "PRODUCT", assetUrl: "https://assets.example.test/product.png", contentHash: hash }],
      audioPolicy: "NATIVE",
      upload,
    });
    expect(v1.body).not.toHaveProperty("contractVersion");
    expect(v1.body).not.toHaveProperty("creativeBinding");
  });

  it("signs V3 claims in the desktop order and rejects a bad signature or workspace", () => {
    const result = t2v();
    const signed = signLocalGpuRequest(secret, {
      environment: "staging",
      action: "submit",
      jobId: id(90),
      workspaceId,
      actorId: actor.userId,
      authority: "SUPERADMIN",
      workflow: LOCAL_GPU_T2V_WORKFLOW,
      sceneExecutionId: id(40),
      expiresAt: now.getTime() + 60_000,
      nonce: "nonce-v3",
      uploadBinding: result.uploadBinding,
      creativeBinding: result.creativeBinding,
    });
    expect(Object.keys(JSON.parse(signed.canonicalPayload))).toEqual([...LOCAL_GPU_CLAIM_ORDER, "creativeBinding"]);
    expect(verifyLocalGpuRequest({
      secret, token: signed.token, now, workspaceId, environment: "staging",
    }).creativeBinding).toBe(result.creativeBinding);
    expect(code(() => verifyLocalGpuRequest({
      secret, token: `${signed.token}x`, now, workspaceId, environment: "staging",
    }))).toBe("LOCAL_GPU_SIGNATURE_INVALID");
    expect(code(() => verifyLocalGpuRequest({
      secret, token: signed.token, now, workspaceId: id(4), environment: "staging",
    }))).toBe("LOCAL_GPU_WORKSPACE_MISMATCH");
    const v1 = signLocalGpuRequest(secret, {
      environment: "staging",
      action: "submit",
      jobId: id(90),
      workspaceId,
      actorId: actor.userId,
      authority: "SUPERADMIN",
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      sceneExecutionId: id(40),
      expiresAt: now.getTime() + 60_000,
      nonce: "nonce-v1",
      uploadBinding: result.uploadBinding,
    });
    expect(Object.keys(JSON.parse(v1.canonicalPayload))).toEqual([...LOCAL_GPU_CLAIM_ORDER]);
  });
});

describe("V3 dispatch stays closed without runtime capability", () => {
  const request = {
    storyId,
    storyVersionId,
    prompt: "A quiet product story with room tone.",
    plannedDurationMs: 6000,
    aspectRatio: "9:16" as const,
    seed: 11,
    audioPolicy: "PRESERVE" as const,
    upload,
    assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
    confirmationStoryId: storyId,
    confirmationStoryVersionId: storyVersionId,
  };
  const scope = { workspaceId, sceneExecutionId: id(40), packageId: id(30) };

  it("does not post for implemented-only capabilities, a duplicate gate, or production", async () => {
    let calls = 0;
    const cloud = adapter(async () => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    await expect(cloud.submitZeroAssetT2V({
      actor, package: scope, request, existingGate: null,
      capabilities: { contractVersion: 3, workflowIds: [LOCAL_GPU_T2V_WORKFLOW] },
    })).rejects.toThrow("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    await expect(cloud.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: runtimeCapabilities, existingGate: id(91),
    })).rejects.toThrow("LOCAL_GPU_DUPLICATE_SUBMIT");
    const production = adapter(async () => {
      calls += 1;
      return { status: 200, body: "{}" };
    }, "production");
    await expect(production.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: runtimeCapabilities, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_PRODUCTION_DENIED");
    expect(calls).toBe(0);
  });

  it("posts one mocked T2V body when runtime capabilities match", async () => {
    const bodies: Record<string, unknown>[] = [];
    const cloud = adapter(async (attempt) => {
      bodies.push(JSON.parse(attempt.body ?? "{}") as Record<string, unknown>);
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    const accepted = await cloud.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: runtimeCapabilities, existingGate: null,
    });
    expect(accepted.workflow).toBe("MINIMAX_H3_T2V");
    expect(accepted.remoteProviderFallback).toBe(0);
    expect(accepted.automaticGenerationRetry).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ contractVersion: 3, assetMode: "WITHOUT_ASSET", workflow: "MINIMAX_H3_T2V", references: [] });
    expect(bodies[0]?.firstFrame).toBeNull();
  });
});
