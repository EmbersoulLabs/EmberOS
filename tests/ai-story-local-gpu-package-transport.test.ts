import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiStoryLocalGenerationPackage } from "@ceo-agent/shared";
import { LocalGpuContractError } from "@ceo-agent/shared/server";
import { assertLocalGpuAccess, resolveExplicitLocalGpuProviderAuthority } from "../packages/agents/src/ai-story/local-gpu-access";
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import {
  authorizeLocalGpuSequentialRelease,
  mapCanonicalPackageToLocalGpuDesktop,
  mapCanonicalPackageToLocalGpuNativeDialogueV3,
  type LocalGpuResolvedAsset,
} from "../packages/agents/src/ai-story/local-gpu-package-transport";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = (mark: string) => `sha256:${mark.repeat(64)}`;
const workspaceId = id(3);
const characterId = id(11);
const characterAssetId = id(21);
const productAssetId = id(22);
const otherAssetId = id(23);
const frameAssetId = id(24);
const characterHash = hash("c");
const productHash = hash("d");
const frameHash = hash("e");

const upload = {
  environment: "staging" as const,
  method: "PUT",
  url: "https://uploads.example.test/scene.mp4",
};

function asset(assetId: string, contentHash: string, name: string): LocalGpuResolvedAsset {
  return {
    assetId,
    contentHash,
    workspaceId,
    assetUrl: `https://assets.example.test/${name}.png`,
  };
}

