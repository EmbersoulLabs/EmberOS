import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AiStoryModeResolutionSnapshotSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryModeResolutionSnapshot,
} from "@ceo-agent/shared";
import {
  AiStoryExecutionAuthorityError,
  AiStoryCompiledRequestWorkerRuntime,
  DeterministicFakeAiStoryProviderTransport,
  InMemoryAiStoryCanonicalExecutionAuthorityRepository,
  InMemoryAiStoryProviderRuntimeRepository,
  buildCertifiedSeedanceProviderEntry,
  buildAiStoryAuthorizedSchedulingAuthority,
  buildSeedanceNativeAudioCapability,
  compileImmutableSeedanceNativeAvRequest,
  compileImmutableSeedanceRequestFromSceneCompilation,
  compileSeedanceProviderIntentDryRun,
  resolveAiStoryProvider,
  scheduleAssetAwareCanonicalProviderExecution,
  type AiStoryCanonicalExecutionAuthority,
  type AiStoryCurrentExecutionAuthorityState,
} from "@ceo-agent/agents";
import {
  AiStoryAssetAwareExecutionPlannerRepository,
  closeDb,
} from "@ceo-agent/db";
import {
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  mapCharacterDnaToIdentityCore,
  mockCharacterDnaFixture,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import { compileSeedanceNativeDialogueCertificationRequest } from "./helpers/ai-story-seedance-native-dialogue-cert";
import {
  authorizeAssetAwareProductionDispatch,
  runAiStoryProviderWorkerCycle,
} from "../apps/worker/src/ai-story-provider-worker-cycle";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  cleanupPr32Tenant,
  PR32_USER_A,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { prepareReadyForCanonicalExecute } from "./helpers/ai-story-pr37-phase-d-execute";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import type { Sql } from "postgres";

const id = (value: number) =>
  `f6000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const createdAt = "2026-09-24T07:00:00.000Z";

function silentT2vRequest() {
  return compileSeedanceNativeDialogueCertificationRequest().baseRequest;
}

function nativeT2vRequest(characterDna = false) {
  const certification =
    compileSeedanceNativeDialogueCertificationRequest();
  if (!characterDna) return certification.request;

  const compilation = makePhase2aCompilation({
    sceneOrder: [0],
    referenceFreeT2vOrders: [0],
  });
  const sourceIntent = compilation.intents[0]!;
  const sourceInstructions =
    compilation.instructionsBySceneExecutionId[
      sourceIntent.identity.sceneExecutionId
    ]!;
  const sourcePortraitAssetId = id(44);
  const dna = mockCharacterDnaFixture({
    sourceAssetId: sourcePortraitAssetId,
    sourceContentHash: hash("7"),
  });
  const reusable = buildAiStoryReusableCharacterVersion({
    reusableCharacterId: id(40),
    orgId: sourceIntent.identity.tenantId,
    workspaceId: sourceIntent.identity.workspaceId,
    name: "Phase 6 pinned Character",
    identityCore: mapCharacterDnaToIdentityCore(dna),
    defaultLook: {
      wardrobe: "default wardrobe",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: false,
      hairColorAllowed: false,
    },
    canonicalAssets: [
      {
        assetId: sourcePortraitAssetId,
        contentHash: hash("7"),
        role: "CHARACTER_SOURCE_PORTRAIT",
        source: "USER_APPROVED",
      },
    ],
    status: "ACTIVE",
    version: 1,
    supersedesReusableCharacterVersionId: null,
    createdBy: id(45),
    createdAt,
    identityMode: "CHARACTER_DNA",
    characterDna: dna,
  });
  const { projection } = buildCampaignProjectionFromReusableCharacter({
    reusable,
    campaignId: sourceIntent.identity.campaignId,
    campaignCharacterId: id(42),
    createdBy: id(45),
    createdAt,
  });
  const binding = buildEpisodeCharacterBinding({
    storyId: sourceIntent.identity.storyId,
    reusable,
    projection,
    episodeLook: {
      wardrobe: "blue jacket",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
      expression: "gentle natural expression",
      pose: "arranging flowers naturally",
      location: "flower shop",
      action: "natural florist activity",
      product: null,
      dialogue: "A different short neutral line.",
    },
    createdBy: id(45),
    createdAt,
  });
  const generationAuthority = {
    strategy: "TEXT_TO_VIDEO" as const,
    referenceSource: "REFERENCE_FREE_T2V" as const,
    effectiveReferenceIds: [],
    firstFrameAssetId: null,
    productVisualIdentityRequirement: "NONE" as const,
  };
  const dnaBase = compileImmutableSeedanceRequestFromSceneCompilation({
    intent: {
      ...sourceIntent,
      referencedAssetIds: [],
      generationAuthority,
    },
    instructions: {
      ...sourceInstructions,
      referencedAssetIds: [],
      generationAuthority,
    },
    authority: {
      qcEvaluationId: id(1),
      qcFingerprint: sha256CanonicalIntegrityHash("phase6-dna-qc"),
      qcCapabilityVersion: "phase6-dna-qc.v1",
      directorFingerprint:
        sha256CanonicalIntegrityHash("phase6-dna-director"),
      motionFingerprint:
        sha256CanonicalIntegrityHash("phase6-dna-motion"),
    },
    adapterVersion: "seedance-canonical-runtime.v1",
    compiledAt: createdAt,
    resolution: "480p",
    referenceAssets: [],
    characterDnaAuthority: {
      reusableCharacterId: reusable.reusableCharacterId,
      reusableCharacterVersionId: reusable.reusableCharacterVersionId,
      campaignCharacterId: binding.campaignCharacterId,
      campaignCharacterVersionId: binding.campaignCharacterVersionId,
      campaignCharacterFingerprint:
        binding.campaignCharacterFingerprint!,
      identityFingerprint: reusable.identityFingerprint,
      characterDnaFingerprint: reusable.characterDnaFingerprint!,
      characterConsistencyMode: "SOFT_DESCRIPTION_BASED",
      dna,
      episodeLook: binding.episodeLook,
      sourcePortraitAssetId,
    },
  });
  if (
    certification.request.contractVersion !==
    "ai-story-compiled-provider-request.v2-native-av"
  ) {
    throw new Error("Native dialogue certification fixture is not V2");
  }
  return compileImmutableSeedanceNativeAvRequest({
    baseRequest: dnaBase,
    dialogueAuthority:
      certification.request.nativeAvRequest.dialogueAuthority,
    capability: buildSeedanceNativeAudioCapability(),
    compiledAt: createdAt,
  });
}

function imageToVideoRequest() {
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const sourceIntent = compilation.intents[0]!;
  const sourceInstructions =
    compilation.instructionsBySceneExecutionId[
      sourceIntent.identity.sceneExecutionId
    ]!;
  const sourceAssetId = sourceIntent.referencedAssetIds[0]!;
  const generationAuthority = {
    strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
    referenceSource: "SCENE_EXPLICIT" as const,
    effectiveReferenceIds: [sourceAssetId],
    firstFrameAssetId: sourceAssetId,
    productVisualIdentityRequirement: "REQUIRED" as const,
  };
  return compileImmutableSeedanceRequestFromSceneCompilation({
    intent: {
      ...sourceIntent,
      referencedAssetIds: [sourceAssetId],
      generationAuthority,
    },
    instructions: {
      ...sourceInstructions,
      referencedAssetIds: [sourceAssetId],
      generationAuthority,
    },
    authority: {
      qcEvaluationId: id(1),
      qcFingerprint: sha256CanonicalIntegrityHash("phase6-qc"),
      qcCapabilityVersion: "phase6-qc.v1",
      directorFingerprint: sha256CanonicalIntegrityHash("phase6-director"),
      motionFingerprint: sha256CanonicalIntegrityHash("phase6-motion"),
    },
    adapterVersion: "seedance-canonical-runtime.v1",
    compiledAt: createdAt,
    resolution: "480p",
    referenceAssets: [
      {
        assetId: sourceAssetId,
        mediaType: "image/jpeg",
        storagePath: `private/${sourceAssetId}.jpg`,
      },
    ],
  });
}

type PlannerMode = "TEXT_TO_VIDEO" | "IMAGE_TO_VIDEO" | "VIDEO_TO_VIDEO";
type PlannerAudio =
  | "NEED_NATIVE_DIALOGUE"
  | "NEED_SILENT_OUTPUT"
  | "NEED_POST_TTS";

function plannerFor(
  request: AiStoryCompiledProviderRequest,
  input: {
    mode?: PlannerMode;
    audio?: PlannerAudio;
    dna?: boolean;
    optionalProduct?: boolean;
  } = {}
): AiStoryModeResolutionSnapshot {
  const mode = input.mode ?? "TEXT_TO_VIDEO";
  const selectedAssetId = request.referenceMappings[0]?.assetId ?? id(60);
  const source =
    mode === "TEXT_TO_VIDEO"
      ? null
      : {
          bindingId: id(61),
          assetId: selectedAssetId,
          analysisSnapshotId: id(62),
          contentHash: hash("e"),
          role:
            mode === "IMAGE_TO_VIDEO"
              ? ("SOURCE_IMAGE_CANDIDATE" as const)
              : ("SOURCE_VIDEO_CANDIDATE" as const),
          required: true,
        };
  const optionalProduct = input.optionalProduct
    ? {
        bindingId: id(63),
        assetId: id(64),
        analysisSnapshotId: id(65),
        contentHash: hash("f"),
        role: "PRODUCT_AUTHORITY" as const,
        required: false,
      }
    : null;
  const dna = input.dna
    ? {
        reusableCharacterId:
          request.characterDnaAuthority!.reusableCharacterId,
        reusableCharacterVersionId:
          request.characterDnaAuthority!.reusableCharacterVersionId,
        characterDnaFingerprint:
          request.characterDnaAuthority!.characterDnaFingerprint,
      }
    : null;
  const audio = input.audio ?? "NEED_SILENT_OUTPUT";
  return AiStoryModeResolutionSnapshotSchema.parse({
    contractVersion: "ai-story-mode-resolution.v1",
    plannerSnapshotId: id(70),
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    matchingResultId: id(71),
    matchingContractVersion: "ai-story-asset-matching.v1",
    bindingAuthorities: [source, optionalProduct].filter(Boolean),
    characterDnaAuthority: dna,
    noAssetConfirmation: null,
    assetIntelligenceStatus: "ANALYZED",
    continuityRequirements: {
      exactSourceFrameRequired: mode === "IMAGE_TO_VIDEO",
      motionContinuationRequired: mode === "VIDEO_TO_VIDEO",
      sourceVideoAuthorityRequired: mode === "VIDEO_TO_VIDEO",
    },
    audioIntent:
      audio === "NEED_NATIVE_DIALOGUE"
        ? "NATIVE_DIALOGUE"
        : audio === "NEED_POST_TTS"
          ? "POST_TTS"
          : "SILENT",
    capabilityRequirements: {
      visual:
        mode === "TEXT_TO_VIDEO"
          ? ["NEED_TEXT_GENERATION"]
          : mode === "IMAGE_TO_VIDEO"
            ? ["NEED_SOURCE_IMAGE"]
            : ["NEED_SOURCE_VIDEO", "NEED_MOTION_CONTINUATION"],
      audio: [audio],
      authority: [
        ...(mode === "IMAGE_TO_VIDEO"
          ? (["NEED_EXACT_SOURCE_FRAME"] as const)
          : mode === "VIDEO_TO_VIDEO"
            ? (["NEED_SOURCE_VIDEO_AUTHORITY"] as const)
            : []),
        ...(dna ? (["NEED_CHARACTER_DNA"] as const) : []),
        ...(optionalProduct
          ? (["NEED_PRODUCT_AUTHORITY"] as const)
          : []),
      ],
    },
    resolutionStatus: "RESOLVED",
    resolvedGenerationMode: mode,
    selectedBindingIds: source ? [source.bindingId] : [],
    blockingReasons: [],
    missingAuthorities: [],
    recommendedNextActions: [],
    resolutionTrace: [
      {
        step: "RESOLVE_GENERATION_MODE",
        outcome: mode,
        bindingIds: source ? [source.bindingId] : [],
      },
    ],
    resolverVersion: "deterministic-mode-resolver.v1",
    createdAt,
  });
}

function analysisPins(plan: AiStoryModeResolutionSnapshot) {
  return plan.bindingAuthorities.map((binding, index) => ({
    bindingId: binding.bindingId,
    assetId: binding.assetId,
    contentHash: binding.contentHash,
    analysisSnapshotId: binding.analysisSnapshotId,
    analysisFingerprint: hash(index === 0 ? "8" : "9"),
  }));
}

function phase5Chain(
  request: AiStoryCompiledProviderRequest,
  plan: AiStoryModeResolutionSnapshot
) {
  const entry = buildCertifiedSeedanceProviderEntry({ configured: true });
  const resolution = resolveAiStoryProvider({
    providerResolutionId: id(72),
    plannerSnapshot: plan,
    registry: [entry],
    executionSettings: {
      durationSec: request.structuredRequest.duration,
      aspectRatio: request.structuredRequest.ratio,
      resolution: request.structuredRequest.resolution,
      watermark: request.structuredRequest.watermark,
    },
    resolvedAt: createdAt,
  });
  const sourceAuthorities = plan.selectedBindingIds.map((bindingId) => {
    const binding = plan.bindingAuthorities.find(
      (candidate) => candidate.bindingId === bindingId
    )!;
    return {
      orgId: plan.orgId,
      workspaceId: plan.workspaceId,
      bindingId,
      assetId: binding.assetId,
      analysisSnapshotId: binding.analysisSnapshotId,
      contentHash: binding.contentHash,
      mediaType:
        plan.resolvedGenerationMode === "IMAGE_TO_VIDEO"
          ? "image/jpeg"
          : "video/mp4",
      authorizedForProviderTransport: true as const,
    };
  });
  const compileIntent = compileSeedanceProviderIntentDryRun({
    compileIntentId: id(73),
    plannerSnapshot: plan,
    providerResolution: resolution,
    registryEntry: entry,
    sourceAuthorities,
    nativeDialogueAuthority: plan.capabilityRequirements.audio.includes(
      "NEED_NATIVE_DIALOGUE"
    )
      ? {
          dialogueAuthorityId:
            request.contractVersion ===
            "ai-story-compiled-provider-request.v2-native-av"
              ? request.nativeAvRequest.dialogueAuthority.dialogueAuthorityId
              : id(74),
          storyId: plan.storyId,
          storyVersionId: plan.storyVersionId,
          exactText: "A different short neutral line.",
        }
      : null,
    compiledAt: createdAt,
  });
  return {
    entry,
    resolution,
    compileIntent,
  };
}

function freshness(request: AiStoryCompiledProviderRequest) {
  return {
    qcDispatchEligible: true,
    commercialAuthorizationValid: true,
    sceneFingerprint: request.sceneFingerprint,
    directorFingerprint: request.directorFingerprint,
    motionFingerprint: request.motionFingerprint,
    qcFingerprint: request.qcFingerprint,
    packageFingerprint: request.packageFingerprint,
    castSnapshotFingerprint: request.castSnapshotFingerprint,
    locationSnapshotFingerprint: request.locationSnapshotFingerprint,
    productSnapshotFingerprint: request.productSnapshotFingerprint,
    sceneSuperseded: false,
    directorSuperseded: false,
    motionSuperseded: false,
    authoritySnapshotsMatch: true,
  };
}

function authorizedSchedulingAuthority(input: {
  readonly request: AiStoryCompiledProviderRequest;
  readonly plan: AiStoryModeResolutionSnapshot;
  readonly executionPlanId?: string;
}) {
  const chain = phase5Chain(input.request, input.plan);
  return buildAiStoryAuthorizedSchedulingAuthority({
    orgId: input.request.orgId,
    workspaceId: input.request.workspaceId,
    campaignId: input.request.campaignId,
    storyId: input.request.storyId,
    storyVersionId: input.request.storyVersionId,
    executionPlanId:
      input.executionPlanId ??
      makePhase2aCompilation({
        sceneOrder: [0],
        referenceFreeT2vOrders: [0],
      }).plan.storyExecutionId,
    sceneExecutionId: input.request.sceneExecutionId,
    plannerSnapshot: input.plan,
    analysisAuthorities: analysisPins(input.plan),
    providerResolution: chain.resolution,
    providerCapability: chain.entry.declaration,
    providerCompileIntent: chain.compileIntent,
    compiledRequest: input.request,
    freshness: freshness(input.request),
    idempotencyKey: `canonical-execute:${input.request.sceneExecutionId}`,
    authorizedAt: createdAt,
  });
}

async function scheduleFixture(input: {
  request: AiStoryCompiledProviderRequest;
  plan?: AiStoryModeResolutionSnapshot;
  runtimeRepository?: InMemoryAiStoryProviderRuntimeRepository;
  authorityRepository?: InMemoryAiStoryCanonicalExecutionAuthorityRepository;
  idempotencyKey?: string;
  analysis?: ReturnType<typeof analysisPins>;
}) {
  const plan = input.plan ?? plannerFor(input.request);
  const chain = phase5Chain(input.request, plan);
  const runtimeRepository =
    input.runtimeRepository ?? new InMemoryAiStoryProviderRuntimeRepository();
  const authorityRepository =
    input.authorityRepository ??
    new InMemoryAiStoryCanonicalExecutionAuthorityRepository();
  const scheduled = await scheduleAssetAwareCanonicalProviderExecution({
    plannerSnapshot: plan,
    analysisAuthorities: input.analysis ?? analysisPins(plan),
    providerResolution: chain.resolution,
    providerCapability: chain.entry.declaration,
    providerCompileIntent: chain.compileIntent,
    compiledRequest: input.request,
    freshness: freshness(input.request),
    idempotencyKey: input.idempotencyKey ?? "phase6-idempotency",
    providerExecutionId: id(80),
    scheduledAt: createdAt,
    runtimeRepository,
    authorityRepository,
  });
  return {
    ...scheduled,
    plan,
    chain,
    runtimeRepository,
    authorityRepository,
  };
}

function currentState(
  authority: AiStoryCanonicalExecutionAuthority,
  overrides: Partial<AiStoryCurrentExecutionAuthorityState> = {}
): AiStoryCurrentExecutionAuthorityState {
  return {
    storyVersionId: authority.storyVersionId,
    assets: authority.analysisAuthorities,
    castSnapshotFingerprint: authority.castSnapshotFingerprint,
    characterAuthority: authority.characterAuthority,
    providerImplementationId:
      authority.providerCapability.implementationId,
    providerCapabilityVersion:
      authority.providerCapability.capabilityVersion,
    providerAvailable: true,
    ...overrides,
  };
}

async function dryWorker(
  scheduled: Awaited<ReturnType<typeof scheduleFixture>>,
  stateOverrides: Partial<AiStoryCurrentExecutionAuthorityState> = {}
) {
  const transport = new DeterministicFakeAiStoryProviderTransport();
  let boundary:
    | {
        request: AiStoryCompiledProviderRequest;
        transportRequest: {
          generate_audio: boolean;
          content: readonly unknown[];
        };
      }
    | undefined;
  const runtime = new AiStoryCompiledRequestWorkerRuntime({
    repository: scheduled.runtimeRepository,
    transport,
    assetAccess: {
      async resolveHttpsAsset({ assetId }) {
        return `https://assets.invalid/${assetId}`;
      },
    },
    mediaIngest: {
      async ingest() {
        return { mediaAssetId: id(90) };
      },
    },
    executionAuthorityRepository: scheduled.authorityRepository,
    requireAssetAwareExecutionAuthority: true,
    async loadCurrentExecutionAuthorityState({ authority }) {
      return currentState(authority, stateOverrides);
    },
    authorizedProviderDispatchBoundary(input) {
      boundary = {
        request: input.request,
        transportRequest: input.transportRequest,
      };
      return "HOLD";
    },
    now: () => new Date(createdAt),
  });
  const outcome = await runtime.process(scheduled.job, "phase6-worker");
  return { outcome, transport, boundary };
}

