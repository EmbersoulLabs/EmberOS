/**
 * Sprint 3 PR 3.6 Phase 1 — Deterministic Story Assembly contract & identity tests.
 *
 * Contract layer only — no runtime, repository, SQL, or engine.
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_CONTRACT_VERSION,
  ASSEMBLY_FAILURE_CLASSIFICATIONS,
  ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION,
  AssemblyEngineSnapshotSchema,
  AssemblyFailedFactSchema,
  AssemblyFinalStoryResultSchema,
  AssemblyJobAcceptedFactSchema,
  AssemblyJobSchema,
  AssemblyProcessingStartedFactSchema,
  AssemblySucceededFactSchema,
  assemblyIntegrityHash,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyJobIdentity,
  buildFinalStoryResultIdentity,
  parseAssemblyFinalStoryResult,
  type AssemblyEngineSnapshotConfig,
  type AssemblyJobIdentityPayload,
  type FinalStoryResultIdentityPayload,
} from "@ceo-agent/shared/server";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
} as const;

const SCENE_RESULT_A = "10000000-0000-4000-8000-000000000201";
const SCENE_RESULT_B = "10000000-0000-4000-8000-000000000202";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const OUTPUT_HASH =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const OUTPUT_HASH_ALT =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function snapshotConfig(
  overrides: Partial<AssemblyEngineSnapshotConfig> = {}
): AssemblyEngineSnapshotConfig {
  return {
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
    ...overrides,
  };
}

function jobIdentity(
  overrides: Partial<AssemblyJobIdentityPayload> = {}
): AssemblyJobIdentityPayload {
  const config = snapshotConfig();
  const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
  return {
    executionPlanId: OWNERSHIP.executionPlanId,
    assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
    orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
    orderedSceneContentHashes: [HASH_A, HASH_B],
    assemblyContractVersion: ASSEMBLY_CONTRACT_VERSION,
    assemblyEngineSnapshotHash: snapshotHash,
    ...overrides,
  };
}

function resultIdentity(
  assemblyJobId: string,
  overrides: Partial<FinalStoryResultIdentityPayload> = {}
): FinalStoryResultIdentityPayload {
  return {
    assemblyJobId,
    finalMediaContentHash: OUTPUT_HASH,
    finalResultContractVersion: ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION,
    assemblyEngineSnapshotHash: jobIdentity().assemblyEngineSnapshotHash,
    ...overrides,
  };
}

describe("Sprint 3 PR 3.6 Phase 1 — assembly contracts & identity", () => {
  it("freezes the canonical assembly failure classification set", () => {
    expect(ASSEMBLY_FAILURE_CLASSIFICATIONS).toEqual([
      "ASSEMBLY_DEFINITION_INVALID",
      "ASSEMBLY_MEMBERSHIP_INVALID",
      "ASSEMBLY_ORDER_INVALID",
      "SCENE_RESULT_MISSING",
      "SCENE_RESULT_FAILED",
      "SCENE_RESULT_CONFLICT",
      "SCENE_MEDIA_MISSING",
      "SCENE_MEDIA_HASH_MISMATCH",
      "SCENE_MEDIA_UNSUPPORTED",
      "SCENE_MEDIA_CORRUPTED",
      "ASSEMBLY_ENGINE_SNAPSHOT_MISMATCH",
      "ASSEMBLY_ENGINE_FAILED",
      "ASSEMBLY_IDENTITY_CONFLICT",
      "ASSEMBLY_OUTPUT_CONFLICT",
      "ASSEMBLY_ARTIFACT_VALIDATION_FAILED",
      "ASSEMBLY_PERSISTENCE_FAILED",
      "ASSEMBLY_PROJECTION_FAILED",
    ]);
    expect(ASSEMBLY_FAILURE_CLASSIFICATIONS).not.toContain(
      "ASSEMBLY_ENGINE_SNAPSHOT_CONFLICT"
    );
    expect(ASSEMBLY_FAILURE_CLASSIFICATIONS).not.toContain(
      "ASSEMBLY_ENGINE_VERSION_CONFLICT"
    );
  });

  it("parses immutable AssemblyEngineSnapshot with explicit versioning", () => {
    const config = snapshotConfig();
    const snapshotContentHash = buildAssemblyEngineSnapshotContentHash(config);
    const snapshot = AssemblyEngineSnapshotSchema.parse({
      ...config,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotContentHash),
      snapshotContentHash,
      acceptedAt: "2026-08-06T04:00:00.000Z",
    });
    expect(snapshot.engineContractVersion).toBe("1");
    expect(snapshot.snapshotContentHash).toBe(snapshotContentHash);
  });

  it("keeps AssemblyJob identity stable for equivalent replay", () => {
    const a = buildAssemblyJobIdentity(jobIdentity());
    const b = buildAssemblyJobIdentity(jobIdentity());
    expect(a.assemblyJobId).toBe(b.assemblyJobId);
    expect(a.deterministicFingerprint).toBe(b.deterministicFingerprint);
  });

  it("keeps FinalStoryResult identity stable for equivalent replay", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const a = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    const b = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    expect(a.storyResultId).toBe(b.storyResultId);
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it("changes AssemblyJob identity when snapshot hash changes", () => {
    const base = buildAssemblyJobIdentity(jobIdentity());
    const changed = buildAssemblyJobIdentity(
      jobIdentity({
        assemblyEngineSnapshotHash: buildAssemblyEngineSnapshotContentHash(
          snapshotConfig({ binaryBuildHash: HASH_C })
        ),
      })
    );
    expect(changed.assemblyJobId).not.toBe(base.assemblyJobId);
    expect(changed.deterministicFingerprint).not.toBe(base.deterministicFingerprint);
  });

  it("changes AssemblyJob identity when scene order changes", () => {
    const base = buildAssemblyJobIdentity(jobIdentity());
    const reordered = buildAssemblyJobIdentity(
      jobIdentity({
        orderedSceneResultIds: [SCENE_RESULT_B, SCENE_RESULT_A],
        orderedSceneContentHashes: [HASH_B, HASH_A],
      })
    );
    expect(reordered.assemblyJobId).not.toBe(base.assemblyJobId);
  });

  it("changes AssemblyJob identity when scene content hash changes", () => {
    const base = buildAssemblyJobIdentity(jobIdentity());
    const changed = buildAssemblyJobIdentity(
      jobIdentity({
        orderedSceneContentHashes: [HASH_A, HASH_C],
      })
    );
    expect(changed.assemblyJobId).not.toBe(base.assemblyJobId);
  });

  it("changes AssemblyJob identity when contract version would change", () => {
    const base = buildAssemblyJobIdentity(jobIdentity());
    const mutatedPayload = {
      ...jobIdentity(),
      assemblyContractVersion: "2",
    };
    const changedFingerprint = assemblyIntegrityHash({
      kind: "assembly-job-identity",
      ...mutatedPayload,
    });
    expect(changedFingerprint).not.toBe(base.deterministicFingerprint);
  });

  it("lets output hash affect only FinalStoryResult identity", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const jobAgain = buildAssemblyJobIdentity(
      jobIdentity({
        // output hash is not part of job identity payload
      })
    );
    expect(jobAgain.assemblyJobId).toBe(job.assemblyJobId);

    const resultA = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    const resultB = buildFinalStoryResultIdentity(
      resultIdentity(job.assemblyJobId, {
        finalMediaContentHash: OUTPUT_HASH_ALT,
      })
    );
    expect(resultB.storyResultId).not.toBe(resultA.storyResultId);
    expect(resultB.integrityHash).not.toBe(resultA.integrityHash);
  });

  it("never lets AssemblyProcessingStartedFact change identity", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const processing = AssemblyProcessingStartedFactSchema.parse({
      factId: "10000000-0000-5000-8000-000000000901",
      assemblyJobId: job.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      ownership: OWNERSHIP,
      factKind: "PROCESSING_STARTED",
      startedAt: "2026-08-06T04:05:00.000Z",
      integrityHash: assemblyIntegrityHash({
        kind: "assembly-processing-started",
        assemblyJobId: job.assemblyJobId,
        startedAt: "2026-08-06T04:05:00.000Z",
      }),
      contractVersion: "1",
    });

    const afterTelemetry = buildAssemblyJobIdentity(jobIdentity());
    const result = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    const resultAgain = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));

    expect(processing.factKind).toBe("PROCESSING_STARTED");
    expect(afterTelemetry.assemblyJobId).toBe(job.assemblyJobId);
    expect(resultAgain.storyResultId).toBe(result.storyResultId);
    expect(JSON.stringify(jobIdentity())).not.toContain("PROCESSING_STARTED");
    expect(JSON.stringify(resultIdentity(job.assemblyJobId))).not.toContain(
      "PROCESSING_STARTED"
    );
  });

  it("rejects provider fields on Final Story Result", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const ids = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    const config = snapshotConfig();
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);

    expect(() =>
      parseAssemblyFinalStoryResult({
        storyResultId: ids.storyResultId,
        assemblyJobId: job.assemblyJobId,
        executionPlanId: OWNERSHIP.executionPlanId,
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
        runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
        ownership: OWNERSHIP,
        orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
        orderedSceneContentHashes: [HASH_A, HASH_B],
        mediaReference: {
          uri: "asset://story/final.mp4",
          contentHash: OUTPUT_HASH,
          mediaType: "video/mp4",
        },
        finalMediaContentHash: OUTPUT_HASH,
        durationMs: 8000,
        completedAt: "2026-08-06T04:10:00.000Z",
        assemblyContractVersion: "1",
        finalResultContractVersion: "1",
        assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
        assemblyEngineSnapshotHash: snapshotHash,
        integrityHash: ids.integrityHash,
        providerId: "minimax",
        providerPayload: { raw: true },
        usage: { amount: 1 },
        cost: { amount: 0.2 },
      })
    ).toThrow(/forbidden field/);
  });

  it("rejects failed Final Story Result semantics", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const ids = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));
    const snapshotHash = jobIdentity().assemblyEngineSnapshotHash;

    expect(() =>
      parseAssemblyFinalStoryResult({
        storyResultId: ids.storyResultId,
        assemblyJobId: job.assemblyJobId,
        executionPlanId: OWNERSHIP.executionPlanId,
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
        runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
        ownership: OWNERSHIP,
        orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
        orderedSceneContentHashes: [HASH_A, HASH_B],
        mediaReference: {
          uri: "asset://story/final.mp4",
          contentHash: OUTPUT_HASH,
          mediaType: "video/mp4",
        },
        finalMediaContentHash: OUTPUT_HASH,
        durationMs: 8000,
        completedAt: "2026-08-06T04:10:00.000Z",
        assemblyContractVersion: "1",
        finalResultContractVersion: "1",
        assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
        assemblyEngineSnapshotHash: snapshotHash,
        integrityHash: ids.integrityHash,
        status: "FAILED",
        failureClassification: "ASSEMBLY_ENGINE_FAILED",
      })
    ).toThrow(/forbidden field/);

    expect(() =>
      AssemblyFinalStoryResultSchema.parse({
        storyResultId: ids.storyResultId,
        assemblyJobId: job.assemblyJobId,
        executionPlanId: OWNERSHIP.executionPlanId,
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
        runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
        ownership: OWNERSHIP,
        orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
        orderedSceneContentHashes: [HASH_A, HASH_B],
        mediaReference: {
          uri: "file:///tmp/story-render.mp4",
          contentHash: OUTPUT_HASH,
          mediaType: "video/mp4",
        },
        finalMediaContentHash: OUTPUT_HASH,
        durationMs: 8000,
        completedAt: "2026-08-06T04:10:00.000Z",
        assemblyContractVersion: "1",
        finalResultContractVersion: "1",
        assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
        assemblyEngineSnapshotHash: snapshotHash,
        integrityHash: ids.integrityHash,
      })
    ).toThrow(/temporary artifact/);
  });

  it("produces different hashes for conflicting immutable payloads", () => {
    expect(assemblyIntegrityHash({ a: 1 })).not.toBe(assemblyIntegrityHash({ a: 2 }));
    expect(assemblyIntegrityHash({ a: 1, b: 2 })).toBe(
      assemblyIntegrityHash({ b: 2, a: 1 })
    );
  });

  it("parses append-only assembly facts including terminal success and failure", () => {
    const job = buildAssemblyJobIdentity(jobIdentity());
    const snapshotHash = jobIdentity().assemblyEngineSnapshotHash;
    const result = buildFinalStoryResultIdentity(resultIdentity(job.assemblyJobId));

    const accepted = AssemblyJobAcceptedFactSchema.parse({
      factId: "10000000-0000-5000-8000-000000000911",
      assemblyJobId: job.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      ownership: OWNERSHIP,
      factKind: "ACCEPTED",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
      deterministicFingerprint: job.deterministicFingerprint,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyEngineSnapshotHash: snapshotHash,
      acceptedAt: "2026-08-06T04:00:00.000Z",
      integrityHash: assemblyIntegrityHash({ kind: "accepted", id: job.assemblyJobId }),
      contractVersion: "1",
    });
    expect(accepted.factKind).toBe("ACCEPTED");

    const succeeded = AssemblySucceededFactSchema.parse({
      factId: "10000000-0000-5000-8000-000000000912",
      assemblyJobId: job.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      ownership: OWNERSHIP,
      factKind: "SUCCEEDED",
      storyResultId: result.storyResultId,
      finalMediaContentHash: OUTPUT_HASH,
      completedAt: "2026-08-06T04:10:00.000Z",
      integrityHash: assemblyIntegrityHash({ kind: "succeeded", id: result.storyResultId }),
      contractVersion: "1",
    });
    expect(succeeded.storyResultId).toBe(result.storyResultId);

    const failed = AssemblyFailedFactSchema.parse({
      factId: "10000000-0000-5000-8000-000000000913",
      assemblyJobId: job.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      ownership: OWNERSHIP,
      factKind: "FAILED",
      failureClassification: "ASSEMBLY_ENGINE_FAILED",
      message: "Assembly engine failed closed",
      failedAt: "2026-08-06T04:11:00.000Z",
      integrityHash: assemblyIntegrityHash({ kind: "failed", id: job.assemblyJobId }),
      contractVersion: "1",
    });
    expect(failed).not.toHaveProperty("storyResultId");
  });

  it("parses AssemblyJob without provider, usage, cost, or output hash fields", () => {
    const identity = buildAssemblyJobIdentity(jobIdentity());
    const snapshotHash = identity.identity.assemblyEngineSnapshotHash;
    const job = AssemblyJobSchema.parse({
      assemblyJobId: identity.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000301",
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
      ownership: OWNERSHIP,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyEngineSnapshotHash: snapshotHash,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T04:00:00.000Z",
    });
    expect(job).not.toHaveProperty("finalMediaContentHash");
    expect(job).not.toHaveProperty("providerId");
    expect(job).not.toHaveProperty("usage");
    expect(job).not.toHaveProperty("cost");
  });
});