function pkg(overrides: Record<string, unknown> = {}): AiStoryLocalGenerationPackage {
  return {
    version: "local-generation-package.v1",
    packageId: id(30),
    packageFingerprint: hash("f"),
    workspaceId,
    sceneExecutionId: id(40),
    executionPlanId: id(50),
    storyVersionId: id(60),
    runtimeAuthorizationId: id(70),
    order: 1,
    durationSec: 6,
    aspectRatio: "9:16",
    resolutionIntent: "720p",
    recommendedWorkflow: "MINIMAX_H3_R2V",
    prompt: "A product sits on the table.",
    dialogue: [],
    generateAudio: true,
    audioBlocked: false,
    characterAuthority: {
      characterId,
      characterVersionId: id(12),
      dnaFingerprint: hash("a"),
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: {
      assetId: productAssetId,
      contentHash: productHash,
      confirmedVariant: "matte black 500ml",
    },
    mustKeep: ["label faces camera"],
    mustAvoid: ["extra logos"],
    continuityRequirements: ["same table"],
    qcRequirements: [
      { dimension: "DIRECTOR_EXECUTION", summary: "slow push in" },
      { dimension: "MOTION_EXECUTION", summary: "bottle stays in contact with the table" },
    ],
    references: [
      { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
      { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
    ],
    sourceAuthority: { preGenerationQcEvaluationId: id(80) },
    ...overrides,
  } as unknown as AiStoryLocalGenerationPackage;
}

const assets = [
  asset(otherAssetId, hash("9"), "unrelated"),
  asset(characterAssetId, characterHash, "character"),
  asset(productAssetId, productHash, "product"),
];

function map(overrides: Record<string, unknown> = {}, extraAssets = assets) {
  return mapCanonicalPackageToLocalGpuDesktop({
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

function mapNativeDialogue(overrides: Record<string, unknown> = {}, extraAssets = assets) {
  return mapCanonicalPackageToLocalGpuNativeDialogueV3({
    package: pkg({
      recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      dialogue: [{
        speakerCharacterId: characterId,
        speakerLabel: "Yuki",
        text: "妈，你每天这样做，不累咩？",
        offscreen: false,
        locale: "zh-MY",
      }],
      ...overrides,
    }),
    assets: extraAssets,
    environment: "staging",
    jobId: id(91),
    upload,
    seed: 42,
  });
}

describe("canonical LOCAL_GPU package transport", () => {
  it("maps the authorized character and product, and keeps creative text in the prompt", () => {
    const result = map();
    expect(result.dispatch).toBe(false);
    expect(result.submit).toBe(false);
    expect(result.automaticGenerationRetry).toBe(0);
    expect(result.remoteProviderFallback).toBe(0);
    expect(result.deterministicPromptEnforcement).toBe(false);
    expect(result.audioExpectation).toBe("NO_DIALOGUE_WITH_AMBIENT_AUDIO");
    expect(result.audioPolicy).toBe("NATIVE");
    expect(result.desktop.workflow).toBe("MINIMAX_H3_R2V");
    expect(result.desktop.durationSec).toBe(6);
    expect(result.desktop.aspectRatio).toBe("9:16");
    expect(result.desktop.references.map((reference) => reference.assetUrl)).toEqual([
      "https://assets.example.test/character.png",
      "https://assets.example.test/product.png",
    ]);
    expect(result.desktop.references.map((reference) => reference.contentHash)).toEqual([characterHash, productHash]);
    expect(result.desktop.prompt).toContain("label faces camera");
    expect(result.desktop.prompt).toContain("slow push in");
    expect(result.desktop.prompt).toContain("bottle stays in contact with the table");
    expect(result.desktop.prompt).toContain("matte black 500ml");
    expect(result.desktop.prompt).toContain("720p");
    expect(result.desktop).not.toHaveProperty("firstFrame");
    expect(result.desktop).not.toHaveProperty("voiceDna");
    expect(result.desktop).not.toHaveProperty("dialogue");
  });

  it("accepts one stored asset resolved for several canonical roles and still rejects conflicting resolutions", () => {
    const duplicated = [...assets, asset(productAssetId, productHash, "product")];
    expect(map({}, duplicated).desktop.references.map((reference) => reference.contentHash)).toEqual([characterHash, productHash]);
    const conflicting = [...assets, { ...asset(productAssetId, productHash, "product"), workspaceId: id(4) }];
    expect(code(() => map({}, conflicting))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  });

  it("does not select the first uploaded image when it is not the authorized character", () => {
    const selected = map().desktop.references[0];
    expect(assets[0]?.assetId).toBe(otherAssetId);
    expect(selected?.assetUrl).toBe("https://assets.example.test/character.png");
  });

  it("rejects an ambiguous character reference and a character that is not the authorized identity", () => {
    expect(code(() => map({
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
        { authorityType: "CHARACTER", authorityId: characterId, assetId: otherAssetId, contentHash: hash("9") },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
      ],
    }))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(code(() => map({
      references: [
        { authorityType: "CHARACTER", authorityId: id(99), assetId: characterAssetId, contentHash: characterHash },
      ],
      productAuthority: null,
    }))).toBe("LOCAL_GPU_CHARACTER_REFERENCE_REQUIRED");
  });

  it("uses the selected product material and variant, not a different product asset", () => {
    const selectedId = id(25);
    const selectedHash = hash("7");
    const result = map({
      productAuthority: {
        assetId: productAssetId,
        contentHash: productHash,
        confirmedVariant: "matte black 500ml",
        selectedMaterialAssetId: selectedId,
        selectedMaterialContentHash: selectedHash,
        selection: "SOURCE_ASSET",
      },
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: selectedId, contentHash: selectedHash },
      ],
    }, [...assets, asset(selectedId, selectedHash, "variant")]);
    expect(result.desktop.references[1]).toEqual(expect.objectContaining({
      role: "PRODUCT",
      assetUrl: "https://assets.example.test/variant.png",
      contentHash: selectedHash,
    }));
    expect(result.desktop.prompt).toContain("matte black 500ml");
  });

  it("rejects a product hash mismatch, a third reference, and a location reference", () => {
    expect(code(() => map({}, [asset(characterAssetId, characterHash, "character"), asset(productAssetId, hash("1"), "wrong")]))).toBe(
      "LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED",
    );
    expect(code(() => map({
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "OTHER", authorityId: id(14), assetId: otherAssetId, contentHash: hash("9") },
      ],
    }))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(code(() => map({
      references: [
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "LOCATION", authorityId: id(15), assetId: otherAssetId, contentHash: hash("9") },
      ],
      characterAuthority: null,
    }))).toBe("LOCAL_GPU_LOCATION_REFERENCE_UNSUPPORTED");
  });

  it("blocks a required first frame instead of substituting a product image", () => {
    expect(code(() => map({
      references: [
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "FIRST_FRAME", authorityId: id(16), assetId: frameAssetId, contentHash: frameHash },
      ],
      characterAuthority: null,
    }))).toBe("LOCAL_GPU_FRAME_TRANSPORT_UNSUPPORTED");
  });

  it("keeps native dialogue and pinned voice DNA off the desktop body", () => {
    expect(code(() => map({ recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE" }))).toBe("LOCAL_GPU_DISPATCH_DISABLED");
    expect(code(() => map({ dialogue: [{ text: "Hello" }] }))).toBe("LOCAL_GPU_DISPATCH_DISABLED");
    expect(code(() => mapCanonicalPackageToLocalGpuDesktop({
      package: pkg(),
      assets,
      environment: "staging",
      jobId: id(90),
      upload,
      pinnedVoiceDna: { voiceDnaId: id(17) },
    }))).toBe("LOCAL_GPU_VOICE_DNA_UNSUPPORTED");
  });

  it("projects approved visible dialogue and authority references into signed Contract V3 material", () => {
    const result = mapNativeDialogue();
    expect(result.body).toMatchObject({
      contractVersion: 3,
      environment: "staging",
      workflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      audioPolicy: "NATIVE",
      voiceInstructions: null,
      seed: 42,
      dialogue: [{
        speakerId: characterId,
        text: "妈，你每天这样做，不累咩？",
        language: "zh-MY",
      }],
    });
    expect(result.body.references).toEqual([
      expect.objectContaining({ role: "CHARACTER", contentHash: characterHash }),
      expect.objectContaining({ role: "PRODUCT", contentHash: productHash }),
    ]);
    expect(result.body.creative).toMatchObject({
      characters: [{
        subjectId: characterId,
        dnaFingerprint: hash("a"),
        references: [expect.objectContaining({ contentHash: characterHash })],
      }],
      products: [{ references: [expect.objectContaining({ contentHash: productHash })] }],
    });
    expect(result.creativeBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(result.uploadBinding).toMatch(/^[0-9a-f]{64}$/);
    const withScene = mapNativeDialogue({
      references: [
        { authorityType: "LOCATION", authorityId: id(15), assetId: otherAssetId, contentHash: hash("9") },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
      ],
    });
    expect(withScene.body.references).toEqual([
      expect.objectContaining({ role: "CHARACTER" }),
      expect.objectContaining({ role: "PRODUCT" }),
      expect.objectContaining({ role: "SCENE" }),
    ]);
    expect(withScene.body.creative).toMatchObject({
      scene: { subjectId: id(40), references: [expect.objectContaining({ contentHash: hash("9") })] },
    });
  });

  it("fails closed for speaker, audio, character, and reference authority mismatches", () => {
    expect(code(() => mapNativeDialogue({
      dialogue: [{ speakerCharacterId: characterId, text: "Hello", offscreen: true, locale: "en" }],
    }))).toBe("LOCAL_GPU_NATIVE_DIALOGUE_SPEAKER_MISMATCH");
    expect(code(() => mapNativeDialogue({
      dialogue: [{ speakerCharacterId: id(99), text: "Hello", offscreen: false, locale: "en" }],
    }))).toBe("LOCAL_GPU_NATIVE_DIALOGUE_SPEAKER_MISMATCH");
    expect(code(() => mapNativeDialogue({ characterAuthority: null }))).toBe("LOCAL_GPU_CHARACTER_AUTHORITY_REQUIRED");
    expect(code(() => mapNativeDialogue({ generateAudio: false, audioBlocked: true }))).toBe("LOCAL_GPU_AUDIO_POLICY_INVALID");
    expect(code(() => mapNativeDialogue({
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
        { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
        { authorityType: "LOCATION", authorityId: id(15), assetId: otherAssetId, contentHash: hash("9") },
        { authorityType: "SCENE", authorityId: id(18), assetId: frameAssetId, contentHash: frameHash },
      ],
    }, [...assets, asset(frameAssetId, frameHash, "scene")]))).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  });

  it("rejects unsupported workflows and preserves ambient audio separately from silence", () => {
    expect(code(() => map({ recommendedWorkflow: "WAN_I2V" }))).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(code(() => map({ recommendedWorkflow: "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1" }))).toBe("LOCAL_GPU_DISPATCH_DISABLED");
    const silent = map({ generateAudio: false, audioBlocked: true });
    expect(silent.audioExpectation).toBe("SILENT_OUTPUT");
    expect(silent.audioPolicy).toBe("REMOVE_AUDIO");
    expect(code(() => mapCanonicalPackageToLocalGpuDesktop({
      package: pkg(),
      assets,
      environment: "staging",
      jobId: id(90),
      upload,
      audioExpectation: "SILENT_OUTPUT",
    }))).toBe("LOCAL_GPU_AUDIO_POLICY_INVALID");
  });

  it("rejects a reference from another workspace", () => {
    expect(code(() => map({}, [{ ...asset(characterAssetId, characterHash, "character"), workspaceId: id(4) }, asset(productAssetId, productHash, "product")]))).toBe(
      "LOCAL_GPU_REFERENCE_WORKSPACE_MISMATCH",
    );
  });

  it("does not invent a product image when the package has no product visual", () => {
    const result = map({
      productAuthority: {
        assetId: productAssetId,
        contentHash: productHash,
        confirmedVariant: "matte black 500ml",
        selectedMaterialAssetId: null,
        selectedMaterialContentHash: null,
        selection: "NO_PRODUCT_VISUAL_INPUT",
      },
      references: [
        { authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash },
      ],
    });
    expect(result.desktop.references).toEqual([
      expect.objectContaining({ role: "CHARACTER", assetUrl: "https://assets.example.test/character.png" }),
    ]);
    expect(result.desktop.prompt).toContain("matte black 500ml");
    expect(code(() => map({
      characterAuthority: null,
      productAuthority: null,
      references: [],
    }))).toBe("LOCAL_GPU_REFERENCES_REQUIRED");
  });
});

describe("LOCAL_GPU sequential release eligibility", () => {
  const scene2 = pkg({
    order: 2,
    references: [
      { authorityType: "PRODUCT", authorityId: id(13), assetId: productAssetId, contentHash: productHash },
      { authorityType: "FIRST_FRAME", authorityId: id(16), assetId: frameAssetId, contentHash: frameHash },
    ],
    characterAuthority: null,
  });
  const predecessor = {
    order: 1,
    packageId: id(31),
    packageFingerprint: hash("f"),
    executionPlanId: id(50),
    workspaceId,
    storyVersionId: id(60),
    approved: true,
    failed: false,
    frameAssetId,
    frameContentHash: frameHash,
    resultSourceKind: "LOCAL_GPU_WORKER" as const,
  };

  it("authorizes scene 1 and scene 2 without submitting, then blocks the missing frame transport", () => {
    const first = authorizeLocalGpuSequentialRelease({
      package: pkg(),
      expectedPackageFingerprint: hash("f"),
      existingGate: null,
      predecessor: null,
    });
    expect(first).toMatchObject({ eligible: true, dispatch: false, submit: false, executionMode: "LOCAL_GPU", sceneOrder: 1, successorOfPackageId: null });
    const second = authorizeLocalGpuSequentialRelease({
      package: scene2,
      expectedPackageFingerprint: hash("f"),
      existingGate: null,
      predecessor,
    });
    expect(second.successorOfPackageId).toBe(id(31));
    expect(second.dispatch).toBe(false);
    expect(code(() => mapCanonicalPackageToLocalGpuDesktop({
      package: scene2,
      assets: [...assets, asset(frameAssetId, frameHash, "frame")],
      environment: "staging",
      jobId: id(91),
      upload,
    }))).toBe("LOCAL_GPU_FRAME_TRANSPORT_UNSUPPORTED");
  });

  it("rejects a duplicate gate, a stale fingerprint, a failed predecessor, and a scope mismatch", () => {
    expect(code(() => authorizeLocalGpuSequentialRelease({
      package: pkg(),
      expectedPackageFingerprint: hash("f"),
      existingGate: id(92),
      predecessor: null,
    }))).toBe("LOCAL_GPU_DUPLICATE_SUBMIT");
    expect(code(() => authorizeLocalGpuSequentialRelease({
      package: pkg(),
      expectedPackageFingerprint: hash("0"),
      existingGate: null,
      predecessor: null,
    }))).toBe("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
    expect(code(() => authorizeLocalGpuSequentialRelease({
      package: scene2,
      expectedPackageFingerprint: hash("f"),
      existingGate: null,
      predecessor: { ...predecessor, failed: true, approved: false },
    }))).toBe("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
    expect(code(() => authorizeLocalGpuSequentialRelease({
      package: scene2,
      expectedPackageFingerprint: hash("f"),
      existingGate: null,
      predecessor: { ...predecessor, storyVersionId: id(61) },
    }))).toBe("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
    expect(code(() => authorizeLocalGpuSequentialRelease({
      package: scene2,
      expectedPackageFingerprint: hash("f"),
      existingGate: null,
      predecessor: null,
    }))).toBe("SEQUENTIAL_LOCAL_PREDECESSOR_REQUIRED");
  });
});

describe("native dialogue Contract V3 request boundary", () => {
  const secret = "native-dialogue-test-secret";
  const now = new Date("2026-10-19T00:00:00.000Z");
  const scope = { workspaceId, sceneExecutionId: id(40), packageId: id(30) };
  const actor = { userId: id(16), workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const };
  const capabilities = (certified: boolean) => ({
    contractVersion: 3,
    acceptedContracts: [1, 2, 3],
    contracts: { v3: { workflows: { MINIMAX_H3_NATIVE_DIALOGUE: {
      execution: "enabled",
      implemented: true,
      modelInstalled: true,
      buildExecutable: true,
      nativeDialogue: "PROMPT_CONDITIONED",
      e2eCertified: certified,
    } } } },
  });
  const adapter = (environment: "staging" | "production", calls: Parameters<typeof LocalGpuCloudAdapter>[1] extends never ? never : unknown) => new LocalGpuCloudAdapter(
    loadLocalGpuConfigFromEnv({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_ENVIRONMENT: environment,
      LOCAL_GPU_SIGNING_SECRET: secret,
      LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
    }),
    calls as ConstructorParameters<typeof LocalGpuCloudAdapter>[1],
    { now: () => now, nonce: () => "native-dialogue-nonce" },
  );

  it("signs and posts the exact canonical request once in staging", async () => {
    const attempts: Parameters<ConstructorParameters<typeof LocalGpuCloudAdapter>[1]>[0][] = [];
    const cloud = adapter("staging", async (attempt: Parameters<ConstructorParameters<typeof LocalGpuCloudAdapter>[1]>[0]) => {
      attempts.push(attempt);
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    const jobId = cloud.jobIdFor(scope);
    const transport = mapCanonicalPackageToLocalGpuNativeDialogueV3({
      package: pkg({ recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE", dialogue: [{
        speakerCharacterId: characterId, speakerLabel: "Yuki", text: "你好", offscreen: false, locale: "zh-MY",
      }] }),
      assets, environment: "staging", jobId, upload, seed: 42,
    });
    const result = await cloud.submitNativeDialogueV3({
      actor, package: scope, request: transport.body, creativeBinding: transport.creativeBinding,
      capabilities: capabilities(false), existingGate: null,
    });
    expect(result).toMatchObject({ workflow: "MINIMAX_H3_NATIVE_DIALOGUE", state: "QUEUED", automaticGenerationRetry: 0, remoteProviderFallback: 0 });
    expect(attempts).toHaveLength(1);
    expect(JSON.parse(attempts[0]!.body!)).toEqual(transport.body);
    const claims = verifyLocalGpuRequest({
      secret,
      token: attempts[0]!.headers.authorization.replace("Bearer ", ""),
      now,
      workspaceId,
      environment: "staging",
    });
    expect(claims).toMatchObject({ workflow: "MINIMAX_H3_NATIVE_DIALOGUE", creativeBinding: transport.creativeBinding });
  });

  it("does not post to Production until Desktop reports real E2E certification", async () => {
    let calls = 0;
    const cloud = adapter("production", async () => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    const jobId = cloud.jobIdFor(scope);
    const productionUpload = { ...upload, environment: "production" as const };
    const transport = mapCanonicalPackageToLocalGpuNativeDialogueV3({
      package: pkg({ recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE", dialogue: [{
        speakerCharacterId: characterId, speakerLabel: "Yuki", text: "Hello", offscreen: false, locale: "en",
      }] }),
      assets, environment: "production", jobId, upload: productionUpload, seed: 42,
    });
    await expect(cloud.submitNativeDialogueV3({
      actor, package: scope, request: transport.body, creativeBinding: transport.creativeBinding,
      capabilities: capabilities(false), existingGate: null, productionDispatchAuthorized: true,
    })).rejects.toThrow("LOCAL_GPU_NATIVE_DIALOGUE_NOT_CERTIFIED");
    expect(calls).toBe(0);
  });
});

describe("LOCAL_GPU execution stays closed", () => {
  it("keeps provider dispatch and normal-user access disabled, and leaves Manual Local unwired", () => {
    expect(() => resolveExplicitLocalGpuProviderAuthority({ requestedProvider: "LOCAL_GPU" })).toThrow("LOCAL_GPU_PROVIDER_DISABLED");
    expect(() => assertLocalGpuAccess({
      userId: id(1),
      workspaceId,
      organizationPlan: null,
      platformAdminStatus: "DENIED",
    }, { workspaceId })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    const processors = readFileSync(join(root, "apps/worker/src/processors/index.ts"), "utf8");
    const execute = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"), "utf8");
    const sequential = readFileSync(join(root, "packages/agents/src/ai-story/sequential-local-generation.ts"), "utf8");
    expect(processors).toContain("runWorkerLocalGpuDispatchCycle(process.env)");
    expect(execute).not.toContain("local-gpu-package-transport");
    expect(sequential).not.toContain("local-gpu-package-transport");
    expect(sequential).toContain('executionMode: "MANUAL_LOCAL"');
  });
});
