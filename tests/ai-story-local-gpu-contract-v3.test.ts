import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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
  assertLocalGpuUploadBinding,
  buildLocalGpuDesktopSubmit,
  buildLocalGpuZeroAssetT2VSubmit,
  localGpuCanonicalCreativeJob,
  localGpuCreativeBindingDigest,
  localGpuCreativeBindingForV2Body,
  readLocalGpuV3T2vCapability,
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
const signedCapabilities = {
  contractVersion: 3,
  acceptedContracts: [1, 2, 3],
  contracts: {
    v3: {
      workflows: {
        MINIMAX_H3_T2V: {
          execution: "enabled",
          textToVideo: true,
          placeholderImage: false,
          missingModels: [],
          e2eCertified: false,
        },
      },
    },
  },
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
    megapixels: 0.5,
    audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    upload,
    assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
    confirmationStoryId: storyId,
    confirmationStoryVersionId: storyVersionId,
    confirmationWorkspaceId: workspaceId,
    planningFrozen: true,
    preGenerationQcEvaluationId: id(80),
    runtimeAuthorizationId: id(70),
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
  it("serializes the exact H3 T2V prompt while retaining deterministic controls as structured fields", () => {
    const result = t2v({ promptFacts: {
      sceneContext: ["Rainy evening in the approved street environment"],
      actionProgression: ["The character opens the umbrella and walks to the doorway"],
      cameraGuidance: ["One steady lateral tracking shot"],
      startState: ["Umbrella closed"],
      endState: ["Character sheltered at the doorway"],
      mustAvoid: ["No teleportation"],
    } });
    expect(result.body.prompt).toBe("A quiet product story with room tone. | SCENE: Rainy evening in the approved street environment | PRIMARY ACTION PROGRESSION: The character opens the umbrella and walks to the doorway | CAMERA GUIDANCE: One steady lateral tracking shot | START STATE: Umbrella closed | REQUIRED END STATE: Character sheltered at the doorway | MUST AVOID: No teleportation");
    expect(result.body).toMatchObject({ durationSec: 6, aspectRatio: "9:16", megapixels: 0.5, seed: 11 });
    expect(result.body.prompt).not.toMatch(/duration|9:16|0\.5|seed/i);
  });

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
    expect(result.body.megapixels).toBe(0.5);
    expect(JSON.stringify(result.canonicalJob)).toContain("\"audioReferences\":null");
    expect(JSON.stringify(result.canonicalJob)).toContain("\"videoReferences\":null");
    expect(JSON.stringify(result.canonicalJob)).toContain("\"dialogue\":null");
    expect(JSON.stringify(result.canonicalJob)).toContain("\"firstFrame\":null");
    expect(JSON.stringify(result.canonicalJob)).toContain("\"references\":[]");
    expect(JSON.stringify(result.canonicalJob)).not.toContain("\"audioReferences\":[]");
    expect(result.body.director).toEqual({ guidance: "PROMPT_GUIDANCE", camera: "slow push in", motion: "hold the ending" });
    expect(result.e2eCertified).toBe(false);
    expect(Object.keys(result.canonicalJob)).toEqual([...LOCAL_GPU_CREATIVE_BINDING_KEYS_V3]);
    expect(result.creativeBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(result.body).not.toHaveProperty("remoteProviderFallback");
    expect(LOCAL_GPU_V3_E2E_CERTIFIED).toBe(false);
  });

  it("requires confirmed no-asset authority and does not route an empty scene through R2V", () => {
    expect(code(() => t2v({ assetRecommendationStatus: "ASSET_RECOMMENDATION_REQUIRED" }))).toBe("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    expect(code(() => t2v({ confirmationStoryId: id(8) }))).toBe("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    expect(code(() => t2v({ imageReferenceCount: 1 }))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(code(() => t2v({ planningFrozen: false }))).toBe("LOCAL_GPU_PLANNING_AUTHORITY_REQUIRED");
    expect(code(() => t2v({ preGenerationQcEvaluationId: "" }))).toBe("LOCAL_GPU_PRE_QC_REQUIRED");
    expect(code(() => t2v({ runtimeAuthorizationId: "" }))).toBe("LOCAL_GPU_RUNTIME_AUTHORIZATION_REQUIRED");
    expect(code(() => t2v({ activeBindingCount: 1 }))).toBe("LOCAL_GPU_ASSET_BINDING_PRESENT");
    expect(selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET" }).workflow).toBe(LOCAL_GPU_T2V_WORKFLOW);
    expect(t2v({ dialogueLineCount: 3 }).body.workflow).toBe(LOCAL_GPU_T2V_WORKFLOW);
    expect(t2v({ dialogueLineCount: 3 }).body.dialogue).toBeNull();
    expect(code(() => t2v({ dialogueRequired: true }))).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET", imageReferenceCount: 1 }))).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITHOUT_ASSET", dialogueRequired: true }))).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITH_ASSET", audioReferenceCount: 1, imageReferenceCount: 1 }))).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(code(() => selectLocalGpuV3Workflow({ assetMode: "WITH_ASSET", videoReferenceCount: 1, imageReferenceCount: 1 }))).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
  });

  it("accepts 0.5 MP and rejects 1 MP before a creative binding is signed", () => {
    expect(t2v({ megapixels: 0.5 }).body.megapixels).toBe(0.5);
    expect(t2v({ megapixels: 0.2 }).body.megapixels).toBe(0.2);
    expect(t2v({ megapixels: 0.98 }).body.megapixels).toBe(0.98);
    expect(code(() => t2v({ megapixels: 1 }))).toBe("LOCAL_GPU_RESOLUTION_UNSUPPORTED");
    expect(code(() => t2v({ megapixels: 0.19 }))).toBe("LOCAL_GPU_RESOLUTION_UNSUPPORTED");
    expect(code(() => t2v({ megapixels: 0.99 }))).toBe("LOCAL_GPU_RESOLUTION_UNSUPPORTED");
    expect(code(() => t2v({ megapixels: Number.NaN }))).toBe("LOCAL_GPU_RESOLUTION_REQUIRED");
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
      references: v2.body.references.map((reference) => ({
        role: reference.role,
        assetUrl: reference.assetUrl,
        contentHash: reference.contentHash,
        subjectId: reference.subjectId,
        variantId: reference.variantId,
        dnaVersion: null,
        dnaFingerprint: null,
      })),
      firstFrame: null,
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

  it("accepts Contract V3 only from contracts.v3 and records that runtime is not E2E certified", () => {
    expect(readLocalGpuV3T2vCapability(signedCapabilities)).toEqual({
      workflow: LOCAL_GPU_T2V_WORKFLOW,
      execution: "enabled",
      textToVideo: true,
      placeholderImage: false,
      missingModels: [],
      e2eCertified: false,
    });
    expect(code(() => readLocalGpuV3T2vCapability({ contractVersion: 3, runtimeExecutableWorkflows: [LOCAL_GPU_T2V_WORKFLOW] }))).toBe("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(code(() => readLocalGpuV3T2vCapability({
      contracts: { v3: { workflows: { MINIMAX_H3_T2V: { ...signedCapabilities.contracts.v3.workflows.MINIMAX_H3_T2V, placeholderImage: true } } } },
    }))).toBe("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(code(() => readLocalGpuV3T2vCapability({
      contracts: { v3: { workflows: { MINIMAX_H3_T2V: { ...signedCapabilities.contracts.v3.workflows.MINIMAX_H3_T2V, missingModels: ["minimax_h3_fl2va_pruned_int8_convrot.safetensors"] } } } },
    }))).toBe("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(code(() => readLocalGpuV3T2vCapability({
      contracts: { v3: { workflows: { MINIMAX_H3_T2V: { ...signedCapabilities.contracts.v3.workflows.MINIMAX_H3_T2V, execution: "disabled" } } } },
    }))).toBe("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(LOCAL_GPU_V3_E2E_CERTIFIED).toBe(false);
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
    expect(code(() => verifyLocalGpuRequest({
      secret, token: signed.token, now: new Date(now.getTime() + 60_000), workspaceId, environment: "staging",
    }))).toBe("LOCAL_GPU_REQUEST_EXPIRED");
    expect(code(() => assertLocalGpuUploadBinding(
      { environment: "staging", method: "PUT", url: "https://uploads.example.test/scene-tampered.mp4" },
      result.uploadBinding,
    ))).toBe("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
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
    megapixels: 0.5,
    planningFrozen: true,
    preGenerationQcEvaluationId: id(80),
    runtimeAuthorizationId: id(70),
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
      capabilities: { contractVersion: 3 },
    })).rejects.toThrow("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    await expect(cloud.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: signedCapabilities, existingGate: id(91),
    })).rejects.toThrow("LOCAL_GPU_DUPLICATE_SUBMIT");
    const production = adapter(async () => {
      calls += 1;
      return { status: 200, body: "{}" };
    }, "production");
    await expect(production.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: signedCapabilities, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_PRODUCTION_DENIED");
    expect(calls).toBe(0);
  });

  it("permits one production POST only when server-persisted dispatch authority is supplied", async () => {
    let calls = 0;
    const production = adapter(async () => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    }, "production");
    const productionRequest = { ...request, upload: { ...upload, environment: "production" as const } };
    await production.submitZeroAssetT2V({
      actor, package: scope, request: productionRequest, capabilities: signedCapabilities,
      existingGate: null, productionDispatchAuthorized: true,
    });
    expect(calls).toBe(1);
  });

  it("does not sign or post a 1 MP request", async () => {
    let calls = 0;
    const cloud = adapter(async () => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    await expect(cloud.submitZeroAssetT2V({
      actor, package: scope, request: { ...request, megapixels: 1 }, capabilities: signedCapabilities, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_RESOLUTION_UNSUPPORTED");
    expect(calls).toBe(0);
  });

  it("posts one mocked T2V body when runtime capabilities match", async () => {
    const bodies: Record<string, unknown>[] = [];
    const cloud = adapter(async (attempt) => {
      bodies.push(JSON.parse(attempt.body ?? "{}") as Record<string, unknown>);
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    const accepted = await cloud.submitZeroAssetT2V({
      actor, package: scope, request, capabilities: signedCapabilities, existingGate: null,
    });
    expect(accepted.workflow).toBe("MINIMAX_H3_T2V");
    expect(accepted.remoteProviderFallback).toBe(0);
    expect(accepted.automaticGenerationRetry).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ contractVersion: 3, assetMode: "WITHOUT_ASSET", workflow: "MINIMAX_H3_T2V", references: [] });
    expect(bodies[0]?.firstFrame).toBeNull();
    expect(bodies[0]?.megapixels).toBe(0.5);
  });
});

describe("V3 golden vectors", () => {
  it("preserves the original 1 MP fixture and matches the 0.5 MP fixture", () => {
    const original = readFileSync("tests/fixtures/local-gpu-cloud-v3-signing-golden-vector.json");
    const certified = readFileSync("tests/fixtures/local-gpu-cloud-v3-signing-golden-vector-0.5mp.json");
    const canonicalBytes = (value: Buffer) => Buffer.from(value.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    expect(createHash("sha256").update(canonicalBytes(original)).digest("hex")).toBe("4d1a210342c9510531771400747cbbed20841c5341c430e01563b207b019ae9c");
    expect(createHash("sha256").update(canonicalBytes(certified)).digest("hex")).toBe("099b0f6a1d98be698071b68633a9c604fde186c65b90f6340a621aa335573e52");
    const historical = JSON.parse(original.toString("utf8")) as { creativeBinding: { sha256: string }; canonicalJob: { megapixels: number } };
    const fixture = JSON.parse(certified.toString("utf8")) as {
      megapixels: number;
      canonicalJob: { megapixels: number; references: unknown[]; firstFrame: null; audioReferences: null };
      creativeBinding: { inputUtf8: string; sha256: string };
      canonicalSigningInput: string;
      hmac: { expected: string };
      testOnlySecret: { utf8: string };
    };
    expect(historical.creativeBinding.sha256).toBe("ca7b7356df8282b5ad232317c28ff5493887d2ac82d9c9e31570499dc17519f7");
    expect(historical.canonicalJob.megapixels).toBe(1);
    expect(fixture.megapixels).toBe(0.5);
    expect(fixture.canonicalJob.megapixels).toBe(0.5);
    expect(fixture.canonicalJob.references).toEqual([]);
    expect(fixture.canonicalJob.firstFrame).toBeNull();
    expect(fixture.canonicalJob.audioReferences).toBeNull();
    expect(createHash("sha256").update(fixture.creativeBinding.inputUtf8, "utf8").digest("hex")).toBe(fixture.creativeBinding.sha256);
    expect(createHmac("sha256", Buffer.from(fixture.testOnlySecret.utf8, "utf8")).update(fixture.canonicalSigningInput, "utf8").digest("base64url")).toBe(fixture.hmac.expected);
    const rebuilt = t2v();
    expect(rebuilt.creativeBinding).toBe("30b355328545ebda9a94e09298e8e2838b547ed6b6599d4b52b426f4286c3b8c");
    expect(rebuilt.creativeBinding).toBe(fixture.creativeBinding.sha256);
    expect(JSON.stringify(rebuilt.canonicalJob)).toBe(fixture.creativeBinding.inputUtf8);
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
      uploadBinding: rebuilt.uploadBinding,
      creativeBinding: rebuilt.creativeBinding,
    });
    expect(signed.signature).toBe("Ge2JUFyX6inv7eBXjq_y6YWYKdnv01IRsozBsN_Psr0");
    expect(signed.signature).toBe(fixture.hmac.expected);
    expect(signed.payload).toBe(fixture.canonicalSigningInput);
  });
});
