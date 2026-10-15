import { describe, expect, it } from "vitest";
import type { AiStoryCharacterVoiceDna, AiStoryLocalGenerationPackage } from "@ceo-agent/shared";
import { LocalGpuContractError } from "@ceo-agent/shared/server";
import {
  LocalGpuCloudAdapter,
  prepareLocalGpuR2vDnaHandoff,
  readLocalGpuR2vDnaCapability,
  type LocalGpuResolvedAsset,
} from "../packages/agents/src/ai-story";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = (mark: string) => `sha256:${mark.repeat(64)}`;
const workspaceId = id(3);
const characterId = id(11);
const characterVersionId = id(12);
const characterAssetId = id(21);
const characterHash = hash("c");

const capabilities = {
  contracts: { v3: { workflows: { MINIMAX_H3_R2V: {
    execution: "enabled",
    referenceToVideo: true,
    characterDna: true,
    voiceDna: true,
    sceneExecution: true,
    continuityFrame: false,
    audioPolicies: ["NATIVE", "REMOVE_AUDIO", "SILENT_OUTPUT"],
    missingModels: [],
    e2eCertified: false,
  } } } },
};

const upload = {
  environment: "staging" as const,
  method: "PUT",
  url: "https://uploads.example.test/scene.mp4",
};

const assets: LocalGpuResolvedAsset[] = [{
  assetId: characterAssetId,
  contentHash: characterHash,
  workspaceId,
  assetUrl: "https://assets.example.test/character.png",
}];

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
    prompt: "The recurring character enters the approved scene.",
    dialogue: [],
    generateAudio: false,
    audioBlocked: true,
    characterAuthority: {
      characterId,
      characterVersionId,
      dnaFingerprint: hash("a"),
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: null,
    mustKeep: [],
    mustAvoid: [],
    continuityRequirements: [],
    qcRequirements: [],
    references: [{ authorityType: "CHARACTER", authorityId: characterId, assetId: characterAssetId, contentHash: characterHash }],
    sourceAuthority: { preGenerationQcEvaluationId: id(80) },
    ...overrides,
  } as unknown as AiStoryLocalGenerationPackage;
}

const voiceDna = {
  voiceDnaId: id(90),
  contractVersion: "ai-story-character-voice-dna.v1",
  status: "FROZEN",
  orgId: id(2),
  workspaceId,
  reusableCharacterId: characterId,
  reusableCharacterVersionId: characterVersionId,
  characterIdentityFingerprint: hash("b"),
  primaryLocale: "en-US",
  allowedSecondaryLocales: [],
  codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
  voicePresentation: { genderPresentation: "NEUTRAL", ageRangePresentation: "ADULT" },
  acousticProfile: { register: "MID", pitchIntent: "MEDIUM", resonance: "WARM", brightness: "NATURAL", breathiness: "NATURAL", texture: "clear" },
  speechProfile: { cadence: "measured", defaultPace: "MEASURED", pauseStyle: "NATURAL", emphasisStyle: "EVEN", articulation: "CLEAR", energy: "NATURAL" },
  accentProfile: { locale: "en-US", regionalIntent: "neutral", prohibitedStylizations: [] },
  defaultDeliveryStyle: "CONVERSATIONAL",
  mustPreserve: ["measured cadence"],
  mustAvoid: ["caricature"],
  consistencyMode: "DESCRIPTIVE_VOICE_DNA",
  semanticVoiceContinuity: "PINNED",
  exactAcousticVoiceContinuity: "NOT_CLAIMED",
  voiceDnaFingerprint: hash("v"),
} as AiStoryCharacterVoiceDna;

function code(run: () => unknown): string {
  try { run(); } catch (error) {
    return error instanceof LocalGpuContractError ? error.message : String(error);
  }
  return "";
}

