/**
 * Sprint 3 PR 3.7 Phase B — Final Story Result Projector PostgreSQL integration.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  FinalStoryResultRepositoryImpl,
  buildAssemblyDefinitionFingerprint,
  closeDb,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";
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
  type AssemblyArtifact,
  type AssemblyJob,
} from "@ceo-agent/shared/server";
import {
  FinalStoryResultProjector,
  createLocalAssemblyArtifactBlobStore,
  buildAssemblySucceededFact,
  buildAssemblyFailedFact,
  buildAssemblyProcessingStartedFact,
} from "../packages/agents/src/ai-story";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const PR37B_IDS = {
  orgId: "b7100000-0000-4000-8000-000000000001",
  workspaceId: "b7100000-0000-4000-8000-000000000002",
  campaignId: "b7100000-0000-4000-8000-000000000003",
  storyId: "b7100000-0000-4000-8000-000000000004",
  storyVersionId: "b7100000-0000-4000-8000-000000000005",
  animationPackageId: "b7100000-0000-4000-8000-000000000006",
  assetId: "b7100000-0000-4000-8000-000000000007",
} as const;

const CREATOR_ID = "b7100000-0000-4000-8000-000000000040";
const AUTH_ID = "b7100000-0000-5000-8000-000000000401";
const SCENE_RESULT_A = "b7100000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "b7100000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FIXTURE_PREFIX = "pr37-phase-b-pg-fixture-mp4";
const REMOTE_STAGING_TEST_TIMEOUT_MS = 30_000;
const REMOTE_STAGING_CONVERGENCE_TIMEOUT_MS = 90_000;

function fixtureFor(salt: string): { bytes: Buffer; contentHash: string } {
  const bytes = Buffer.from(`${FIXTURE_PREFIX}:${salt}`);
  return {
    bytes,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

const scenePlanPayload = {
  scenePlan: [
    {
      id: "scene-a",
      beatIds: ["beat-0"],
      purpose: "A",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 0,
    },
    {
      id: "scene-b",
      beatIds: ["beat-1"],
      purpose: "B",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 1,
    },
  ],
};

function snapshotHash(salt = "pr37b-pg") {
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

async function applySqlFile(sqlClient: Sql, relativePath: string) {
  const migration = readFileSync(resolve(__dirname, relativePath), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sqlClient.unsafe(statement);
  }
}

describeIntegration("Sprint 3 PR 3.7 Phase B Final Story Result Projector (Postgres)", () => {
  let sql: Sql;
  let jobRepo: AssemblyJobRepositoryImpl;
  let artifactRepo: AssemblyArtifactRepositoryImpl;
  let fsrRepo: FinalStoryResultRepositoryImpl;
  let executionPlanId: string;
  let assemblyDefinitionId: string;
  let blobRoot: string;
  let blobStore: ReturnType<typeof createLocalAssemblyArtifactBlobStore>;
  let projector: FinalStoryResultProjector;

  async function cleanup() {
    // PostgreSQL RESTRICT order: FSR -> artifacts/facts -> jobs -> memberships/
    // definitions -> scene/runtime rows -> execution plan -> tenant parents.
    await sql`DELETE FROM ai_story_final_story_results WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_assembly_artifacts WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_assembly_job_facts WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_assembly_jobs WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ${PR37B_IDS.orgId}`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${PR37B_IDS.workspaceId}`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${PR37B_IDS.campaignId}`;
    await sql`DELETE FROM assets WHERE id = ${PR37B_IDS.assetId}`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id = ${PR37B_IDS.animationPackageId}`;
    await sql`DELETE FROM ai_story_versions WHERE id = ${PR37B_IDS.storyVersionId}`;
    await sql`DELETE FROM ai_stories WHERE id = ${PR37B_IDS.storyId}`;
    await sql`DELETE FROM campaigns WHERE id = ${PR37B_IDS.campaignId}`;
    await sql`DELETE FROM workspaces WHERE id = ${PR37B_IDS.workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${PR37B_IDS.orgId}`;
  }

  async function seedTenant() {
    const slug = "phase-37b";
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${PR37B_IDS.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${PR37B_IDS.workspaceId}, ${PR37B_IDS.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${CREATOR_ID}, 'operator')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${PR37B_IDS.campaignId}, ${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${slug})`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${PR37B_IDS.storyId}, ${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${PR37B_IDS.campaignId}, 'Story', 'Idea')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${PR37B_IDS.storyVersionId}, ${PR37B_IDS.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${PR37B_IDS.animationPackageId}, ${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${PR37B_IDS.campaignId}, ${PR37B_IDS.storyId}, ${PR37B_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${PR37B_IDS.assetId}, ${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${PR37B_IDS.campaignId}, 'image', ${`${slug}/asset.png`})`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${PR37B_IDS.campaignId}, ${PR37B_IDS.assetId})`;
  }

  async function insertAssemblyDefinition(planId: string, orderedSceneExecutionIds: string[]) {
    const fingerprint = buildAssemblyDefinitionFingerprint({
      executionPlanId: planId,
      orderedSceneExecutionIds,
    });
    const definitionId = deterministicPersistenceUuid(
      "story-assembly-definition",
      fingerprint
    );
    const definition = {
      assemblyDefinitionId: definitionId,
      executionPlanId: planId,
      orgId: PR37B_IDS.orgId,
      workspaceId: PR37B_IDS.workspaceId,
      campaignId: PR37B_IDS.campaignId,
      storyId: PR37B_IDS.storyId,
      storyVersionId: PR37B_IDS.storyVersionId,
      animationPackageId: PR37B_IDS.animationPackageId,
      sceneCount: orderedSceneExecutionIds.length,
      orderedSceneExecutionIds,
      createdBy: CREATOR_ID,
      createdAt: "2026-08-08T04:00:00.000Z",
      contractVersion: "1",
      deterministicFingerprint: fingerprint,
    };
    await sql`
      INSERT INTO ai_story_assembly_definitions (
        assembly_definition_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
        animation_package_id, execution_plan_id, scene_count, created_by, created_at,
        contract_version, deterministic_fingerprint, definition, accepted_at
      ) VALUES (
        ${definitionId}, ${PR37B_IDS.orgId}, ${PR37B_IDS.workspaceId}, ${PR37B_IDS.campaignId},
        ${PR37B_IDS.storyId}, ${PR37B_IDS.storyVersionId}, ${PR37B_IDS.animationPackageId},
        ${planId}, ${orderedSceneExecutionIds.length}, ${CREATOR_ID}, ${definition.createdAt},
        ${"1"}, ${fingerprint}, ${sql.json(definition)}, NOW()
      )
    `;
    return definitionId;
  }

  function makeJob(overrides: Partial<AssemblyJob> = {}): AssemblyJob {
    const orderedSceneResultIds =
      overrides.orderedSceneResultIds ?? [SCENE_RESULT_A, SCENE_RESULT_B];
    const orderedSceneContentHashes =
      overrides.orderedSceneContentHashes ?? [HASH_A, HASH_B];
    const assemblyEngineSnapshotHash =
      overrides.assemblyEngineSnapshotHash ?? snapshotHash();
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds,
      orderedSceneContentHashes,
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash,
    });
    return AssemblyJobSchema.parse({
      assemblyJobId: overrides.assemblyJobId ?? identity.assemblyJobId,
      executionPlanId,
      assemblyDefinitionId,
      runtimeAuthorizationId: AUTH_ID,
      ownership: {
        orgId: PR37B_IDS.orgId,
        workspaceId: PR37B_IDS.workspaceId,
        campaignId: PR37B_IDS.campaignId,
        storyId: PR37B_IDS.storyId,
        storyVersionId: PR37B_IDS.storyVersionId,
        animationPackageId: PR37B_IDS.animationPackageId,
        executionPlanId,
      },
      orderedSceneResultIds,
      orderedSceneContentHashes,
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId:
        overrides.assemblyEngineSnapshotId ??
        buildAssemblyEngineSnapshotId(assemblyEngineSnapshotHash),
      assemblyEngineSnapshotHash,
      deterministicFingerprint:
        overrides.deterministicFingerprint ?? identity.deterministicFingerprint,
      acceptedAt: overrides.acceptedAt ?? "2026-08-08T05:00:00.000Z",
    });
  }

  function makeArtifact(
    job: AssemblyJob,
    contentHash: string,
    byteSize: number
  ): AssemblyArtifact {
    const executionIdentity = buildAssemblyExecutionIdentity({
      executionPlanId: job.executionPlanId,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      orderedSceneResultIds: [...job.orderedSceneResultIds],
      orderedSceneContentHashes: [...job.orderedSceneContentHashes],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    });
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
      byteSize,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      integrityHash: `sha256:${contentHash.replace(/^sha256:/, "").slice(0, 64)}`,
      createdAt: job.acceptedAt,
    });
  }

  async function persistSucceededAssembly(
    job: AssemblyJob,
    salt: string,
    options: { readonly writeBytes?: boolean; readonly appendSucceeded?: boolean } = {}
  ) {
    const writeBytes = options.writeBytes ?? true;
    const appendSucceeded = options.appendSucceeded ?? true;
    const fixture = fixtureFor(salt);
    await jobRepo.acceptOrConverge(job);
    const artifact = makeArtifact(job, fixture.contentHash, fixture.bytes.byteLength);
    const executionIdentity = buildAssemblyExecutionIdentity({
      executionPlanId: job.executionPlanId,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      orderedSceneResultIds: [...job.orderedSceneResultIds],
      orderedSceneContentHashes: [...job.orderedSceneContentHashes],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    });
    await artifactRepo.persistOrConverge(artifact, executionIdentity);
    await jobRepo.appendAssemblyJobFact(buildAssemblyProcessingStartedFact(job));
    if (appendSucceeded) {
      await jobRepo.appendAssemblyJobFact(
        buildAssemblySucceededFact({
          job,
          executionIdentity,
          finalMediaContentHash: artifact.contentHash,
          assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
          completedAt: "2026-08-08T06:00:00.000Z",
        })
      );
    }
    if (writeBytes) {
      const target = join(blobRoot, artifact.artifactReference);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, fixture.bytes);
    }
    return { artifact, fixture };
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-rls-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }

    await cleanup();
    await seedTenant();

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PR37B_IDS,
        instructionPurpose: "pr37-fsr-projector",
      })
    );
    executionPlanId = persisted.plan.storyExecutionId;
    const orderedSceneExecutionIds = persisted.plan.sceneExecutions.map(
      (scene) => scene.sceneExecutionId
    );
    assemblyDefinitionId = await insertAssemblyDefinition(
      executionPlanId,
      orderedSceneExecutionIds
    );

    jobRepo = new AssemblyJobRepositoryImpl();
    artifactRepo = new AssemblyArtifactRepositoryImpl();
    fsrRepo = new FinalStoryResultRepositoryImpl();
    blobRoot = join(tmpdir(), `pr37b-pg-${Date.now()}`);
    await mkdir(blobRoot, { recursive: true });
    blobStore = createLocalAssemblyArtifactBlobStore(blobRoot);
    projector = new FinalStoryResultProjector({
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      finalStoryResultRepository: fsrRepo,
      artifactBlobStore: blobStore,
      hooks: { now: () => "2026-08-08T06:00:01.000Z" },
    });
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await sql.end();
    await closeDb();
  }, 60_000);

  it("loads accepted Assembly Job/facts/artifact and projects FSR", async () => {
    const job = makeJob();
    const { artifact, fixture } = await persistSucceededAssembly(job, "primary");
    const outcome = await projector.projectFromSucceededAssembly({
      executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(outcome.replayed).toBe(false);
    expect(outcome.assemblyArtifactId).toBe(artifact.artifactId);
    expect(outcome.contentHash).toBe(fixture.contentHash);
    const loaded = await fsrRepo.getByAssemblyJobId(job.assemblyJobId);
    expect(loaded?.finalStoryResultId).toBe(outcome.finalStoryResultId);
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);

  it("converges equivalent projector replay without duplicate rows", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("replay"),
    });
    await persistSucceededAssembly(job, "replay");
    const first = await projector.projectFromSucceededAssembly({
      executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    const replay = await projector.projectFromSucceededAssembly({
      executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.finalStoryResultId).toBe(first.finalStoryResultId);
    expect(replay.acceptedAt).toBe(first.acceptedAt);
    expect(replay.projectedAt).toBe(first.projectedAt);
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("1");
  }, REMOTE_STAGING_CONVERGENCE_TIMEOUT_MS);

  it("converges parallel equivalent projector calls", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("parallel"),
    });
    await persistSucceededAssembly(job, "parallel");
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        projector.projectFromSucceededAssembly({
          executionPlanId,
          assemblyJobId: job.assemblyJobId,
        })
      )
    );
    expect(outcomes.filter((row) => !row.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((row) => row.finalStoryResultId)).size).toBe(1);
    expect(new Set(outcomes.map((row) => row.acceptedAt)).size).toBe(1);
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("1");
  }, REMOTE_STAGING_CONVERGENCE_TIMEOUT_MS);

  it("fails closed on ownership mismatch without writing FSR", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash("ownership"),
    });
    await persistSucceededAssembly(job, "ownership");
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId: "b7100000-0000-4000-8000-000000009101",
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
    });
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("0");
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);

  it("fails closed on artifact hash mismatch without mutating Assembly facts", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash("hash-mismatch"),
    });
    const { artifact } = await persistSucceededAssembly(job, "hash-mismatch", {
      writeBytes: false,
    });
    const target = join(blobRoot, artifact.artifactReference);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from("tampered-pg-bytes"));

    const factsBefore = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_ARTIFACT_HASH_MISMATCH",
    });
    const factsAfter = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    expect(factsAfter.map((f) => f.factId)).toEqual(factsBefore.map((f) => f.factId));
    expect(factsAfter.some((f) => f.factKind === "SUCCEEDED")).toBe(true);
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("0");
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);

  it("projection failure does not mutate Assembly SUCCEEDED facts; retry succeeds", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("recover"),
    });
    await persistSucceededAssembly(job, "recover");
    let failOnce = true;
    const flaky = new FinalStoryResultProjector({
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      finalStoryResultRepository: fsrRepo,
      artifactBlobStore: blobStore,
      hooks: {
        now: () => "2026-08-08T06:00:01.000Z",
        beforePersist: async () => {
          if (failOnce) {
            failOnce = false;
            throw new Error("injected db blip");
          }
        },
      },
    });

    const factsBefore = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    await expect(
      flaky.projectFromSucceededAssembly({
        executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT",
    });
    const factsMid = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    expect(factsMid.map((f) => f.factId)).toEqual(factsBefore.map((f) => f.factId));

    const recovered = await flaky.projectFromSucceededAssembly({
      executionPlanId,
      assemblyJobId: job.assemblyJobId,
    });
    expect(recovered.replayed).toBe(false);
    const factsAfter = await jobRepo.loadAssemblyFacts(job.assemblyJobId);
    expect(factsAfter.map((f) => f.factId)).toEqual(factsBefore.map((f) => f.factId));
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);

  it("fails closed when Assembly is FAILED; no FSR row", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("failed"),
    });
    await jobRepo.acceptOrConverge(job);
    const fixture = fixtureFor("failed");
    const artifact = makeArtifact(job, fixture.contentHash, fixture.bytes.byteLength);
    const executionIdentity = buildAssemblyExecutionIdentity({
      executionPlanId: job.executionPlanId,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      orderedSceneResultIds: [...job.orderedSceneResultIds],
      orderedSceneContentHashes: [...job.orderedSceneContentHashes],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    });
    await artifactRepo.persistOrConverge(artifact, executionIdentity);
    await jobRepo.appendAssemblyJobFact(
      buildAssemblyFailedFact({
        job,
        classification: "ASSEMBLY_INFRASTRUCTURE_TERMINAL",
      })
    );
    await expect(
      projector.projectFromSucceededAssembly({
        executionPlanId,
        assemblyJobId: job.assemblyJobId,
      })
    ).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_PRECONDITION_FAILED",
    });
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("0");
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);

  it("fails closed for conflicting persistence after canonical winner", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash("conflict"),
    });
    const { artifact } = await persistSucceededAssembly(job, "conflict");
    const winner = await projector.projectFromSucceededAssembly({
      executionPlanId,
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
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("1");
  }, REMOTE_STAGING_TEST_TIMEOUT_MS);
});
