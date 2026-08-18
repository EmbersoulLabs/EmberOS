/**
 * Sprint 3 PR 3.6 — Deterministic Assembly Runtime unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  ASSEMBLY_RUNTIME_FAILURE_POLICIES,
  ASSEMBLY_RUNTIME_FAILURE_CLASSIFICATIONS,
  AssemblyJobSchema,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyExecutionIdentity,
  buildAssemblyJobIdentity,
  redactSensitiveAssemblyValue,
  type AssemblyJob,
  type AssemblySceneMembership,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import {
  loadAssemblyRuntimeInput,
  AssemblyRuntimeInputError,
  buildAssemblyNormalizationPlan,
  buildNormalizationFilter,
  projectAssemblyRuntime,
  buildAssemblyProcessingStartedFact,
  buildAssemblyFailedFact,
  resolveWorkspaceScopedObjectKey,
  AssemblyMediaAccessError,
} from "../packages/agents/src/ai-story";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
} as const;

const DEF_ID = "10000000-0000-4000-8000-000000000401";
const SCENE_EXEC_A = "10000000-0000-4000-8000-000000000201";
const SCENE_EXEC_B = "10000000-0000-4000-8000-000000000202";
const SCENE_RESULT_A = "10000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "10000000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AUTH_ID = "10000000-0000-5000-8000-000000000401";

function snapshotHash() {
  return buildAssemblyEngineSnapshotContentHash({
    engineName: "ember-story-assembly",
    engineContractVersion: "1",
    engineImplementationVersion: "1.0.0",
    binaryName: "ffmpeg",
    binaryVersion: "6.1.1",
    binaryBuildHash:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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

function makeJob(overrides: Partial<AssemblyJob> = {}): AssemblyJob {
  const orderedSceneResultIds =
    overrides.orderedSceneResultIds ?? [SCENE_RESULT_A, SCENE_RESULT_B];
  const orderedSceneContentHashes =
    overrides.orderedSceneContentHashes ?? [HASH_A, HASH_B];
  const assemblyEngineSnapshotHash =
    overrides.assemblyEngineSnapshotHash ?? snapshotHash();
  const identity = buildAssemblyJobIdentity({
    executionPlanId: OWNERSHIP.executionPlanId,
    assemblyDefinitionId: DEF_ID,
    orderedSceneResultIds,
    orderedSceneContentHashes,
    assemblyContractVersion: "1",
    assemblyEngineSnapshotHash,
  });
  return AssemblyJobSchema.parse({
    assemblyJobId: overrides.assemblyJobId ?? identity.assemblyJobId,
    executionPlanId: OWNERSHIP.executionPlanId,
    assemblyDefinitionId: DEF_ID,
    runtimeAuthorizationId: AUTH_ID,
    ownership: OWNERSHIP,
    orderedSceneResultIds,
    orderedSceneContentHashes,
    assemblyContractVersion: "1",
    assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(assemblyEngineSnapshotHash),
    assemblyEngineSnapshotHash,
    deterministicFingerprint: identity.deterministicFingerprint,
    acceptedAt: "2026-08-06T05:00:00.000Z",
    ...overrides,
  });
}

function makeDefinition(
  ordered: string[] = [SCENE_EXEC_A, SCENE_EXEC_B]
): StoryAssemblyDefinition {
  return {
    assemblyDefinitionId: DEF_ID,
    executionPlanId: OWNERSHIP.executionPlanId,
    orgId: OWNERSHIP.orgId,
    workspaceId: OWNERSHIP.workspaceId,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
    sceneCount: ordered.length,
    orderedSceneExecutionIds: ordered,
    createdBy: AUTH_ID,
    createdAt: "2026-08-06T04:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: HASH_A,
  };
}

function makeMemberships(): AssemblySceneMembership[] {
  return [
    {
      membershipId: "10000000-0000-4000-8000-000000000501",
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXEC_A,
      sceneId: "scene-a",
      sceneOrder: 0,
      contractVersion: "1",
      deterministicFingerprint: HASH_A,
    },
    {
      membershipId: "10000000-0000-4000-8000-000000000502",
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXEC_B,
      sceneId: "scene-b",
      sceneOrder: 1,
      contractVersion: "1",
      deterministicFingerprint: HASH_B,
    },
  ];
}

function makeResult(
  overrides: Partial<CanonicalSceneResult> & {
    sceneResultId: string;
    sceneExecutionId: string;
    sceneId: string;
    sceneOrder: number;
    contentHash: string;
  }
): CanonicalSceneResult {
  return {
    sceneResultId: overrides.sceneResultId,
    executionPlanId: OWNERSHIP.executionPlanId,
    sceneRuntimeId: "10000000-0000-4000-8000-000000000601",
    sceneExecutionId: overrides.sceneExecutionId,
    sceneId: overrides.sceneId,
    sceneOrder: overrides.sceneOrder,
    ownership: OWNERSHIP,
    status: overrides.status ?? "SUCCEEDED",
    failureClassification: null,
    mediaReference: {
      uri: `fixture://${OWNERSHIP.workspaceId}/${overrides.sceneId}.mp4`,
      contentHash: overrides.contentHash,
      mediaType: "video/mp4",
    },
    durationMs: overrides.durationMs ?? 1000,
    acceptedAt: "2026-08-06T04:30:00.000Z",
    integrityHash: overrides.contentHash,
    contractVersion: "1",
  };
}

describe("Sprint 3 PR 3.6 Assembly Runtime — unit", () => {
  it("builds deterministic execution identity without wall-clock or random values", () => {
    const payload = {
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      assemblyJobId: makeJob().assemblyJobId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    };
    const a = buildAssemblyExecutionIdentity(payload);
    const b = buildAssemblyExecutionIdentity(payload);
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);

    const reordered = buildAssemblyExecutionIdentity({
      ...payload,
      orderedSceneResultIds: [SCENE_RESULT_B, SCENE_RESULT_A],
      orderedSceneContentHashes: [HASH_B, HASH_A],
    });
    expect(reordered).not.toBe(a);
  });

  it("validates membership and ordering fail-closed", () => {
    const job = makeJob();
    const definition = makeDefinition();
    const memberships = makeMemberships();
    const results = [
      makeResult({
        sceneResultId: SCENE_RESULT_A,
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        sceneOrder: 0,
        contentHash: HASH_A,
      }),
      makeResult({
        sceneResultId: SCENE_RESULT_B,
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        sceneOrder: 1,
        contentHash: HASH_B,
      }),
    ];

    const ok = loadAssemblyRuntimeInput({ job, definition, memberships, sceneResults: results });
    expect(ok.orderedScenes).toHaveLength(2);
    expect(ok.orderedScenes[0]!.sceneResultId).toBe(SCENE_RESULT_A);

    expect(() =>
      loadAssemblyRuntimeInput({
        job,
        definition,
        memberships,
        sceneResults: [results[0]!],
      })
    ).toThrow(AssemblyRuntimeInputError);

    expect(() =>
      loadAssemblyRuntimeInput({
        job,
        definition,
        memberships: [
          { ...memberships[0]!, sceneExecutionId: SCENE_EXEC_B, sceneId: "scene-b" },
          { ...memberships[1]!, sceneExecutionId: SCENE_EXEC_A, sceneId: "scene-a" },
        ],
        sceneResults: results,
      })
    ).toThrow(/order/i);

    expect(() =>
      loadAssemblyRuntimeInput({
        job,
        definition,
        memberships,
        sceneResults: [
          results[0]!,
          results[1]!,
          makeResult({
            sceneResultId: "10000000-0000-5000-8000-000000000399",
            sceneExecutionId: SCENE_EXEC_A,
            sceneId: "scene-a",
            sceneOrder: 0,
            contentHash: HASH_A,
          }),
        ],
      })
    ).toThrow(/Duplicate/i);

    expect(() =>
      loadAssemblyRuntimeInput({
        job,
        definition,
        memberships,
        sceneResults: [
          results[0]!,
          { ...results[1]!, status: "FAILED", mediaReference: null, durationMs: null },
        ],
      })
    ).toThrow(/SUCCEEDED/i);
  });

  it("builds deterministic normalization plan without creative effects", () => {
    const plan = buildAssemblyNormalizationPlan([
      {
        sceneResultId: SCENE_RESULT_A,
        mediaType: "video/mp4",
        durationMs: 1000,
        width: 640,
        height: 360,
        frameRate: 24,
        videoCodec: "h264",
        hasAudio: false,
        audioCodec: null,
        timeBase: "1/24",
        byteSize: 100,
        contentHash: HASH_A,
      },
      {
        sceneResultId: SCENE_RESULT_B,
        mediaType: "video/mp4",
        durationMs: 1000,
        width: 1280,
        height: 720,
        frameRate: 30,
        videoCodec: "h264",
        hasAudio: true,
        audioCodec: "aac",
        timeBase: "1/30",
        byteSize: 200,
        contentHash: HASH_B,
      },
    ]);
    expect(plan.targetWidth).toBe(1280);
    expect(plan.targetHeight).toBe(720);
    expect(plan.forbidTransitions).toBe(true);
    expect(plan.forbidCreativeEffects).toBe(true);
    const filter = buildNormalizationFilter(plan);
    expect(filter).toContain("scale=");
    expect(filter).toContain("pad=");
    expect(filter).not.toMatch(/fade|transition|subtitles|music/i);
  });

  it("defines stable failure classifications with retry/terminal policies", () => {
    expect(ASSEMBLY_RUNTIME_FAILURE_CLASSIFICATIONS).toContain("ASSEMBLY_CONCATENATION_FAILED");
    expect(ASSEMBLY_RUNTIME_FAILURE_POLICIES.ASSEMBLY_MEDIA_UNAVAILABLE.retryAllowed).toBe(true);
    expect(ASSEMBLY_RUNTIME_FAILURE_POLICIES.ASSEMBLY_ORDER_CONFLICT.retryAllowed).toBe(false);
    expect(ASSEMBLY_RUNTIME_FAILURE_POLICIES.ASSEMBLY_ORDER_CONFLICT.terminal).toBe(true);
    for (const key of ASSEMBLY_RUNTIME_FAILURE_CLASSIFICATIONS) {
      const policy = ASSEMBLY_RUNTIME_FAILURE_POLICIES[key];
      expect(policy.safePublicMessage.length).toBeGreaterThan(0);
      expect(policy.safePublicMessage).not.toMatch(/ffmpeg|stderr|\/tmp|signed/i);
    }
  });

  it("redacts sensitive URLs and paths", () => {
    const redacted = redactSensitiveAssemblyValue(
      "download https://storage.example/x?token=secret /tmp/ember-assembly-abc/file.mp4"
    );
    expect(redacted).toContain("[REDACTED_URL]");
    expect(redacted).toContain("[REDACTED_PATH]");
    expect(redacted).not.toContain("token=secret");
  });

  it("builds converging processing and failed facts without wall-clock identity", () => {
    const job = makeJob();
    const a = buildAssemblyProcessingStartedFact(job);
    const b = buildAssemblyProcessingStartedFact(job);
    expect(a.factId).toBe(b.factId);
    expect(a.integrityHash).toBe(b.integrityHash);
    expect(a.startedAt).toBe(job.acceptedAt);

    const failed = buildAssemblyFailedFact({
      job,
      classification: "ASSEMBLY_ORDER_CONFLICT",
    });
    expect(failed.failureClassification).toBe("ASSEMBLY_ORDER_INVALID");
    expect(failed.message).not.toMatch(/ffmpeg|stderr/i);
  });

  it("projects runtime state without exposing paths or stderr", () => {
    const job = makeJob();
    const processing = buildAssemblyProcessingStartedFact(job);
    const projection = projectAssemblyRuntime({
      job,
      facts: [processing],
      artifact: null,
      inputValidationStatus: "PASSED",
    });
    expect(projection.state).toBe("PROCESSING");
    expect(projection.executionAllowed).toBe(false);
    expect(JSON.stringify(projection)).not.toMatch(/ffmpeg|\/tmp|signed/i);
  });

  it("uses explicit argv-safe filter tokens only", () => {
    const plan = buildAssemblyNormalizationPlan([
      {
        sceneResultId: SCENE_RESULT_A,
        mediaType: "video/mp4",
        durationMs: 1000,
        width: 320,
        height: 240,
        frameRate: 30,
        videoCodec: "h264",
        hasAudio: false,
        audioCodec: null,
        timeBase: null,
        byteSize: 10,
        contentHash: HASH_A,
      },
    ]);
    const filter = buildNormalizationFilter(plan);
    expect(filter).not.toMatch(/[;|&`$]/);
    expect(filter).not.toMatch(/\s-i\s/);
  });

  it("fail-closes unscoped absolute/file/http media URIs and cross-workspace refs", () => {
    expect(
      resolveWorkspaceScopedObjectKey(
        OWNERSHIP,
        `asset://${OWNERSHIP.workspaceId}/scenes/a.mp4`
      )
    ).toBe(`${OWNERSHIP.workspaceId}/scenes/a.mp4`);
    expect(
      resolveWorkspaceScopedObjectKey(OWNERSHIP, `${OWNERSHIP.workspaceId}/scenes/a.mp4`)
    ).toBe(`${OWNERSHIP.workspaceId}/scenes/a.mp4`);

    for (const uri of [
      "file:///tmp/secret.mp4",
      "C:\\Users\\secret.mp4",
      "/tmp/secret.mp4",
      "https://cdn.example/x?token=abc",
      `${OWNERSHIP.workspaceId}/../escape.mp4`,
      `asset://20000000-0000-4000-8000-000000000099/scenes/a.mp4`,
    ]) {
      expect(() => resolveWorkspaceScopedObjectKey(OWNERSHIP, uri)).toThrow(
        AssemblyMediaAccessError
      );
    }
  });
});
