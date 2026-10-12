/**
 * Four-scene zero-asset original-character MANUAL_LOCAL chain.
 * Media is local FFmpeg color video, not a paid provider.
 * Visual evidence is a mock of the external vision provider.
 * Package release, media validation, Post-QC, approval, continuity,
 * successor release, and assembly use the production functions.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  AiStoryGenerationResultDecisionSchema,
  AiStoryPostQcObservationSchema,
  type AiStoryGenerationResult,
  type AiStoryLocalGenerationOutput,
  type AiStoryLocalGenerationPackage,
  type AiStoryLocalGenerationPackageV3,
  type AiStoryPostGenerationQcEvaluation,
  type AiStoryPostGenerationQcInputPackage,
} from "@ceo-agent/shared";
import {
  createInMemoryAssemblyArtifactRepository,
  projectApprovedGenerationResult,
} from "@ceo-agent/db";
import {
  AssemblyJobSchema,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyJobIdentity,
  type AssemblySceneMembership,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import {
  AiStoryPostGenerationQcService,
  AssemblyMediaAccessError,
  assertDistinctSceneMediaContent,
  assertGenerationResultApproval,
  assertLocalGenerationDuration,
  buildGenerationResultPostQcInput,
  createFixtureAssemblyMediaAccessPort,
  createInMemoryAssemblyJobRepository,
  createLocalAssemblyArtifactBlobStore,
  extractLocalGenerationEndFrame,
  loadAssemblyRuntimeInput,
  materializeLocalGenerationResult,
  materializeSequentialLocalPackageV3,
  runDeterministicAssemblyRuntime,
  validateLocalGenerationMedia,
  type SequentialContinuityEvidence,
} from "../packages/agents/src/ai-story";

const id = (n: number) =>
  `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const hashText = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashBytes = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const NOW = "2026-10-11T00:00:00.000Z";
const CHARACTER_ID = id(0x10);
const CHARACTER_VERSION_ID = id(0x11);
const DNA = hashText("original-character-zero-asset");

const OWNERSHIP = {
  orgId: id(1),
  workspaceId: id(2),
  campaignId: id(3),
  storyId: id(4),
  storyVersionId: id(5),
  animationPackageId: id(6),
  executionPlanId: id(7),
} as const;
const RUNTIME_ID = id(8);
const ACTOR_ID = id(9);
const SCRIPT_ID = id(0x12);
const HANDOFF_ID = id(0x13);
const DEF_ID = id(0x61);
const SCENE_IDS = ["scene-001", "scene-002", "scene-003", "scene-004"] as const;
const SCENE_EXECUTION_IDS = [id(0x21), id(0x22), id(0x23), id(0x24)] as const;
const ASSET_IDS = [id(0x31), id(0x32), id(0x33), id(0x34)] as const;
const OUTPUT_IDS = [id(0x41), id(0x42), id(0x43), id(0x44)] as const;
const FRAME_ASSET_IDS = [id(0x51), id(0x52), id(0x53), id(0x54)] as const;
const COLORS = ["red", "green", "blue", "yellow"] as const;

type V2 = Extract<AiStoryLocalGenerationPackage, { version: "local-generation-package.v2" }>;

function ffmpegAvailable(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

const describeChain = ffmpegAvailable() ? describe : describe.skip;

function snapshotHash() {
  return buildAssemblyEngineSnapshotContentHash({
    engineName: "ember-story-assembly",
    engineContractVersion: "1",
    engineImplementationVersion: "1.0.0",
    binaryName: "ffmpeg",
    binaryVersion: "6.1.1",
    binaryBuildHash: hashText("assembly-engine"),
    operatingEnvironmentContractVersion: "1",
    containerFormat: "mp4",
    videoCodec: "h264",
    videoCodecProfile: "high",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    frameRatePolicy: "constant-30",
    targetFrameRate: 30,
    timeBasePolicy: "1/15360",
    audioSampleRate: 48000,
    audioChannelPolicy: "stereo",
    streamMappingPolicy: "video-first-audio-second",
    rotationNormalizationPolicy: "apply-and-strip",
    metadataStrippingPolicy: "strip-nonessential",
    timestampNormalizationPolicy: "frozen-constant",
    resolutionNormalizationPolicy: "scale-and-pad",
    aspectRatioNormalizationPolicy: "preserve-with-pad",
    normalizationPolicyVersion: "1",
  });
}

function sampleCenterColor(file: string, seconds: number): { r: number; g: number; b: number } {
  const bytes = execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "crop=iw/2:ih/2:iw/4:ih/4,scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return { r: bytes[0] ?? 0, g: bytes[1] ?? 0, b: bytes[2] ?? 0 };
}

async function generateClip(root: string, name: string, color: string, frequency: number) {
  const path = join(root, name);
  execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=640x360:d=2:r=30`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=2`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ],
    { windowsHide: true },
  );
  const bytes = await readFile(path);
  return { path, bytes, hash: hashBytes(bytes) };
}

function basePackage(order: number): V2 {
  const sceneExecutionId = SCENE_EXECUTION_IDS[order - 1]!;
  return {
    version: "local-generation-package.v2",
    packageId: id(0x70 + order),
    packageFingerprint: hashText(`v2-${order}`),
    executionMode: "MANUAL_LOCAL",
    organizationId: OWNERSHIP.orgId,
    workspaceId: OWNERSHIP.workspaceId,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    executionPlanId: OWNERSHIP.executionPlanId,
    runtimeAuthorizationId: RUNTIME_ID,
    unitId: sceneExecutionId,
    sceneExecutionId,
    sceneId: SCENE_IDS[order - 1]!,
    order,
    durationSec: 2,
    aspectRatio: "16:9",
    resolutionIntent: "720p",
    recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
    generationMode: "TEXT_TO_VIDEO",
    prompt: `Original character scene ${order}`,
    negativePrompt: "",
    dialogue: [],
    generateAudio: false,
    audioBlocked: true,
    characterAuthority: {
      characterId: CHARACTER_ID,
      characterVersionId: CHARACTER_VERSION_ID,
      dnaFingerprint: DNA,
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: null,
    worldDescription: "Zero-asset original character world",
    mustKeep: ["original character identity"],
    mustAvoid: ["product substitution"],
    qcRequirements: [],
    continuityRequirements: ["adjacent continuity"],
    previousUnitEndState: [],
    currentUnitStartState: [],
    expectedEndState: [],
    references: [],
    sourceAuthority: {
      version: "ai-story-local-generation-source-authority.v2",
      localSourceAuthorityId: id(0x80 + order),
      localSourceAuthorityFingerprint: hashText(`source-${order}`),
      orgId: OWNERSHIP.orgId,
      workspaceId: OWNERSHIP.workspaceId,
      campaignId: OWNERSHIP.campaignId,
      storyId: OWNERSHIP.storyId,
      storyVersionId: OWNERSHIP.storyVersionId,
      executionPlanId: OWNERSHIP.executionPlanId,
      runtimeAuthorizationId: RUNTIME_ID,
      sceneExecutionId,
      sceneExecutionFingerprint: hashText(`scene-execution-${order}`),
      instructionContentHash: hashText("instructions"),
      sceneVersionId: id(0x90 + order),
      sceneFingerprint: hashText(`scene-${order}`),
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE",
      },
      generationAuthorityFingerprint: hashText(`generation-${order}`),
      preGenerationQcEvaluationId: id(0xa0 + order),
      preGenerationQcFingerprint: hashText(`pre-qc-${order}`),
      directorFingerprint: hashText("director"),
      motionFingerprint: hashText("motion"),
      scriptVersionId: SCRIPT_ID,
      handoffId: HANDOFF_ID,
      handoffFingerprint: hashText("handoff"),
      characterAuthorityFingerprint: DNA,
      worldAuthorityFingerprint: hashText("world"),
      productMaterialFingerprint: hashText("no-product"),
      productMaterialSelection: null,
    },
    planningAuthority: {
      planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
      sceneVersion: 1,
      scriptVersionId: SCRIPT_ID,
      handoffId: HANDOFF_ID,
      handoffFingerprint: hashText("planning-handoff"),
    },
    instructions: `Generate scene ${order} for the accepted original character`,
    state: "AWAITING_LOCAL_OUTPUT",
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: NOW,
  };
}

function visualEvidence(input: AiStoryPostGenerationQcInputPackage) {
  return input.requirements
    .filter((requirement) => requirement.dimension !== "OUTPUT_INTEGRITY")
    .map((requirement) => AiStoryPostQcObservationSchema.parse({
      observationId: randomUUID(),
      evidenceVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
      requirementId: requirement.requirementId,
      source: "AI_VISUAL_EVIDENCE",
      summary: `Observed requirement ${requirement.requirementId} for ${input.sceneId}.`,
      observableSignal: "SATISFIED",
      confidence: { level: "HIGH", score: 1, evidenceQuality: "STRONG" },
      timeRangeMs: null,
      subjects: [CHARACTER_ID],
      artifactSeverity: null,
      subjectiveTasteOnly: false,
    }));
}

describeChain("zero-asset original character four-scene MANUAL_LOCAL chain", () => {
  let root = "";
  const clips: { path: string; bytes: Buffer; hash: string }[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ember-manual-local-chain-"));
    for (const [index, color] of COLORS.entries()) {
      clips.push(await generateClip(
        root,
        `${SCENE_IDS[index]}.mp4`,
        color,
        220 * (index + 1),
      ));
    }
  }, 120_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("releases, validates, approves, continues, assembles, and plays four distinct scenes", async () => {
    expect(new Set(clips.map((clip) => clip.hash)).size).toBe(4);
    const persistedQc: AiStoryPostGenerationQcEvaluation[] = [];
    const qcService = new AiStoryPostGenerationQcService({
      repository: {
        async getByIdentity() {
          return null;
        },
        async accept(evaluation) {
          persistedQc.push(evaluation);
          return { evaluation, replayed: false };
        },
      },
      evidenceProvider: {
        providerId: "deterministic-fake-visual-evidence",
        contractVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
        analyze: async (input) => visualEvidence(input),
      },
    });
    const blockedQc = new AiStoryPostGenerationQcService({
      repository: {
        async getByIdentity() {
          return null;
        },
        async accept(evaluation) {
          return { evaluation, replayed: false };
        },
      },
      evidenceProvider: {
        providerId: "deterministic-fake-visual-evidence",
        contractVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
        analyze: async () => [],
      },
    });

    const evidence: {
      sceneId: string;
      executionUnitId: string;
      packageId: string;
      generatedAssetId: string;
      contentSha256: string;
      postQc: string;
      humanApproval: string;
      endFrameId: string;
      assemblyPosition: number;
    }[] = [];
    const packages: AiStoryLocalGenerationPackageV3[] = [];
    const results: AiStoryGenerationResult[] = [];
    const approved: CanonicalSceneResult[] = [];
    let predecessor: SequentialContinuityEvidence | null = null;

    for (let index = 0; index < 4; index += 1) {
      const clip = clips[index]!;
      const peers = clips.slice(0, index).map((item, peerIndex) => ({
        sceneExecutionId: SCENE_EXECUTION_IDS[peerIndex]!,
        contentHash: item.hash,
      }));
      assertDistinctSceneMediaContent({
        sceneExecutionId: SCENE_EXECUTION_IDS[index]!,
        contentHash: clip.hash,
        peers,
      });
      const probe = await validateLocalGenerationMedia(clip.bytes, clip.hash, false);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.width).toBe(640);
      expect(probe.height).toBe(360);
      assertLocalGenerationDuration({ actualSec: probe.durationMs / 1000, targetSec: 2 });
      const pkg = materializeSequentialLocalPackageV3({
        basePackage: basePackage(index + 1),
        release: {
          releaseRevision: index,
          releasedBy: ACTOR_ID,
          releasedAt: NOW,
        },
        predecessor,
      });
      expect(pkg.executionMode).toBe("MANUAL_LOCAL");
      expect(pkg.characterAuthority?.characterId).toBe(CHARACTER_ID);
      expect(pkg.productAuthority).toBeNull();
      expect(pkg.sceneExecutionId).toBe(SCENE_EXECUTION_IDS[index]);
      expect(pkg.unitId).toBe(SCENE_EXECUTION_IDS[index]);
      expect(JSON.stringify(pkg)).not.toContain("proposed_character");
      if (index === 0) {
        expect(pkg.visualStartAuthority.sourceType).toBe("NONE");
        expect(pkg.predecessorAuthority).toBeNull();
      } else {
        expect(pkg.visualStartAuthority).toMatchObject({
          sourceType: "PREDECESSOR_CONTINUITY",
          assetId: predecessor!.frame.frameAssetId,
          contentHash: predecessor!.frame.contentHash,
        });
      }

      const output: AiStoryLocalGenerationOutput = {
        outputId: OUTPUT_IDS[index]!,
        packageId: pkg.packageId,
        unitId: pkg.unitId,
        sceneExecutionId: pkg.sceneExecutionId,
        assetId: ASSET_IDS[index]!,
        contentHash: clip.hash,
        mediaType: "video/mp4",
        durationSec: probe.durationMs / 1000,
        width: probe.width,
        height: probe.height,
        uploadedBy: ACTOR_ID,
        uploadedAt: NOW,
        qcState: "PENDING",
        continuityFrameAssetId: null,
      };
      const storagePath = `${OWNERSHIP.workspaceId}/ai-story/local-generation/${pkg.packageId}/${output.assetId}.mp4`;
      const result = materializeLocalGenerationResult({
        package: pkg,
        output,
        animationPackageId: OWNERSHIP.animationPackageId,
        sceneId: pkg.sceneId,
        sceneOrder: index,
        storagePath,
        byteSize: clip.bytes.length,
        decodable: true,
      });
      expect(result.source).toEqual({
        sourceKind: "MANUAL_LOCAL",
        providerAttemptId: null,
        localGenerationOutputId: output.outputId,
        localWorkerOutputId: null,
      });
      expect(result.media.contentHash).toBe(clip.hash);
      expect(result.ownership.storyVersionId).toBe(OWNERSHIP.storyVersionId);
      const qcInput = buildGenerationResultPostQcInput(result, pkg);
      if (index === 0) {
        const blocked = await blockedQc.evaluate(qcInput);
        expect(blocked.evaluation.aggregateStatus).not.toBe("POST_QC_PASS");
      }
      const qc = await qcService.evaluate(qcInput);
      expect(qc.evaluation.aggregateStatus).toBe("POST_QC_PASS");
      expect(qc.evaluation.mediaContentHash).toBe(clip.hash);
      expect(qc.evaluation.autoApproved).toBe(false);
      assertGenerationResultApproval(result, qc.evaluation);
      const decision = AiStoryGenerationResultDecisionSchema.parse({
        decisionId: id(0xb0 + index + 1),
        generationResultId: result.generationResultId,
        postQcEvaluationId: qc.evaluation.postQcEvaluationId,
        decision: "APPROVED",
        actorUserId: ACTOR_ID,
        rationale: `Approve distinct local media for ${pkg.sceneId}`,
        decidedAt: NOW,
      });
      expect(() => projectApprovedGenerationResult(result, {
        ...decision,
        decision: "REJECTED",
        decisionId: id(0xc0 + index + 1),
      })).toThrow("GENERATION_RESULT_APPROVAL_REQUIRED");
      const frameBytes = await extractLocalGenerationEndFrame(clip.bytes, result.media.contentHash);
      const frame = {
        frameAssetId: FRAME_ASSET_IDS[index]!,
        contentHash: frameBytes.contentHash,
        sourceContentHash: result.media.contentHash,
        extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
        extractedAt: NOW,
      };
      expect(frame.contentHash).not.toBe(result.media.contentHash);
      const projected = projectApprovedGenerationResult(result, decision);
      expect(projected.sceneOrder).toBe(index);
      expect(projected.mediaReference?.contentHash).toBe(clip.hash);
      packages.push(pkg);
      results.push(result);
      approved.push(projected);
      evidence.push({
        sceneId: pkg.sceneId,
        executionUnitId: pkg.sceneExecutionId,
        packageId: pkg.packageId,
        generatedAssetId: result.media.assetId,
        contentSha256: result.media.contentHash,
        postQc: qc.evaluation.aggregateStatus,
        humanApproval: decision.decision,
        endFrameId: frame.frameAssetId,
        assemblyPosition: index + 1,
      });
      predecessor = {
        predecessorPackage: pkg,
        generationResult: result,
        postQc: qc.evaluation,
        decision,
        frame,
      };
    }

    expect(() => materializeSequentialLocalPackageV3({
      basePackage: { ...basePackage(2), workspaceId: id(0x99) },
      release: { releaseRevision: 1, releasedBy: ACTOR_ID, releasedAt: NOW },
      predecessor: predecessor && {
        predecessorPackage: packages[0]!,
        generationResult: results[0]!,
        postQc: persistedQc[0]!,
        decision: AiStoryGenerationResultDecisionSchema.parse({
          decisionId: id(0xb1),
          generationResultId: results[0]!.generationResultId,
          postQcEvaluationId: persistedQc[0]!.postQcEvaluationId,
          decision: "APPROVED",
          actorUserId: ACTOR_ID,
          rationale: "Approve distinct local media for scene-001",
          decidedAt: NOW,
        }),
        frame: {
          frameAssetId: FRAME_ASSET_IDS[0]!,
          contentHash: hashText("frame-1"),
          sourceContentHash: clips[0]!.hash,
          extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
          extractedAt: NOW,
        },
      },
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
    expect(() => assertDistinctSceneMediaContent({
      sceneExecutionId: SCENE_EXECUTION_IDS[1]!,
      contentHash: clips[0]!.hash,
      peers: [{ sceneExecutionId: SCENE_EXECUTION_IDS[0]!, contentHash: clips[0]!.hash }],
    })).toThrow("LOCAL_GENERATION_DUPLICATE_SCENE_CONTENT");
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: basePackage(2),
      release: { releaseRevision: 1, releasedBy: ACTOR_ID, releasedAt: NOW },
      predecessor: {
        predecessorPackage: packages[0]!,
        generationResult: results[0]!,
        postQc: persistedQc[0]!,
        decision: {
          decisionId: id(0xb1),
          generationResultId: results[0]!.generationResultId,
          postQcEvaluationId: persistedQc[0]!.postQcEvaluationId,
          decision: "REJECTED",
          actorUserId: ACTOR_ID,
          rationale: "Missing approval",
          decidedAt: NOW,
        },
        frame: {
          frameAssetId: FRAME_ASSET_IDS[0]!,
          contentHash: hashText("frame-1"),
          sourceContentHash: clips[0]!.hash,
          extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
          extractedAt: NOW,
        },
      },
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: { ...basePackage(2), storyVersionId: id(0x98) },
      release: { releaseRevision: 1, releasedBy: ACTOR_ID, releasedAt: NOW },
      predecessor: {
        predecessorPackage: packages[0]!,
        generationResult: results[0]!,
        postQc: persistedQc[0]!,
        decision: {
          decisionId: id(0xb1),
          generationResultId: results[0]!.generationResultId,
          postQcEvaluationId: persistedQc[0]!.postQcEvaluationId,
          decision: "APPROVED",
          actorUserId: ACTOR_ID,
          rationale: "Stale version",
          decidedAt: NOW,
        },
        frame: {
          frameAssetId: FRAME_ASSET_IDS[0]!,
          contentHash: hashText("frame-1"),
          sourceContentHash: clips[0]!.hash,
          extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
          extractedAt: NOW,
        },
      },
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");

    const orderedHashes = approved.map((scene) => scene.mediaReference!.contentHash);
    const identity = buildAssemblyJobIdentity({
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      orderedSceneResultIds: approved.map((scene) => scene.sceneResultId),
      orderedSceneContentHashes: orderedHashes,
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash(),
    });
    const job = AssemblyJobSchema.parse({
      assemblyJobId: identity.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      runtimeAuthorizationId: RUNTIME_ID,
      ownership: OWNERSHIP,
      orderedSceneResultIds: approved.map((scene) => scene.sceneResultId),
      orderedSceneContentHashes: orderedHashes,
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash()),
      assemblyEngineSnapshotHash: snapshotHash(),
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: NOW,
    });
    const definition: StoryAssemblyDefinition = {
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      orgId: OWNERSHIP.orgId,
      workspaceId: OWNERSHIP.workspaceId,
      campaignId: OWNERSHIP.campaignId,
      storyId: OWNERSHIP.storyId,
      storyVersionId: OWNERSHIP.storyVersionId,
      animationPackageId: OWNERSHIP.animationPackageId,
      sceneCount: 4,
      orderedSceneExecutionIds: [...SCENE_EXECUTION_IDS],
      createdBy: ACTOR_ID,
      createdAt: NOW,
      contractVersion: "1",
      deterministicFingerprint: hashText("assembly-definition"),
    };
    const memberships: AssemblySceneMembership[] = SCENE_IDS.map((sceneId, index) => ({
      membershipId: id(0xd0 + index + 1),
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_IDS[index]!,
      sceneId,
      sceneOrder: index,
      contractVersion: "1",
      deterministicFingerprint: clips[index]!.hash,
    }));
    expect(() => loadAssemblyRuntimeInput({
      job,
      definition,
      memberships: [
        { ...memberships[0]!, sceneExecutionId: SCENE_EXECUTION_IDS[1]!, sceneId: SCENE_IDS[1]! },
        { ...memberships[1]!, sceneExecutionId: SCENE_EXECUTION_IDS[0]!, sceneId: SCENE_IDS[0]! },
        memberships[2]!,
        memberships[3]!,
      ],
      sceneResults: approved,
    })).toThrow(/order/i);

    const blobRoot = join(root, "assembly");
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map(approved.map((scene, index) => [scene.sceneResultId, clips[index]!.path])),
      OWNERSHIP,
    );
    await expect(mediaAccess.resolveToLocalPath({
      ownership: { ...OWNERSHIP, workspaceId: id(0x99) },
      scene: {
        sceneResultId: approved[0]!.sceneResultId,
        sceneExecutionId: approved[0]!.sceneExecutionId,
        sceneId: approved[0]!.sceneId,
        sceneOrder: approved[0]!.sceneOrder,
        contentHash: clips[0]!.hash,
        mediaReference: approved[0]!.mediaReference!,
        durationMs: approved[0]!.durationMs!,
      },
      workDir: root,
    })).rejects.toBeInstanceOf(AssemblyMediaAccessError);
    const assembled = await runDeterministicAssemblyRuntime({
      assemblyJobId: job.assemblyJobId,
      sources: { definition, memberships, sceneResults: approved },
      jobRepository: createInMemoryAssemblyJobRepository([job]),
      artifactRepository: createInMemoryAssemblyArtifactRepository(),
      mediaAccess,
      blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
    });
    expect(assembled.status).toBe("SUCCEEDED");
    if (assembled.status !== "SUCCEEDED") return;
    expect(assembled.artifact.artifactReference.startsWith(`${OWNERSHIP.workspaceId}/`)).toBe(true);
    expect(assembled.artifact.durationMs).toBeGreaterThanOrEqual(7_000);
    expect(assembled.artifact.durationMs).toBeLessThanOrEqual(9_000);
    const assembledPath = join(blobRoot, assembled.artifact.artifactReference);
    const downloaded = await readFile(assembledPath);
    expect(hashBytes(downloaded)).toBe(assembled.artifact.contentHash);
    const colors = [0.4, 2.4, 4.4, 6.4].map((second) => sampleCenterColor(assembledPath, second));
    expect(colors[0]!.r).toBeGreaterThan(colors[0]!.g + 40);
    expect(colors[1]!.g).toBeGreaterThan(colors[1]!.r + 40);
    expect(colors[2]!.b).toBeGreaterThan(colors[2]!.r + 40);
    expect(colors[3]!.r).toBeGreaterThan(150);
    expect(colors[3]!.g).toBeGreaterThan(150);
    expect(colors[3]!.b).toBeLessThan(80);
    expect(evidence.map((row) => row.assemblyPosition)).toEqual([1, 2, 3, 4]);
    expect(new Set(evidence.map((row) => row.contentSha256)).size).toBe(4);
    console.info(JSON.stringify(evidence));
  }, 180_000);
});
