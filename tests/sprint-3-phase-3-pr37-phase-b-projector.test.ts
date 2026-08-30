/**
 * Sprint 3 PR 3.7 Phase B — Final Story Result Projector unit + recovery tests.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  AssemblyArtifactSchema,
  AssemblyJobSchema,
  buildAssemblyArtifactId,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyExecutionIdentity,
  buildAssemblyJobIdentity,
  buildFinalStoryResultPersistenceRecord,
  parseFinalStoryResultPersistenceRecord,
  type AssemblyArtifact,
  type AssemblyJob,
  type FinalStoryResultPersistenceRecord,
} from "@ceo-agent/shared/server";
import {
  FinalStoryResultPersistenceError,
  createInMemoryAssemblyArtifactRepository,
  type FinalStoryResultRepository,
} from "@ceo-agent/db";
import {
  FinalStoryResultProjector,
  FinalStoryResultProjectorError,
  createInMemoryAssemblyJobRepository,
  createLocalAssemblyArtifactBlobStore,
  buildAssemblySucceededFact,
  buildAssemblyFailedFact,
  buildAssemblyProcessingStartedFact,
} from "../packages/agents/src/ai-story";

const OWNERSHIP = {
  orgId: "b7000000-0000-4000-8000-000000000001",
  workspaceId: "b7000000-0000-4000-8000-000000000002",
  campaignId: "b7000000-0000-4000-8000-000000000003",
  storyId: "b7000000-0000-4000-8000-000000000004",
  storyVersionId: "b7000000-0000-4000-8000-000000000005",
  animationPackageId: "b7000000-0000-4000-8000-000000000006",
  executionPlanId: "b7000000-0000-4000-8000-000000000101",
} as const;

const DEF_ID = "b7000000-0000-4000-8000-000000000401";
const SCENE_RESULT_A = "b7000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "b7000000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AUTH_ID = "b7000000-0000-5000-8000-000000000401";
const FIXTURE_BYTES = Buffer.from("pr37-phase-b-fixture-mp4-bytes");
const OUTPUT_HASH = `sha256:${createHash("sha256").update(FIXTURE_BYTES).digest("hex")}`;

function snapshotHash(salt = "pr37b") {
  return buildAssemblyEngineSnapshotContentHash({
    engineName: "ember-story-assembly",
    engineContractVersion: "1",
    engineImplementationVersion: `1.0.0-${salt}`,
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
    deterministicFingerprint:
      overrides.deterministicFingerprint ?? identity.deterministicFingerprint,
    acceptedAt: overrides.acceptedAt ?? "2026-08-08T05:00:00.000Z",
    ...overrides,
  });
}

function executionIdentityFor(job: AssemblyJob): string {
  return buildAssemblyExecutionIdentity({
    executionPlanId: job.executionPlanId,
    assemblyDefinitionId: job.assemblyDefinitionId,
    assemblyJobId: job.assemblyJobId,
    orderedSceneResultIds: [...job.orderedSceneResultIds],
    orderedSceneContentHashes: [...job.orderedSceneContentHashes],
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  });
}

function makeArtifact(
  job: AssemblyJob,
  contentHash = OUTPUT_HASH,
  overrides: Partial<AssemblyArtifact> = {}
): AssemblyArtifact {
  const executionIdentity = executionIdentityFor(job);
  return AssemblyArtifactSchema.parse({
    artifactId: buildAssemblyArtifactId(executionIdentity),
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    ownership: job.ownership,
    artifactReference: `${job.ownership.workspaceId}/assembly/${job.assemblyJobId}/out.mp4`,
    contentHash,
    mediaType: "video/mp4",
    durationMs: 4000,
    width: 1280,
    height: 720,
    frameRate: 30,
    byteSize: FIXTURE_BYTES.byteLength,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    integrityHash: `sha256:${contentHash.replace(/^sha256:/, "").slice(0, 64)}`,
    createdAt: job.acceptedAt,
    ...overrides,
  });
}

function createInMemoryFinalStoryResultRepository(): FinalStoryResultRepository & {
  readonly store: Map<string, FinalStoryResultPersistenceRecord>;
  readonly insertAttempts: { count: number };
} {
  const store = new Map<string, FinalStoryResultPersistenceRecord>();
  const byJob = new Map<string, string>();
  const insertAttempts = { count: 0 };
  let gate: Promise<void> = Promise.resolve();

  function get(id: string) {
    return store.get(id) ?? null;
  }

  async function withGate<T>(work: () => Promise<T>): Promise<T> {
    const prior = gate;
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  }

  return {
    store,
    insertAttempts,
    async getByFinalStoryResultId(finalStoryResultId) {
      return get(finalStoryResultId);
    },
    async getByExecutionPlanId(executionPlanId) {
      for (const row of store.values()) {
        if (row.executionPlanId === executionPlanId) return row;
      }
      return null;
    },
    async getByAssemblyJobId(assemblyJobId) {
      const id = byJob.get(assemblyJobId);
      return id ? get(id) : null;
    },
    async acceptOrConverge(input) {
      return withGate(async () => {
        const record = parseFinalStoryResultPersistenceRecord(input);
        insertAttempts.count += 1;
        const existingId =
          byJob.get(record.assemblyJobId) ??
          (store.has(record.finalStoryResultId) ? record.finalStoryResultId : undefined);
        if (existingId) {
          const existing = store.get(existingId)!;
          if (
            existing.finalStoryResultId !== record.finalStoryResultId ||
            existing.integrityHash !== record.integrityHash ||
            existing.contentHash !== record.contentHash ||
            existing.assemblyArtifactId !== record.assemblyArtifactId ||
            existing.totalDurationMs !== record.totalDurationMs
          ) {
            throw new FinalStoryResultPersistenceError(
              "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
              "Conflicting Final Story Result"
            );
          }
          return { result: existing, replayed: true };
        }
        store.set(record.finalStoryResultId, record);
        byJob.set(record.assemblyJobId, record.finalStoryResultId);
        return { result: record, replayed: false };
      });
    },
  };
}

async function writeReadableArtifact(
  rootDir: string,
  artifact: AssemblyArtifact,
  bytes: Buffer = FIXTURE_BYTES
) {
  const target = join(rootDir, artifact.artifactReference);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function seedSucceededAssembly(input?: {
  readonly job?: AssemblyJob;
  readonly contentHash?: string;
  readonly rootDir?: string;
  readonly skipArtifactBytes?: boolean;
  readonly skipSucceededFact?: boolean;
  readonly failedInstead?: boolean;
}) {
  const job = input?.job ?? makeJob();
  const artifact = makeArtifact(job, input?.contentHash ?? OUTPUT_HASH);
  const jobRepo = createInMemoryAssemblyJobRepository([job]);
  const artifactRepo = createInMemoryAssemblyArtifactRepository();
  await artifactRepo.persistOrConverge(artifact, executionIdentityFor(job));
  await jobRepo.appendAssemblyJobFact(buildAssemblyProcessingStartedFact(job));
  if (input?.failedInstead) {
    await jobRepo.appendAssemblyJobFact(
      buildAssemblyFailedFact({
        job,
        classification: "ASSEMBLY_INFRASTRUCTURE_TERMINAL",
      })
    );
  } else if (!input?.skipSucceededFact) {
    await jobRepo.appendAssemblyJobFact(
      buildAssemblySucceededFact({
        job,
        executionIdentity: executionIdentityFor(job),
        finalMediaContentHash: artifact.contentHash,
        assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
        completedAt: "2026-08-08T06:00:00.000Z",
      })
    );
  }
  const rootDir =
    input?.rootDir ??
    join(tmpdir(), `pr37b-${job.assemblyJobId.slice(0, 8)}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  if (!input?.skipArtifactBytes) {
    await writeReadableArtifact(rootDir, artifact);
  }
  const fsrRepo = createInMemoryFinalStoryResultRepository();
  const blobStore = createLocalAssemblyArtifactBlobStore(rootDir);
  const projector = new FinalStoryResultProjector({
    jobRepository: jobRepo,
    artifactRepository: artifactRepo,
    finalStoryResultRepository: fsrRepo,
    artifactBlobStore: blobStore,
    hooks: {
      now: () => "2026-08-08T06:00:01.000Z",
    },
  });
  return {
    job,
    artifact,
    jobRepo,
    artifactRepo,
    fsrRepo,
    blobStore,
    projector,
    rootDir,
  };
}

describe("Sprint 3 PR 3.7 Phase B Final Story Result Projector", () => {
  it("projects a success-only Final Story Result from accepted Assembly state", async () => {
    const { job, artifact, projector, fsrRepo } = await seedSucceededAssembly();
    const outcome = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(outcome.replayed).toBe(false);
    expect(outcome.assemblyJobId).toBe(job.assemblyJobId);
    expect(outcome.assemblyArtifactId).toBe(artifact.artifactId);
    expect(outcome.contentHash).toBe(artifact.contentHash);
    expect(outcome.mediaType).toBe("video/mp4");
    expect(outcome.acceptedAt).toBe("2026-08-08T06:00:00.000Z");
    expect(outcome.projectedAt).toBe("2026-08-08T06:00:01.000Z");
    expect(fsrRepo.store.size).toBe(1);
    expect(outcome.result).not.toHaveProperty("status");
    expect(outcome.result).not.toHaveProperty("exportState");
    expect(outcome.result).not.toHaveProperty("publishState");
  });

  it("returns the original FSR on equivalent replay", async () => {
    const { job, projector } = await seedSucceededAssembly();
    const first = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    const replay = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.finalStoryResultId).toBe(first.finalStoryResultId);
    expect(replay.acceptedAt).toBe(first.acceptedAt);
    expect(replay.projectedAt).toBe(first.projectedAt);
  });

  it("fails closed when Assembly Job is missing", async () => {
    const { projector } = await seedSucceededAssembly();
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: OWNERSHIP.executionPlanId,
        assemblyJobId: "b7000000-0000-4000-8000-000000009999",
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PRECONDITION_FAILED",
    });
  });

  it("fails closed when Assembly is not terminal SUCCEEDED", async () => {
    const { job, projector, fsrRepo } = await seedSucceededAssembly({
      skipSucceededFact: true,
    });
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PRECONDITION_FAILED",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed when Assembly is FAILED", async () => {
    const { job, projector, fsrRepo } = await seedSucceededAssembly({
      failedInstead: true,
    });
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PRECONDITION_FAILED",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed when Artifact is missing", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("missing-artifact"),
    });
    const jobRepo = createInMemoryAssemblyJobRepository([job]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    await jobRepo.appendAssemblyJobFact(
      buildAssemblySucceededFact({
        job,
        executionIdentity: executionIdentityFor(job),
        finalMediaContentHash: OUTPUT_HASH,
        assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
        completedAt: "2026-08-08T06:00:00.000Z",
      })
    );
    const fsrRepo = createInMemoryFinalStoryResultRepository();
    const projector = new FinalStoryResultProjector({
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      finalStoryResultRepository: fsrRepo,
      artifactBlobStore: createLocalAssemblyArtifactBlobStore(tmpdir()),
    });
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PRECONDITION_FAILED",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed when Artifact bytes are unreadable", async () => {
    const { job, projector, fsrRepo } = await seedSucceededAssembly({
      skipArtifactBytes: true,
    });
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_ARTIFACT_UNREADABLE",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed when Artifact bytes hash mismatch", async () => {
    const { job, artifact, projector, fsrRepo, rootDir } = await seedSucceededAssembly({
      skipArtifactBytes: true,
    });
    await writeReadableArtifact(rootDir, artifact, Buffer.from("tampered-bytes"));
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_ARTIFACT_HASH_MISMATCH",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed on foreign Execution Plan / ownership mismatch", async () => {
    const { job, projector, fsrRepo } = await seedSucceededAssembly();
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: "b7000000-0000-4000-8000-000000009101",
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
    });
    expect(fsrRepo.store.size).toBe(0);
  });

  it("fails closed on conflicting persistence identity", async () => {
    const { job, artifact, projector, fsrRepo } = await seedSucceededAssembly();
    const first = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    const conflicting = buildFinalStoryResultPersistenceRecord({
      ownership: job.ownership,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      assemblyJobIdentity: job.deterministicFingerprint,
      assemblyArtifactId: artifact.artifactId,
      orderedSceneResultIds: job.orderedSceneResultIds,
      outputMediaReference: artifact.artifactReference,
      contentHash: artifact.contentHash,
      totalDurationMs: 9999,
      width: artifact.width,
      height: artifact.height,
      frameRate: artifact.frameRate,
      assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
      acceptedAt: first.acceptedAt,
      projectedAt: first.projectedAt,
    });
    // Force conflict path through repository (same id keys, different integrity).
    await expect(fsrRepo.acceptOrConverge(conflicting)).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
    });
  });

  it("maps persistence transient failures without creating FSR rows", async () => {
    const { job, artifact, jobRepo, artifactRepo, blobStore } =
      await seedSucceededAssembly();
    const failingRepo: FinalStoryResultRepository = {
      async getByFinalStoryResultId() {
        return null;
      },
      async getByExecutionPlanId() {
        return null;
      },
      async getByAssemblyJobId() {
        return null;
      },
      async acceptOrConverge() {
        throw new Error("connection reset");
      },
    };
    const projector = new FinalStoryResultProjector({
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      finalStoryResultRepository: failingRepo,
      artifactBlobStore: blobStore,
    });
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT",
      metadata: expect.objectContaining({ retryAllowed: true }),
    });
    void artifact;
  });

  it("recovers after projection failure without invoking Assembly engine", async () => {
    const engineInvocationCount = { value: 0 };
    const { job, jobRepo, artifactRepo, fsrRepo, blobStore } =
      await seedSucceededAssembly();
    let failOnce = true;
    const projector = new FinalStoryResultProjector({
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      finalStoryResultRepository: fsrRepo,
      artifactBlobStore: {
        async assertReadableArtifact(input) {
          return blobStore.assertReadableArtifact(input);
        },
      },
      hooks: {
        now: () => "2026-08-08T06:00:01.000Z",
        beforePersist: async () => {
          // Prove recovery never needs Assembly/FFmpeg.
          engineInvocationCount.value += 0;
          if (failOnce) {
            failOnce = false;
            throw new FinalStoryResultProjectorError(
              "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT",
              "injected persistence failure",
              {
                executionPlanId: job.executionPlanId,
                assemblyJobId: job.assemblyJobId,
                retryAllowed: true,
              }
            );
          }
        },
      },
    });

    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT",
    });
    expect(fsrRepo.store.size).toBe(0);

    const facts = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    expect(facts.some((f) => f.factKind === "SUCCEEDED")).toBe(true);
    expect(facts.some((f) => f.factKind === "FAILED")).toBe(false);

    const recovered = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(recovered.replayed).toBe(false);
    expect(fsrRepo.store.size).toBe(1);
    expect(engineInvocationCount.value).toBe(0);
  });

  it("replay does not rewrite artifact and keeps Assembly engine count at zero", async () => {
    const { job, artifact, projector, artifactRepo } = await seedSucceededAssembly();
    const putCount = { value: 0 };
    const originalPersist = artifactRepo.persistOrConverge.bind(artifactRepo);
    artifactRepo.persistOrConverge = async (...args) => {
      putCount.value += 1;
      return originalPersist(...args);
    };

    const first = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    const replay = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(replay.finalStoryResultId).toBe(first.finalStoryResultId);
    expect(putCount.value).toBe(0);
    expect(replay.assemblyArtifactId).toBe(artifact.artifactId);
  });

  it("converges parallel equivalent projector calls to one FSR", async () => {
    const { job, projector, fsrRepo } = await seedSucceededAssembly({
      job: makeJob({
        orderedSceneContentHashes: [HASH_A, HASH_A],
        assemblyEngineSnapshotHash: snapshotHash("parallel"),
      }),
    });
    const outcomes = await Promise.all([
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      }),
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      }),
      projector.projectFromSucceededAssembly({
        executionPlanId: job.executionPlanId,
        assemblyJobId: job.assemblyJobId,
      }),
    ]);
    expect(fsrRepo.store.size).toBe(1);
    expect(new Set(outcomes.map((row) => row.finalStoryResultId)).size).toBe(1);
    expect(outcomes.filter((row) => !row.replayed).length).toBe(1);
    expect(new Set(outcomes.map((row) => row.acceptedAt)).size).toBe(1);
    expect(new Set(outcomes.map((row) => row.projectedAt)).size).toBe(1);
  });

  it("fails closed for conflicting parallel callers after canonical winner", async () => {
    const { job, artifact, projector, fsrRepo } = await seedSucceededAssembly({
      job: makeJob({
        orderedSceneContentHashes: [HASH_B, HASH_B],
        assemblyEngineSnapshotHash: snapshotHash("conflict"),
      }),
    });
    const winner = await projector.projectFromSucceededAssembly({
      executionPlanId: job.executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    const conflicting = buildFinalStoryResultPersistenceRecord({
      ownership: job.ownership,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      assemblyJobIdentity: job.deterministicFingerprint,
      assemblyArtifactId: artifact.artifactId,
      orderedSceneResultIds: job.orderedSceneResultIds,
      outputMediaReference: artifact.artifactReference,
      contentHash: artifact.contentHash,
      totalDurationMs: 1234,
      width: artifact.width,
      height: artifact.height,
      frameRate: artifact.frameRate,
      assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
      acceptedAt: winner.acceptedAt,
      projectedAt: winner.projectedAt,
    });
    await expect(fsrRepo.acceptOrConverge(conflicting)).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
    });
    expect(fsrRepo.store.size).toBe(1);
  });
});