describe("LOCAL_GPU Character DNA + Voice DNA + Scene R2V handoff", () => {
  it("binds approved character, optional voice identity, scene, references, and upload without dispatching", () => {
    const result = prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload, capabilities, voiceDna,
    });
    expect(result).toMatchObject({ dispatch: false, submit: false, e2eCertified: false });
    expect(result.handoff.workflow).toBe("MINIMAX_H3_R2V");
    expect(result.handoff.scene.sceneExecutionId).toBe(id(40));
    expect(result.handoff.audioPolicy).toBe("SILENT_OUTPUT");
    expect(result.handoff.firstFrame).toBeNull();
    expect(result.handoff.characterDna.fingerprint).toBe(hash("a"));
    expect(result.handoff.voiceDna).toMatchObject({
      voiceDnaId: id(90),
      fingerprint: hash("v"),
      exactAcousticVoiceContinuity: "NOT_CLAIMED",
    });
    expect(result.handoff.voiceDna?.semanticInstruction).toContain("Semantic voice continuity is pinned");
    expect(result.handoff.references).toHaveLength(1);
    expect(result.authorityBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(result.uploadBinding).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves the asset R2V workflow when no Voice DNA is pinned", () => {
    const result = prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload,
      capabilities: { contracts: { v3: { workflows: { MINIMAX_H3_R2V: { ...capabilities.contracts.v3.workflows.MINIMAX_H3_R2V, voiceDna: false } } } } },
    });
    expect(result.handoff.voiceDna).toBeNull();
    expect(result.handoff.references[0]?.role).toBe("CHARACTER");
  });

  it("keeps zero-claim Desktop capabilities and mismatched DNA blocked", () => {
    expect(code(() => readLocalGpuR2vDnaCapability({ contractVersion: 3 }, { voiceDnaRequired: true }))).toBe("LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH");
    expect(code(() => readLocalGpuR2vDnaCapability(capabilities, {
      voiceDnaRequired: false,
      continuityFrameRequired: true,
      audioPolicy: "SILENT_OUTPUT",
    }))).toBe("LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH");
    expect(code(() => prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload,
      capabilities: { contracts: { v3: { workflows: { MINIMAX_H3_R2V: { ...capabilities.contracts.v3.workflows.MINIMAX_H3_R2V, voiceDna: false } } } } },
      voiceDna,
    }))).toBe("LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH");
    expect(code(() => prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload, capabilities,
      voiceDna: { ...voiceDna, reusableCharacterId: id(77) },
    }))).toBe("LOCAL_GPU_VOICE_DNA_AUTHORITY_MISMATCH");
    expect(code(() => prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload, capabilities,
      voiceDna: { ...voiceDna, consistencyMode: "REFERENCE_AUDIO_IDENTITY", referenceAudioAssetId: id(75), referenceAudioContentHash: hash("r") },
    }))).toBe("LOCAL_GPU_VOICE_DNA_REFERENCE_AUDIO_UNSUPPORTED");
    expect(code(() => prepareLocalGpuR2vDnaHandoff({
      package: pkg(), assets, environment: "staging", jobId: id(99), upload,
      capabilities: { contracts: { v3: { workflows: { MINIMAX_H3_R2V: { ...capabilities.contracts.v3.workflows.MINIMAX_H3_R2V, audioPolicies: ["NATIVE"] } } } } },
    }))).toBe("LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH");
  });

  it("submits one signed Contract V3 request with bound creative and upload authority", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
    const secret = "r2v-dna-test-secret";
    const now = new Date("2026-10-14T00:00:00.000Z");
    const adapter = new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_ENVIRONMENT: "staging",
      LOCAL_GPU_SIGNING_SECRET: secret,
      LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
    }), async (request) => {
      calls.push(request);
      return { status: 202, body: JSON.stringify({ state: "QUEUED" }) };
    }, { now: () => now, nonce: () => "r2v-dna-nonce" });
    const result = await adapter.submitR2vDna({
      actor: { userId: id(16), workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" },
      package: pkg(), assets, upload, capabilities, voiceDna, existingGate: null,
    });
    expect(result).toMatchObject({ workflow: "MINIMAX_H3_R2V", contractVersion: 3, state: "QUEUED", remoteProviderFallback: 0, automaticGenerationRetry: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://local-gpu.example.test/v1/jobs");
    const body = JSON.parse(calls[0]!.body!) as { workspaceId: string; scene: { sceneExecutionId: string }; upload: typeof upload };
    const token = calls[0]!.headers.authorization.replace(/^Bearer /, "");
    const claims = verifyLocalGpuRequest({ secret, token, now, workspaceId, environment: "staging" });
    expect(claims.workflow).toBe("MINIMAX_H3_R2V");
    expect(claims.sceneExecutionId).toBe(body.scene.sceneExecutionId);
    expect(claims.creativeBinding).toBe(result.creativeBinding);
    expect(body.workspaceId).toBe(workspaceId);
    expect(calls[0]!.body).not.toContain(secret);
  });
});