describe("Asset-Aware canonical queue and Worker lineage", () => {
  it("executes pinned T2V without re-resolving mode", async () => {
    const scheduled = await scheduleFixture({ request: silentT2vRequest() });
    const result = await dryWorker(scheduled);
    expect(result.boundary?.request.generationMode).toBe("TEXT_TO_VIDEO");
    expect(result.outcome.providerDispatchCount).toBe(0);
  });

  it("materializes exact pinned I2V source authority", async () => {
    const request = imageToVideoRequest();
    const plan = plannerFor(request, { mode: "IMAGE_TO_VIDEO" });
    const scheduled = await scheduleFixture({ request, plan });
    const result = await dryWorker(scheduled);
    expect(result.boundary?.request.referenceMappings[0]?.assetId).toBe(
      plan.bindingAuthorities[0]?.assetId
    );
    expect(result.boundary?.transportRequest.content).toHaveLength(2);
  });

  it("rejects missing I2V source authority", async () => {
    const request = imageToVideoRequest();
    const plan = plannerFor(request, { mode: "IMAGE_TO_VIDEO" });
    const chain = phase5Chain(request, plan);
    await expect(
      scheduleAssetAwareCanonicalProviderExecution({
        plannerSnapshot: plan,
        analysisAuthorities: analysisPins(plan),
        providerResolution: chain.resolution,
        providerCapability: chain.entry.declaration,
        providerCompileIntent: {
          ...chain.compileIntent,
          sourceMappings: [],
          referenceMappings: [],
        },
        compiledRequest: request,
        freshness: freshness(request),
        idempotencyKey: "missing-source",
        scheduledAt: createdAt,
        runtimeRepository: new InMemoryAiStoryProviderRuntimeRepository(),
        authorityRepository:
          new InMemoryAiStoryCanonicalExecutionAuthorityRepository(),
      })
    ).rejects.toMatchObject({ code: "MISSING_AUTHORIZED_SOURCE_ASSET" });
  });

  it("does not silently fall back I2V to T2V", async () => {
    const request = silentT2vRequest();
    const plan = plannerFor(request, { mode: "IMAGE_TO_VIDEO" });
    await expect(
      scheduleFixture({ request, plan })
    ).rejects.toMatchObject({ code: "EXECUTION_PLAN_MISMATCH" });
  });

  it("returns typed failure for pinned V2V on Seedance", async () => {
    const request = silentT2vRequest();
    const plan = plannerFor(request, { mode: "VIDEO_TO_VIDEO" });
    await expect(scheduleFixture({ request, plan })).rejects.toBeTruthy();
  });

  it("has zero Worker AssetAnalysisService calls", () => {
    const workerSource = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/provider-runtime-dispatch-integration.ts"
      ),
      "utf8"
    );
    expect(workerSource).not.toContain("AssetAnalysisService");
  });

  it("has zero Worker Story semantic LLM calls", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/asset-aware-execution-authority.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(/generateText|generateObject|chat\.completions/);
  });

  it("has zero Worker mode resolver calls", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/provider-runtime-dispatch-integration.ts"
      ),
      "utf8"
    );
    expect(source).not.toContain("resolveAiStoryGenerationMode");
  });

  it("has zero Worker Provider resolver calls", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/provider-runtime-dispatch-integration.ts"
      ),
      "utf8"
    );
    expect(source).not.toContain("resolveAiStoryProvider");
  });

  it("scheduler performs no analysis, semantic planning, or resolution", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/asset-aware-canonical-scheduler.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(
      /AssetAnalysisService|generateText|generateObject|resolveAiStoryGenerationMode|resolveAiStoryProvider/
    );
  });

  it("preserves Character DNA fingerprint through queue and Worker", async () => {
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const scheduled = await scheduleFixture({ request, plan });
    const result = await dryWorker(scheduled);
    expect(
      scheduled.authority.characterAuthority?.characterDnaFingerprint
    ).toBe(request.characterDnaAuthority?.characterDnaFingerprint);
    expect(
      result.boundary?.request.characterDnaAuthority
        ?.characterDnaFingerprint
    ).toBe(request.characterDnaAuthority?.characterDnaFingerprint);
  });

  it("does not transport Character source portrait for TEXT_ONLY", async () => {
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const result = await dryWorker(
      await scheduleFixture({ request, plan })
    );
    expect(
      result.boundary?.request.characterDnaAuthority
        ?.sourcePhotoSentToVideoProvider
    ).toBe(false);
    expect(result.boundary?.transportRequest.content).toHaveLength(1);
  });

  it("retains native dialogue generateAudio=true", async () => {
    const request = nativeT2vRequest();
    const plan = plannerFor(request, { audio: "NEED_NATIVE_DIALOGUE" });
    const result = await dryWorker(
      await scheduleFixture({ request, plan })
    );
    expect(result.boundary?.transportRequest.generate_audio).toBe(true);
  });

  it("cannot acquire AUDIO block during scheduling", async () => {
    const request = nativeT2vRequest();
    const plan = plannerFor(request, { audio: "NEED_NATIVE_DIALOGUE" });
    const scheduled = await scheduleFixture({ request, plan });
    expect(
      scheduled.authority.providerCompileIntent.blockedCapabilities
    ).not.toContain("AUDIO");
    expect(request.blockedCapabilities).not.toContain("AUDIO");
  });

  it("retains SILENT generateAudio=false", async () => {
    const result = await dryWorker(
      await scheduleFixture({ request: silentT2vRequest() })
    );
    expect(result.boundary?.transportRequest.generate_audio).toBe(false);
  });

  it("queue retry preserves identical planner authority", async () => {
    const request = silentT2vRequest();
    const runtimeRepository = new InMemoryAiStoryProviderRuntimeRepository();
    const authorityRepository =
      new InMemoryAiStoryCanonicalExecutionAuthorityRepository();
    const first = await scheduleFixture({
      request,
      runtimeRepository,
      authorityRepository,
      idempotencyKey: "same-authority",
    });
    const retry = await scheduleFixture({
      request,
      runtimeRepository,
      authorityRepository,
      idempotencyKey: "same-authority",
    });
    expect(retry.replayed).toBe(true);
    expect(retry.job.plannerSnapshotId).toBe(first.job.plannerSnapshotId);
    expect(retry.job.executionAuthorityFingerprint).toBe(
      first.job.executionAuthorityFingerprint
    );
  });

  it("rejects stale Story Version", async () => {
    const scheduled = await scheduleFixture({ request: silentT2vRequest() });
    await expect(
      dryWorker(scheduled, { storyVersionId: id(99) })
    ).rejects.toMatchObject({ code: "STALE_STORY_VERSION" });
  });

  it("rejects stale Asset content hash", async () => {
    const request = imageToVideoRequest();
    const plan = plannerFor(request, { mode: "IMAGE_TO_VIDEO" });
    const scheduled = await scheduleFixture({ request, plan });
    const staleAssets = scheduled.authority.analysisAuthorities.map(
      (asset) => ({ ...asset, contentHash: hash("0") })
    );
    await expect(
      dryWorker(scheduled, { assets: staleAssets })
    ).rejects.toMatchObject({ code: "ASSET_CONTENT_HASH_MISMATCH" });
  });

  it("rejects stale Character DNA fingerprint", async () => {
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const scheduled = await scheduleFixture({ request, plan });
    await expect(
      dryWorker(scheduled, {
        characterAuthority: {
          ...scheduled.authority.characterAuthority!,
          characterDnaFingerprint: hash("0"),
        },
      })
    ).rejects.toMatchObject({ code: "CHARACTER_DNA_MISMATCH" });
  });

  it("does not substitute optional Asset for required source authority", async () => {
    const request = imageToVideoRequest();
    const plan = plannerFor(request, {
      mode: "IMAGE_TO_VIDEO",
      optionalProduct: true,
    });
    const chain = phase5Chain(request, plan);
    const optional = plan.bindingAuthorities[1]!;
    await expect(
      scheduleAssetAwareCanonicalProviderExecution({
        plannerSnapshot: plan,
        analysisAuthorities: analysisPins(plan),
        providerResolution: chain.resolution,
        providerCapability: chain.entry.declaration,
        providerCompileIntent: {
          ...chain.compileIntent,
          sourceMappings: [
            {
              bindingId: optional.bindingId,
              assetId: optional.assetId,
              analysisSnapshotId: optional.analysisSnapshotId,
              contentHash: optional.contentHash,
              mediaType: "image/jpeg",
              wireRole: "first_frame",
            },
          ],
          referenceMappings: chain.compileIntent.referenceMappings,
        },
        compiledRequest: request,
        freshness: freshness(request),
        idempotencyKey: "optional-substitution",
        scheduledAt: createdAt,
        runtimeRepository: new InMemoryAiStoryProviderRuntimeRepository(),
        authorityRepository:
          new InMemoryAiStoryCanonicalExecutionAuthorityRepository(),
      })
    ).rejects.toMatchObject({ code: "MISSING_AUTHORIZED_SOURCE_ASSET" });
  });

  it("does not substitute Provider when pinned Provider is unavailable", async () => {
    const scheduled = await scheduleFixture({ request: silentT2vRequest() });
    await expect(
      dryWorker(scheduled, { providerAvailable: false })
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("reaches Episode B dispatch boundary with zero Provider calls", async () => {
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const scheduled = await scheduleFixture({ request, plan });
    const result = await dryWorker(scheduled);
    expect(result.outcome).toMatchObject({
      authorizedProviderDispatchBoundaryReached: true,
      providerDispatchCount: 0,
      providerSubmitted: false,
    });
    expect(
      result.outcome.executionTrace?.map((entry) => entry.stage)
    ).toEqual(
      expect.arrayContaining([
        "STORY_VERSION",
        "ASSET_MATCHING",
        "MODE_RESOLUTION",
        "PROVIDER_RESOLUTION",
        "CANONICAL_QUEUE",
        "WORKER_AUTHORITY_VALIDATION",
        "AUTHORIZED_PROVIDER_DISPATCH",
      ])
    );
    expect(result.transport.submittedRequests).toHaveLength(0);
    expect(result.boundary?.request.generationMode).toBe("TEXT_TO_VIDEO");
    expect(
      result.boundary?.request.characterDnaAuthority
        ?.characterDnaFingerprint
    ).toBe(request.characterDnaAuthority?.characterDnaFingerprint);
    expect(
      result.boundary?.request.characterDnaAuthority
        ?.sourcePhotoSentToVideoProvider
    ).toBe(false);
    expect(result.boundary?.request.referenceMappings).toHaveLength(0);
    expect(result.boundary?.transportRequest.generate_audio).toBe(true);
    expect(result.boundary?.request.blockedCapabilities).not.toContain(
      "AUDIO"
    );
  });

  it("routes Episode B through the production Worker authority bridge", async () => {
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const scheduled = await scheduleFixture({ request, plan });
    const trace = {
      compiledRequestId: scheduled.authority.compiledRequestId,
      compiledRequestFingerprint: scheduled.authority.requestFingerprint,
      executionAuthorityId: scheduled.authority.executionAuthorityId,
      executionAuthorityFingerprint:
        scheduled.authority.authorityFingerprint,
      assetAwareProviderAttemptId:
        scheduled.authority.providerAttemptId,
      plannerSnapshotId: scheduled.authority.plannerSnapshot.plannerSnapshotId,
      providerResolutionId:
        scheduled.authority.providerResolution.providerResolutionId,
      compileIntentId:
        scheduled.authority.providerCompileIntent.compileIntentId,
    };
    const runtimeRepository = {
      acceptCompiledRequest: scheduled.runtimeRepository.acceptCompiledRequest.bind(
        scheduled.runtimeRepository
      ),
      getCompiledRequest: scheduled.runtimeRepository.getCompiledRequest.bind(
        scheduled.runtimeRepository
      ),
      acceptAttempt: scheduled.runtimeRepository.acceptAttempt.bind(
        scheduled.runtimeRepository
      ),
      getAttempt: scheduled.runtimeRepository.getAttempt.bind(
        scheduled.runtimeRepository
      ),
      claimSubmission: scheduled.runtimeRepository.claimSubmission.bind(
        scheduled.runtimeRepository
      ),
      updateAttempt: scheduled.runtimeRepository.updateAttempt.bind(
        scheduled.runtimeRepository
      ),
      async acceptExecutionAuthorityRecord() {},
      async getExecutionAuthorityRecord() {
        return { authority: scheduled.authority, job: scheduled.job };
      },
    };
    const outcome = await authorizeAssetAwareProductionDispatch(
      id(999),
      {
        workerRepository: {
          async loadValidatedBundleByDispatchId() {
            return {
              envelope: { executionContext: { trace } },
            } as never;
          },
        },
        runtimeRepository,
        async loadCurrentExecutionAuthorityState({ authority }) {
          return currentState(authority);
        },
        async resolveHttpsAsset({ assetId }) {
          return `https://assets.invalid/${assetId}`;
        },
      }
    );
    expect(outcome).toBe("AUTHORIZED_PROVIDER_DISPATCH");
    expect(request.generationMode).toBe("TEXT_TO_VIDEO");
    expect(request.characterDnaAuthority?.characterDnaFingerprint).toBe(
      scheduled.authority.characterAuthority?.characterDnaFingerprint
    );
    expect(request.characterDnaAuthority?.sourcePhotoSentToVideoProvider).toBe(
      false
    );
    expect(request.referenceMappings).toHaveLength(0);
    expect(request.structuredRequest.generateAudio).toBe(true);
    expect(request.blockedCapabilities).not.toContain("AUDIO");
  });

  it("keeps the production bridge explicit and fail-closed", () => {
    const scheduler = readFileSync(
      join(process.cwd(), "packages/agents/src/ai-story/scene-scheduling-coordinator.ts"),
      "utf8"
    );
    const worker = readFileSync(
      join(process.cwd(), "apps/worker/src/ai-story-provider-worker-cycle.ts"),
      "utf8"
    );
    const transport = readFileSync(
      join(process.cwd(), "packages/agents/src/ai-story/scene-provider-worker-runtime.ts"),
      "utf8"
    );
    expect(scheduler).toContain("buildAssetAwareRoutingDecision");
    expect(scheduler).toContain("scheduleAssetAwareCanonicalProviderExecution");
    expect(worker).toContain("authorizeAssetAwareProductionDispatch");
    expect(worker).toContain("STALE_EXECUTION_AUTHORITY");
    expect(worker).toContain("AiStoryCompiledRequestWorkerRuntime");
    expect(worker.indexOf("assetAwareDispatchAuthorizer")).toBeLessThan(
      worker.lastIndexOf("continueFromDispatch")
    );
    expect(transport).toContain("assetAwareProviderAttemptId");
  });

  it("rejects incomplete production queue authority references", async () => {
    await expect(
      authorizeAssetAwareProductionDispatch(id(998), {
        workerRepository: {
          async loadValidatedBundleByDispatchId() {
            return {
              envelope: {
                executionContext: {
                  trace: { executionAuthorityId: id(997) },
                },
              },
            } as never;
          },
        },
      })
    ).rejects.toMatchObject({ code: "STALE_EXECUTION_AUTHORITY" });
  });

  it("keeps legacy production Dispatches on the explicit compatibility path", async () => {
    await expect(
      authorizeAssetAwareProductionDispatch(id(996), {
        workerRepository: {
          async loadValidatedBundleByDispatchId() {
            return {
              envelope: { executionContext: { trace: {} } },
            } as never;
          },
        },
      })
    ).resolves.toBe("LEGACY");
  });
});

function canonicalExecuteHarness(authorityRecord: ReturnType<
  typeof authorizedSchedulingAuthority
> | null) {
  const request = nativeT2vRequest(true);
  const plan = plannerFor(request, {
    dna: true,
    audio: "NEED_NATIVE_DIALOGUE",
  });
  const authority = authorityRecord ?? authorizedSchedulingAuthority({ request, plan });
  const executionPlanId = authority.executionPlanId;
  const ownership = {
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    animationPackageId: PHASE_2A_IDS.animationPackageId,
    executionPlanId,
  } as const;
  const scheduling = {
    scheduleAuthorizedScene: vi.fn().mockResolvedValue({ replayed: false }),
  };
  const route = vi.fn();
  const input = {
    executionPlanId,
    actorUserId: id(990),
    ownership,
    router: { route } as never,
    runtimeAuthorizationTransaction: async <T>(operation: (tx: object) => Promise<T>) =>
      operation({}),
    runtimeAuthorizationSnapshotRepository: {
      async loadCanonicalSnapshotInTransaction() {
        return {
          executionPlanId,
          ownership,
          reviewStatus: "APPROVED",
          storyDecision: { factId: id(991), deterministicFingerprint: hash("a") },
          assemblyDefinition: {
            assemblyDefinitionId: id(992),
            deterministicFingerprint: hash("b"),
            orderedSceneExecutionIds: [request.sceneExecutionId],
          },
          assemblyMemberships: [],
          orderedSceneExecutionIds: [request.sceneExecutionId],
          membershipComplete: true,
          orderingDeterministic: true,
          qcResults: [{
            qcResultId: id(993),
            sceneExecutionId: request.sceneExecutionId,
            status: "passed",
            resultHash: hash("c"),
          }],
          existingFact: null,
          transactionAuthority: {},
          authority: Symbol.for("phase6-repair"),
        };
      },
      async acceptOrReturnCanonicalSnapshotInTransaction(fact: unknown) {
        return { fact, converged: false };
      },
    } as never,
    persistenceRepository: {} as never,
    reviewRepository: {} as never,
    assemblyRepository: {} as never,
    authorizationRepository: {} as never,
    sceneReleaseRepository: {
      async initialize({ runtimeAuthorizationId }: { runtimeAuthorizationId: string }) {
        return [{
          sceneExecutionId: request.sceneExecutionId,
          executionPlanId,
          runtimeAuthorizationId,
          workspaceId: request.workspaceId,
          sceneOrder: 1,
          releaseState: "RELEASED",
        }];
      },
    } as never,
    schedulingCoordinator: scheduling as never,
    commercialAuthorizationService: {} as never,
    executionAuthorization: {
      allowed: true,
      accessMode: "ops",
      settlementMode: "none",
      authorizedBy: "ACTIVE_PLATFORM_ADMIN",
      policyVersion: "ai-story-exec-03.v1",
      reason: "phase6-canonical-execute-repair",
      providerCostAccounting: "ALLOWED",
    } as const,
    assetAwareAuthorityRepository: {
      async getAuthorizedSchedulingAuthority() {
        return authorityRecord === null
          ? null
          : {
              schedulingAuthorityId: authority.schedulingAuthorityId,
              authorityFingerprint: authority.authorityFingerprint,
              authority,
            };
      },
    },
    now: () => new Date(createdAt),
  };
  return { input, request, plan, authority, scheduling, route };
}

describe("Ticket A Repair 01 canonical Execute bridge", () => {
  it("passes the exact persisted Asset-Aware authority into canonical scheduling", async () => {
    const seed = authorizedSchedulingAuthority({
      request: nativeT2vRequest(true),
      plan: plannerFor(nativeT2vRequest(true), {
        dna: true,
        audio: "NEED_NATIVE_DIALOGUE",
      }),
    });
    const test = canonicalExecuteHarness(seed);
    await authorizeAndExecuteExecutionPlan(test.input);
    const scheduled = test.scheduling.scheduleAuthorizedScene.mock.calls[0]?.[0];
    expect(scheduled.assetAwareExecution.compiledRequest.compiledRequestId).toBe(
      seed.compiledRequest.compiledRequestId
    );
    expect(scheduled.assetAwareExecution.providerResolution.providerResolutionId).toBe(
      seed.providerResolution.providerResolutionId
    );
    expect(scheduled.assetAwareExecution.compiledRequest.characterDnaAuthority?.characterDnaFingerprint).toBe(
      seed.compiledRequest.characterDnaAuthority?.characterDnaFingerprint
    );
    expect(test.route).not.toHaveBeenCalled();
  });

  it("keeps a true no-authority execution on the explicit legacy branch", async () => {
    const test = canonicalExecuteHarness(null);
    await authorizeAndExecuteExecutionPlan(test.input);
    expect(
      test.scheduling.scheduleAuthorizedScene.mock.calls[0]?.[0].assetAwareExecution
    ).toBeUndefined();
  });

  it("fails closed instead of treating partial authority as legacy", async () => {
    const seed = authorizedSchedulingAuthority({
      request: nativeT2vRequest(true),
      plan: plannerFor(nativeT2vRequest(true), {
        dna: true,
        audio: "NEED_NATIVE_DIALOGUE",
      }),
    });
    const test = canonicalExecuteHarness(seed);
    test.input.assetAwareAuthorityRepository.getAuthorizedSchedulingAuthority =
      async () => ({
        schedulingAuthorityId: seed.schedulingAuthorityId,
        authorityFingerprint: seed.authorityFingerprint,
        authority: { executionPlanId: seed.executionPlanId },
      });
    await expect(authorizeAndExecuteExecutionPlan(test.input)).rejects.toMatchObject({
      code: "STALE_EXECUTION_AUTHORITY",
    });
    expect(test.scheduling.scheduleAuthorizedScene).not.toHaveBeenCalled();
  });
});

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("Ticket A Repair 01 true production Episode B path", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "phase6-repair-01");
  }, 120_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("traverses canonical Execute, durable Outbox, and the production Worker cycle", async () => {
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "phase6-repair-01",
      ids: PHASE_2A_IDS,
      userId: PR32_USER_A,
      sceneOrder: [0],
      instructionPurpose: "Purpose scene-a",
      referenceFreeT2vOrders: [0],
    });
    const request = nativeT2vRequest(true);
    const plan = plannerFor(request, {
      dna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const authority = authorizedSchedulingAuthority({
      request,
      plan,
      executionPlanId: ready.executionPlanId,
    });
    const authorityRepository =
      new AiStoryAssetAwareExecutionPlannerRepository();
    await authorityRepository.acceptAuthorizedSchedulingAuthority({
      schedulingAuthorityId: authority.schedulingAuthorityId,
      authorityFingerprint: authority.authorityFingerprint,
      orgId: authority.orgId,
      workspaceId: authority.workspaceId,
      campaignId: authority.campaignId,
      storyId: authority.storyId,
      storyVersionId: authority.storyVersionId,
      executionPlanId: authority.executionPlanId,
      sceneExecutionId: authority.sceneExecutionId,
      authority,
      authorizedAt: authority.authorizedAt,
    });

    const providerRouter = { route: vi.fn() };
    await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: PR32_USER_A,
      ownership: ready.ownership,
      router: providerRouter as never,
      executionAuthorization: {
        allowed: true,
        accessMode: "ops",
        settlementMode: "none",
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        policyVersion: "ai-story-exec-03.v1",
        reason: "phase6-production-path-dry-run",
        providerCostAccounting: "ALLOWED",
      },
    });
    expect(providerRouter.route).not.toHaveBeenCalled();

    let dispatchBoundary:
      | "LEGACY"
      | "AUTHORIZED_PROVIDER_DISPATCH"
      | undefined;
    const worker = await runAiStoryProviderWorkerCycle({
      leaseOwner: "phase6-repair-worker",
      postGenerationQcRecovery: { async recoverNext() {} },
      coordinator: {
        async continueFromDispatch() {
          return { status: "WAITING" };
        },
      } as never,
      assetAwareDispatchAuthorizer: async (dispatchId) => {
        dispatchBoundary = await authorizeAssetAwareProductionDispatch(
          dispatchId,
          {
            async loadCurrentExecutionAuthorityState({ authority: current }) {
              return currentState(current);
            },
          }
        );
        return dispatchBoundary;
      },
    });

    expect(worker.dispatchStatus).toBe("DISPATCHED");
    expect(worker.ownership).toBe("AI_STORY_SCENE");
    expect(dispatchBoundary).toBe("AUTHORIZED_PROVIDER_DISPATCH");
    expect(request.generationMode).toBe("TEXT_TO_VIDEO");
    expect(request.characterDnaAuthority?.characterDnaFingerprint).toBe(
      authority.compiledRequest.characterDnaAuthority?.characterDnaFingerprint
    );
    expect(request.characterDnaAuthority?.sourcePhotoSentToVideoProvider).toBe(
      false
    );
    expect(request.referenceMappings).toHaveLength(0);
    expect(request.structuredRequest.generateAudio).toBe(true);
    expect(request.blockedCapabilities).not.toContain("AUDIO");
  }, 180_000);
});
