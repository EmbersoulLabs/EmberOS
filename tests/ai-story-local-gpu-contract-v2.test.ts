import { describe, expect, it } from "vitest";
import type { AiStoryLocalGenerationPackage } from "@ceo-agent/shared";
import {
  LOCAL_GPU_CLAIM_ORDER,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  buildLocalGpuDesktopSubmit,
  buildLocalGpuDesktopSubmitV2,
  type LocalGpuContractV2Reference,
} from "@ceo-agent/shared/server";
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { signLocalGpuRequest, verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import {
  mapCanonicalPackageToLocalGpuContractV2,
  type LocalGpuResolvedAsset,
} from "../packages/agents/src/ai-story/local-gpu-package-transport";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = (mark: string) => `sha256:${mark.repeat(64)}`;
const workspaceId = id(3);
const characterId = id(11);
const characterAssetId = id(21);
const productAssetId = id(22);
const frameAssetId = id(24);
const characterHash = hash("c");
const productHash = hash("d");
const frameHash = hash("e");
const secret = "contract-v2-test-secret";
const now = new Date("2026-10-11T00:00:00.000Z");
const upload = { environment: "staging" as const, method: "PUT", url: "https://uploads.example.test/scene.mp4" };
const actor = { userId: id(16), workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const };
const capabilities = { contractVersion: 2, workflowIds: [LOCAL_GPU_WORKER_WORKFLOW] };

function asset(assetId: string, contentHash: string, name: string): LocalGpuResolvedAsset {
  return { assetId, contentHash, workspaceId, assetUrl: `https://assets.example.test/${name}.png` };
}

function pkg(overrides: Record<string, unknown> = {}): AiStoryLocalGenerationPackage {
  return {
    version: "local-generation-package.v1",
    packageFingerprint: hash("f"),
    workspaceId,
    sceneExecutionId: id(40),
    executionPlanId: id(50),
    storyVersionId: id(60),
    order: 1,
    durationSec: 6,
    prompt: "The product stays on the table.",
    dialogue: [],
    generateAudio: true,
    audioBlocked: false,
    recommendedWorkflow: "MINIMAX_H3_R2V",
    characterAuthority: { characterId, dnaFingerprint: hash("a") },
    productAuthority: { assetId: productAssetId, contentHash: productHash, confirmedVariant: "matte-black" },
    references: [
      { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
      { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
    ],
    ...overrides,
  } as unknown as AiStoryLocalGenerationPackage;
}

const assets = [asset(productAssetId, productHash, "product"), asset(characterAssetId, characterHash, "character")];

function map(overrides: Record<string, unknown> = {}, extraAssets = assets) {
  return mapCanonicalPackageToLocalGpuContractV2({
    package: pkg(overrides),
    assets: extraAssets,
    environment: "staging",
    jobId: id(90),
    upload,
  });
}

function code(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof LocalGpuContractError ? error.message : String(error);
  }
  return "";
}

function reference(role: "CHARACTER" | "PRODUCT", subjectId: string, contentHash: string): LocalGpuContractV2Reference {
  return {
    approval: "APPROVED",
    role,
    subjectId,
    variantId: role === "PRODUCT" ? "matte-black" : null,
    assetUrl: `https://assets.example.test/${role.toLowerCase()}.png`,
    contentHash,
  };
}

function v2(overrides: Record<string, unknown> = {}) {
  return buildLocalGpuDesktopSubmitV2({
    environment: "staging",
    jobId: id(90),
    sceneExecutionId: id(40),
    workspaceId,
    workflow: "MINIMAX_H3_R2V",
    prompt: "The product stays on the table.",
    plannedDurationMs: 6000,
    upload,
    audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    creative: {
      characters: [{ subjectId: characterId, dnaFingerprint: hash("a") }],
      products: [{ subjectId: productAssetId, variantId: "matte-black" }],
    },
    references: [reference("PRODUCT", productAssetId, productHash), reference("CHARACTER", characterId, characterHash)],
    ...overrides,
  });
}

function stagingAdapter(http: ConstructorParameters<typeof LocalGpuCloudAdapter>[1], environment: "staging" | "production" = "staging") {
  return new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: environment,
    LOCAL_GPU_SIGNING_SECRET: secret,
    LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
  }), http, { now: () => now, nonce: () => "nonce-v2" });
}

