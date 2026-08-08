/**
 * Sprint 3 PR 3.6 — controlled local FFmpeg / media assembly integration.
 * Skips when ffmpeg/ffprobe are unavailable.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AssemblyJobSchema,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyJobIdentity,
  type AssemblyJob,
  type AssemblySceneMembership,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import { createInMemoryAssemblyArtifactRepository } from "@ceo-agent/db";
import {
  createFixtureAssemblyMediaAccessPort,
  createInMemoryAssemblyJobRepository,
  createLocalAssemblyArtifactBlobStore,
  loadAssemblyRuntimeInput,
  runDeterministicAssemblyRuntime,
  AssemblyRuntimeInputError,
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
const AUTH_ID = "10000000-0000-5000-8000-000000000401";

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

const RUN_MEDIA = ffmpegAvailable();
const describeMedia = RUN_MEDIA ? describe : describe.skip;

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

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function generateClip(
  workDir: string,
  name: string,
  opts: { width: number; height: number; durationSec: number; withAudio: boolean; color: string }
): Promise<{ path: string; hash: string }> {
  const out = join(workDir, name);
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${opts.color}:s=${opts.width}x${opts.height}:d=${opts.durationSec}:r=30`,
  ];
  if (opts.withAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${opts.durationSec}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest"
    );
  } else {
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  }
  args.push(out);
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    windowsHide: true,
  });
  const bytes = await readFile(out);
  return { path: out, hash: hashBytes(bytes) };
}

describeMedia("Sprint 3 PR 3.6 Assembly Runtime — controlled media", () => {
  let root: string;
  let clipA: { path: string; hash: string };
  let clipB: { path: string; hash: string };
  let job: AssemblyJob;
  let definition: StoryAssemblyDefinition;
  let memberships: AssemblySceneMembership[];
  let results: CanonicalSceneResult[];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ember-pr36-media-"));
    clipA = await generateClip(root, "a.mp4", {
      width: 640,
      height: 360,
      durationSec: 1,
      withAudio: true,
      color: "red",
    });
    clipB = await generateClip(root, "b.mp4", {
      width: 1280,
      height: 720,
      durationSec: 1,
      withAudio: false,
      color: "blue",
    });

    const identity = buildAssemblyJobIdentity({
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [clipA.hash, clipB.hash],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash(),
    });
    job = AssemblyJobSchema.parse({
      assemblyJobId: identity.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      runtimeAuthorizationId: AUTH_ID,
      ownership: OWNERSHIP,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [clipA.hash, clipB.hash],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash()),
      assemblyEngineSnapshotHash: snapshotHash(),
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T05:00:00.000Z",
    });
    definition = {
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      orgId: OWNERSHIP.orgId,
      workspaceId: OWNERSHIP.workspaceId,
      campaignId: OWNERSHIP.campaignId,
      storyId: OWNERSHIP.storyId,
      storyVersionId: OWNERSHIP.storyVersionId,
      animationPackageId: OWNERSHIP.animationPackageId,
      sceneCount: 2,
      orderedSceneExecutionIds: [SCENE_EXEC_A, SCENE_EXEC_B],
      createdBy: AUTH_ID,
      createdAt: "2026-08-06T04:00:00.000Z",
      contractVersion: "1",
      deterministicFingerprint: clipA.hash,
    };
    memberships = [
      {
        membershipId: "10000000-0000-4000-8000-000000000501",
        assemblyDefinitionId: DEF_ID,
        executionPlanId: OWNERSHIP.executionPlanId,
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        sceneOrder: 0,
        contractVersion: "1",
        deterministicFingerprint: clipA.hash,
      },
      {
        membershipId: "10000000-0000-4000-8000-000000000502",
        assemblyDefinitionId: DEF_ID,
        executionPlanId: OWNERSHIP.executionPlanId,
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        sceneOrder: 1,
        contractVersion: "1",
        deterministicFingerprint: clipB.hash,
      },
    ];
    results = [
      {
        sceneResultId: SCENE_RESULT_A,
        executionPlanId: OWNERSHIP.executionPlanId,
        sceneRuntimeId: "10000000-0000-4000-8000-000000000601",
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        sceneOrder: 0,
        ownership: OWNERSHIP,
        status: "SUCCEEDED",
        failureClassification: null,
        mediaReference: {
          uri: `fixture://${OWNERSHIP.workspaceId}/a.mp4`,
          contentHash: clipA.hash,
          mediaType: "video/mp4",
        },
        durationMs: 1000,
        acceptedAt: "2026-08-06T04:30:00.000Z",
        integrityHash: clipA.hash,
        contractVersion: "1",
      },
      {
        sceneResultId: SCENE_RESULT_B,
        executionPlanId: OWNERSHIP.executionPlanId,
        sceneRuntimeId: "10000000-0000-4000-8000-000000000602",
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        sceneOrder: 1,
        ownership: OWNERSHIP,
        status: "SUCCEEDED",
        failureClassification: null,
        mediaReference: {
          uri: `fixture://${OWNERSHIP.workspaceId}/b.mp4`,
          contentHash: clipB.hash,
          mediaType: "video/mp4",
        },
        durationMs: 1000,
        acceptedAt: "2026-08-06T04:31:00.000Z",
        integrityHash: clipB.hash,
        contractVersion: "1",
      },
    ];
  }, 120_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("concatenates ordered scenes and converges equivalent replay", async () => {
    const jobRepo = createInMemoryAssemblyJobRepository([job]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    const blobRoot = join(root, "artifacts");
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map([
        [SCENE_RESULT_A, clipA.path],
        [SCENE_RESULT_B, clipB.path],
      ]),
      OWNERSHIP
    );

    const first = await runDeterministicAssemblyRuntime({
      assemblyJobId: job.assemblyJobId,
      sources: { definition, memberships, sceneResults: results },
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      mediaAccess,
      blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
    });
    expect(first.status).toBe("SUCCEEDED");
    if (first.status !== "SUCCEEDED") return;

    expect(first.artifact.durationMs).toBeGreaterThanOrEqual(1700);
    expect(first.artifact.durationMs).toBeLessThanOrEqual(2300);
    expect(first.artifact.width).toBe(1280);
    expect(first.artifact.height).toBe(720);
    expect(first.artifact.artifactReference).toContain(OWNERSHIP.workspaceId);
    expect(first.artifact.artifactReference).not.toMatch(/[?&]token=/);

    const second = await runDeterministicAssemblyRuntime({
      assemblyJobId: job.assemblyJobId,
      sources: { definition, memberships, sceneResults: results },
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      mediaAccess,
      blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
    });
    expect(second.status).toBe("SUCCEEDED");
    if (second.status !== "SUCCEEDED") return;
    expect(second.replayed).toBe(true);
    expect(second.artifact.contentHash).toBe(first.artifact.contentHash);
    expect(second.artifact.artifactId).toBe(first.artifact.artifactId);

    const facts = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    expect(facts.filter((f) => f.factKind === "SUCCEEDED")).toHaveLength(1);
    expect(facts.filter((f) => f.factKind === "PROCESSING_STARTED").length).toBeLessThanOrEqual(1);
  }, 180_000);

  it("fails closed on missing / failed / wrong order / duplicate scene results", () => {
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
        memberships,
        sceneResults: [
          results[0]!,
          { ...results[1]!, status: "FAILED", mediaReference: null, durationMs: null },
        ],
      })
    ).toThrow(/SUCCEEDED/i);

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
        sceneResults: [...results, results[0]!],
      })
    ).toThrow(/Duplicate|Extra/i);
  });

  it("fails closed on inaccessible media without creating success", async () => {
    const freshJob = makeFreshJob(`${clipA.hash}-missing`);
    const freshRepo = createInMemoryAssemblyJobRepository([freshJob]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    const sceneResults = results.map((row, index) => ({
      ...row,
      mediaReference: {
        ...row.mediaReference!,
        contentHash: freshJob.orderedSceneContentHashes[index]!,
      },
      integrityHash: freshJob.orderedSceneContentHashes[index]!,
    }));

    await expect(
      runDeterministicAssemblyRuntime({
        assemblyJobId: freshJob.assemblyJobId,
        sources: { definition, memberships, sceneResults },
        jobRepository: freshRepo,
        artifactRepository: artifactRepo,
        mediaAccess: createFixtureAssemblyMediaAccessPort(new Map(), OWNERSHIP),
        blobStore: createLocalAssemblyArtifactBlobStore(join(root, "artifacts-missing")),
      })
    ).rejects.toMatchObject({ classification: "ASSEMBLY_MEDIA_UNAVAILABLE" });

    const facts = await freshRepo.loadAssemblyFacts(freshJob.assemblyJobId);
    expect(facts.some((f) => f.factKind === "SUCCEEDED")).toBe(false);
    expect(await artifactRepo.getByAssemblyJobId(freshJob.assemblyJobId)).toBeNull();
  }, 120_000);

  it("recovers when terminal fact write fails after artifact persistence", async () => {
    const freshJob = makeFreshJob(`${clipA.hash}-recover`);
    const jobRepo = createInMemoryAssemblyJobRepository([freshJob]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map([
        [SCENE_RESULT_A, clipA.path],
        [SCENE_RESULT_B, clipB.path],
      ]),
      OWNERSHIP
    );
    const blobStore = createLocalAssemblyArtifactBlobStore(join(root, "artifacts-recover"));
    const sceneResults = results.map((row, index) => ({
      ...row,
      mediaReference: {
        ...row.mediaReference!,
        contentHash: freshJob.orderedSceneContentHashes[index]!,
      },
      integrityHash: freshJob.orderedSceneContentHashes[index]!,
    }));

    let injectedFailure: unknown;
    let engineRuns = 0;
    try {
      await runDeterministicAssemblyRuntime({
        assemblyJobId: freshJob.assemblyJobId,
        sources: { definition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore,
        hooks: {
          beforeEngineRun: async () => {
            engineRuns += 1;
          },
          beforeTerminalFact: async () => {
            throw new Error("injected terminal fact failure");
          },
        },
      });
    } catch (error) {
      injectedFailure = error;
    }
    expect(injectedFailure).toMatchObject({
      classification: "ASSEMBLY_INFRASTRUCTURE_TRANSIENT",
      retryAllowed: true,
    });
    expect(engineRuns).toBe(1);

    const artifact = await artifactRepo.getByAssemblyJobId(freshJob.assemblyJobId);
    expect(artifact).not.toBeNull();

    const recovered = await runDeterministicAssemblyRuntime({
      assemblyJobId: freshJob.assemblyJobId,
      sources: { definition, memberships, sceneResults },
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      mediaAccess,
      blobStore,
      hooks: {
        beforeEngineRun: async () => {
          engineRuns += 1;
        },
      },
    });
    expect(recovered.status).toBe("SUCCEEDED");
    expect(engineRuns).toBe(1);
    if (recovered.status === "SUCCEEDED") {
      expect(recovered.artifact.contentHash).toBe(artifact!.contentHash);
    }
    const facts = await jobRepo.loadAssemblyFacts(freshJob.assemblyJobId);
    expect(facts.filter((f) => f.factKind === "SUCCEEDED")).toHaveLength(1);
  }, 180_000);

  it("fails closed when artifact metadata exists but blob bytes are missing", async () => {
    const freshJob = makeFreshJob(`${clipA.hash}-missing-blob`);
    const jobRepo = createInMemoryAssemblyJobRepository([freshJob]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map([
        [SCENE_RESULT_A, clipA.path],
        [SCENE_RESULT_B, clipB.path],
      ]),
      OWNERSHIP
    );
    const blobRoot = join(root, "artifacts-missing-blob");
    const blobStore = createLocalAssemblyArtifactBlobStore(blobRoot);
    const sceneResults = results.map((row, index) => ({
      ...row,
      mediaReference: {
        ...row.mediaReference!,
        contentHash: freshJob.orderedSceneContentHashes[index]!,
      },
      integrityHash: freshJob.orderedSceneContentHashes[index]!,
    }));

    let injected: unknown;
    try {
      await runDeterministicAssemblyRuntime({
        assemblyJobId: freshJob.assemblyJobId,
        sources: { definition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore,
        hooks: {
          beforeTerminalFact: async () => {
            throw new Error("stop before terminal");
          },
        },
      });
    } catch (error) {
      injected = error;
    }
    expect(injected).toBeTruthy();
    const artifact = await artifactRepo.getByAssemblyJobId(freshJob.assemblyJobId);
    expect(artifact).not.toBeNull();
    await rm(join(blobRoot, artifact!.artifactReference), { force: true });

    await expect(
      runDeterministicAssemblyRuntime({
        assemblyJobId: freshJob.assemblyJobId,
        sources: { definition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore,
      })
    ).rejects.toMatchObject({
      classification: "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
    });
  }, 180_000);

  it("concurrent identical runs accept a single SUCCEEDED fact and artifact", async () => {
    const freshJob = makeFreshJob(`${clipA.hash}-concurrent`);
    const jobRepo = createInMemoryAssemblyJobRepository([freshJob]);
    const artifactRepo = createInMemoryAssemblyArtifactRepository();
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map([
        [SCENE_RESULT_A, clipA.path],
        [SCENE_RESULT_B, clipB.path],
      ]),
      OWNERSHIP
    );
    const blobStore = createLocalAssemblyArtifactBlobStore(join(root, "artifacts-concurrent"));
    const sceneResults = results.map((row, index) => ({
      ...row,
      mediaReference: {
        ...row.mediaReference!,
        contentHash: freshJob.orderedSceneContentHashes[index]!,
      },
      integrityHash: freshJob.orderedSceneContentHashes[index]!,
    }));
    const run = () =>
      runDeterministicAssemblyRuntime({
        assemblyJobId: freshJob.assemblyJobId,
        sources: { definition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore,
      });
    const settled = await Promise.allSettled([run(), run()]);
    const fulfilled = settled.filter((row) => row.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const row of fulfilled) {
      if (row.status === "fulfilled") {
        expect(row.value.status).toBe("SUCCEEDED");
      }
    }
    const facts = await jobRepo.loadAssemblyFacts(freshJob.assemblyJobId);
    expect(facts.filter((f) => f.factKind === "SUCCEEDED")).toHaveLength(1);
    expect(await artifactRepo.getByAssemblyJobId(freshJob.assemblyJobId)).not.toBeNull();
  }, 240_000);

  it("fault injection afterMediaOutput / beforeArtifactPersist remains retryable without success", async () => {
    for (const hookName of ["afterMediaOutput", "beforeArtifactPersist"] as const) {
      const freshJob = makeFreshJob(`${clipA.hash}-${hookName}`);
      const jobRepo = createInMemoryAssemblyJobRepository([freshJob]);
      const artifactRepo = createInMemoryAssemblyArtifactRepository();
      const mediaAccess = createFixtureAssemblyMediaAccessPort(
        new Map([
          [SCENE_RESULT_A, clipA.path],
          [SCENE_RESULT_B, clipB.path],
        ]),
        OWNERSHIP
      );
      const sceneResults = results.map((row, index) => ({
        ...row,
        mediaReference: {
          ...row.mediaReference!,
          contentHash: freshJob.orderedSceneContentHashes[index]!,
        },
        integrityHash: freshJob.orderedSceneContentHashes[index]!,
      }));
      await expect(
        runDeterministicAssemblyRuntime({
          assemblyJobId: freshJob.assemblyJobId,
          sources: { definition, memberships, sceneResults },
          jobRepository: jobRepo,
          artifactRepository: artifactRepo,
          mediaAccess,
          blobStore: createLocalAssemblyArtifactBlobStore(
            join(root, `artifacts-${hookName}`)
          ),
          hooks: {
            [hookName]: async () => {
              throw new Error(`injected ${hookName}`);
            },
          },
        })
      ).rejects.toMatchObject({
        classification: "ASSEMBLY_INFRASTRUCTURE_TRANSIENT",
        retryAllowed: true,
      });
      const facts = await jobRepo.loadAssemblyFacts(freshJob.assemblyJobId);
      expect(facts.some((f) => f.factKind === "SUCCEEDED")).toBe(false);
    }
  }, 300_000);

  it("denies cross-workspace fixture media access", async () => {
    const mediaAccess = createFixtureAssemblyMediaAccessPort(
      new Map([[SCENE_RESULT_A, clipA.path]]),
      OWNERSHIP
    );
    await expect(
      mediaAccess.resolveToLocalPath({
        ownership: { ...OWNERSHIP, workspaceId: "20000000-0000-4000-8000-000000000099" },
        scene: {
          sceneResultId: SCENE_RESULT_A,
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          sceneOrder: 0,
          contentHash: clipA.hash,
          mediaReference: {
            uri: `fixture://${OWNERSHIP.workspaceId}/a.mp4`,
            contentHash: clipA.hash,
            mediaType: "video/mp4",
          },
          durationMs: 1000,
        },
        workDir: join(root, "cross-ws"),
      })
    ).rejects.toMatchObject({ classification: "ASSEMBLY_MEDIA_UNAVAILABLE" });
  });

  function makeFreshJob(hashSalt: string): AssemblyJob {
    const saltedSnapshot = buildAssemblyEngineSnapshotContentHash({
      engineName: "ember-story-assembly",
      engineContractVersion: "1",
      engineImplementationVersion: `1.0.0-${hashSalt.slice(0, 12)}`,
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
    const identity = buildAssemblyJobIdentity({
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [clipA.hash, clipB.hash],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: saltedSnapshot,
    });
    return AssemblyJobSchema.parse({
      assemblyJobId: identity.assemblyJobId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyDefinitionId: DEF_ID,
      runtimeAuthorizationId: AUTH_ID,
      ownership: OWNERSHIP,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [clipA.hash, clipB.hash],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(saltedSnapshot),
      assemblyEngineSnapshotHash: saltedSnapshot,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T05:00:00.000Z",
    });
  }
});

describe("Sprint 3 PR 3.6 Assembly Runtime — media gate notice", () => {
  it("reports whether controlled media tests ran", () => {
    if (!RUN_MEDIA) {
      // Explicit skip signal for Release Manager report.
      expect(RUN_MEDIA).toBe(false);
    } else {
      expect(RUN_MEDIA).toBe(true);
    }
  });
});