describe("Desktop contract V2", () => {
  it("serializes contract 2 with authorized character and product order", () => {
    const result = map();
    expect(result.body.contractVersion).toBe(2);
    expect(result.body.assetMode).toBe("WITH_ASSET");
    expect(result.body.references.map((item) => item.role)).toEqual(["PRODUCT", "CHARACTER"]);
    expect(result.body.references.map((item) => item.order)).toEqual([0, 1]);
    expect(result.body.references.map((item) => item.subjectId)).toEqual([productAssetId, characterId]);
    expect(result.body.references.map((item) => item.contentHash)).toEqual([productHash, characterHash]);
    expect(result.body.creative.characters[0]).toEqual({ subjectId: characterId, dnaFingerprint: hash("a"), modelBound: false });
    expect(result.body.creative.products[0]).toEqual({ subjectId: productAssetId, variantId: "matte-black", modelBound: false });
    expect(result.body.firstFrame).toBeNull();
    expect(result.body.audioPolicy).toBe("NO_DIALOGUE_WITH_AMBIENT_AUDIO");
    expect(result.speechReviewRequired).toBe(true);
    expect(result.body).not.toHaveProperty("remoteProviderFallback");
  });

  it("carries an authorized continuity frame outside the two model references", () => {
    const result = map({
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "FIRST_FRAME", authorityId: id(16), assetId: frameAssetId, contentHash: frameHash },
      ],
    }, [...assets, asset(frameAssetId, frameHash, "frame")]);
    expect(result.body.references).toHaveLength(2);
    expect(result.body.firstFrame).toEqual({
      sourceAssetId: frameAssetId,
      contentHash: frameHash,
      assetUrl: "https://assets.example.test/frame.png",
    });
  });

  it("rejects a hash mismatch, a variant mismatch, missing authority, and a third model reference", () => {
    expect(code(() => map({}, [asset(productAssetId, hash("1"), "wrong"), asset(characterAssetId, characterHash, "character")]))).toBe(
      "LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED",
    );
    expect(code(() => v2({
      references: [reference("PRODUCT", productAssetId, productHash), reference("CHARACTER", characterId, characterHash)].map((item) =>
        item.role === "PRODUCT" ? { ...item, variantId: "gloss" } : item,
      ),
    }))).toBe("LOCAL_GPU_VARIANT_MISMATCH");
    expect(code(() => v2({
      creative: { characters: [], products: [{ subjectId: productAssetId, variantId: "matte-black" }] },
      references: [reference("PRODUCT", productAssetId, productHash)],
    }))).toBe("");
    expect(code(() => v2({
      references: [{ ...reference("CHARACTER", id(99), characterHash) }, reference("PRODUCT", productAssetId, productHash)],
    }))).toBe("LOCAL_GPU_REFERENCE_AUTHORITY_REQUIRED");
    expect(code(() => v2({
      references: [
        reference("PRODUCT", productAssetId, productHash),
        reference("CHARACTER", characterId, characterHash),
        reference("CHARACTER", id(18), hash("9")),
      ],
    }))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  });

  it("rejects a conflicting continuity frame and does not invent one", () => {
    expect(code(() => v2({
      continuityRequired: true,
      firstFrame: null,
    }))).toBe("LOCAL_GPU_CONTINUITY_FRAME_REQUIRED");
    expect(code(() => v2({
      firstFrame: {
        sourceAssetId: productAssetId,
        contentHash: productHash,
        assetUrl: "https://assets.example.test/product.png",
        authoritySourceAssetId: frameAssetId,
        authorityContentHash: frameHash,
      },
    }))).toBe("LOCAL_GPU_CONTINUITY_FRAME_MISMATCH");
  });

  it("rejects native dialogue, voice DNA, camera and motion binding, and text-only T2V", () => {
    expect(code(() => v2({ workflow: "MINIMAX_H3_NATIVE_DIALOGUE" }))).toBe("LOCAL_GPU_DISPATCH_DISABLED");
    expect(code(() => v2({ dialogueLineCount: 1 }))).toBe("LOCAL_GPU_DISPATCH_DISABLED");
    expect(code(() => v2({ pinnedVoiceDna: true }))).toBe("LOCAL_GPU_VOICE_DNA_UNSUPPORTED");
    expect(code(() => v2({ structuredCamera: true }))).toBe("LOCAL_GPU_CAMERA_MOTION_UNSUPPORTED");
    expect(code(() => v2({ structuredMotion: true }))).toBe("LOCAL_GPU_CAMERA_MOTION_UNSUPPORTED");
    expect(code(() => v2({ workflow: "WAN_I2V" }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => v2({ workflow: "V2V" }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => v2({ workflow: "WAN_VACE" }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => v2({ textOnly: true }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => v2({ references: [] }))).toBe("LOCAL_GPU_REFERENCES_REQUIRED");
  });

  it("preserves ambient audio and refuses to strip a product-only scene", () => {
    const silent = v2({
      audioPolicy: "SILENT_OUTPUT",
      creative: { characters: [], products: [{ subjectId: productAssetId, variantId: "matte-black" }] },
      references: [reference("PRODUCT", productAssetId, productHash)],
    });
    expect(silent.body.audioPolicy).toBe("SILENT_OUTPUT");
    const preserved = v2({ audioPolicy: "PRESERVE" });
    expect(preserved.body.audioPolicy).toBe("PRESERVE");
    expect(code(() => v2({
      audioPolicy: "REMOVE_AUDIO",
      productOnlyScene: true,
      creative: { characters: [], products: [{ subjectId: productAssetId, variantId: "matte-black" }] },
      references: [reference("PRODUCT", productAssetId, productHash)],
    }))).toBe("LOCAL_GPU_AUDIO_POLICY_INVALID");
  });

  it("keeps an omitted contract version on the V1 body and the same signing claims", () => {
    const v1 = buildLocalGpuDesktopSubmit({
      environment: "staging",
      jobId: id(90),
      sceneExecutionId: id(40),
      workspaceId,
      workflow: "MINIMAX_H3_R2V",
      prompt: "The product stays on the table.",
      plannedDurationMs: 6000,
      references: [{ approval: "APPROVED", role: "PRODUCT", assetUrl: "https://assets.example.test/product.png", contentHash: productHash }],
      audioPolicy: "NATIVE",
      upload,
    });
    expect(v1.body).not.toHaveProperty("contractVersion");
    const claims = {
      environment: "staging" as const,
      action: "submit",
      jobId: id(90),
      workspaceId,
      actorId: actor.userId,
      authority: "SUPERADMIN",
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      sceneExecutionId: id(40),
      expiresAt: now.getTime() + 60_000,
      nonce: "nonce-v2",
      uploadBinding: v2().uploadBinding,
    };
    const signed = signLocalGpuRequest(secret, claims);
    expect(Object.keys(JSON.parse(signed.canonicalPayload))).toEqual([...LOCAL_GPU_CLAIM_ORDER]);
    expect(verifyLocalGpuRequest({ secret, token: signed.token, now, workspaceId, environment: "staging" }).v).toBe(1);
    expect(signed.canonicalPayload).not.toContain("contractVersion");
  });
});

describe("contract V2 dispatch guards", () => {
  const request = {
    sceneExecutionId: id(40),
    workspaceId,
    workflow: "MINIMAX_H3_R2V",
    prompt: "The product stays on the table.",
    plannedDurationMs: 6000,
    upload,
    audioPolicy: "PRESERVE" as const,
    creative: { characters: [], products: [{ subjectId: productAssetId, variantId: "matte-black" }] },
    references: [reference("PRODUCT", productAssetId, productHash)],
  };
  const scope = { workspaceId, sceneExecutionId: id(40), packageId: id(30) };

  it("does not post when capabilities are V1, the gate already exists, or the environment is production", async () => {
    let calls = 0;
    const cloud = stagingAdapter(async (attempt) => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ state: "QUEUED", body: attempt.body }) };
    });
    await expect(cloud.submitContractV2({
      actor, package: scope, request, capabilities: { contractVersion: 1, workflowIds: [LOCAL_GPU_WORKER_WORKFLOW] }, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    await expect(cloud.submitContractV2({
      actor, package: scope, request, capabilities, existingGate: id(91),
    })).rejects.toThrow("LOCAL_GPU_DUPLICATE_SUBMIT");
    const production = stagingAdapter(async () => {
      calls += 1;
      return { status: 200, body: "{}" };
    }, "production");
    await expect(production.submitContractV2({
      actor, package: scope, request, capabilities, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_PRODUCTION_DENIED");
    expect(calls).toBe(0);
  });

  it("accepts the current and versioned Desktop workflow registries without weakening the R2V requirement", async () => {
    const calls: string[] = [];
    const cloud = stagingAdapter(async (attempt) => {
      calls.push(attempt.body ?? "");
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    await cloud.submitContractV2({
      actor, package: scope, request,
      capabilities: { contractVersion: 2, workflows: [{ id: LOCAL_GPU_WORKER_WORKFLOW }] }, existingGate: null,
    });
    await cloud.submitContractV2({
      actor, package: { ...scope, packageId: id(31) }, request,
      capabilities: { contractVersion: 2, contracts: { v2: { workflows: [{ workflow: LOCAL_GPU_WORKER_WORKFLOW }] } } }, existingGate: null,
    });
    await expect(cloud.submitContractV2({
      actor, package: { ...scope, packageId: id(32) }, request,
      capabilities: { contractVersion: 2, workflows: ["MINIMAX_H3_T2V"] }, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(calls).toHaveLength(2);
  });

  it("keeps legacy arrays and rejects malformed workflow objects", async () => {
    const cloud = stagingAdapter(async () => ({ status: 200, body: JSON.stringify({ state: "QUEUED" }) }));
    await cloud.submitContractV2({ actor, package: scope, request, capabilities, existingGate: null });
    await expect(cloud.submitContractV2({
      actor, package: { ...scope, packageId: id(33) }, request,
      capabilities: { contractVersion: 2, workflows: [{ name: LOCAL_GPU_WORKER_WORKFLOW }] }, existingGate: null,
    })).rejects.toThrow("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
  });

  it("posts one mocked V2 body and never a remote fallback", async () => {
    const bodies: unknown[] = [];
    const cloud = stagingAdapter(async (attempt) => {
      bodies.push(JSON.parse(attempt.body ?? "{}"));
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    const accepted = await cloud.submitContractV2({ actor, package: scope, request, capabilities, existingGate: null });
    expect(accepted.remoteProviderFallback).toBe(0);
    expect(accepted.automaticGenerationRetry).toBe(0);
    expect(accepted.contractVersion).toBe(2);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ contractVersion: 2, assetMode: "WITH_ASSET", workflow: "MINIMAX_H3_R2V" });
    expect(bodies[0]).not.toHaveProperty("remoteProviderFallback");
    await cloud.submit({
      actor,
      package: {
        ...scope,
        storyId: id(5),
        storyVersionId: id(6),
        prompt: "The product stays on the table.",
        recommendedWorkflow: "MINIMAX_H3_R2V",
        generateAudio: true,
        audioBlocked: false,
        references: [{ approval: "APPROVED", role: "PRODUCT", assetUrl: "https://assets.example.test/product.png", contentHash: productHash }],
      },
      plannedDurationMs: 6000,
      upload,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("contractVersion");
  });
});
