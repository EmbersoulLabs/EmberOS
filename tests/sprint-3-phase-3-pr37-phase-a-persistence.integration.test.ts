/**
 * Sprint 3 PR 3.7 Phase A — Final Story Result persistence integration.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  FinalStoryResultPersistenceError,
  FinalStoryResultRepositoryImpl,
  buildAssemblyDefinitionFingerprint,
  closeDb,
  deterministicPersistenceUuid,
  listFinalStoryResultRepositoryMutators,
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
  type FinalStoryResultPersistenceRecord,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const PR37_IDS = {
  orgId: "37000000-0000-4000-8000-000000000001",
  workspaceId: "37000000-0000-4000-8000-000000000002",
  campaignId: "37000000-0000-4000-8000-000000000003",
  storyId: "37000000-0000-4000-8000-000000000004",
  storyVersionId: "37000000-0000-4000-8000-000000000005",
  animationPackageId: "37000000-0000-4000-8000-000000000006",
  assetId: "37000000-0000-4000-8000-000000000007",
} as const;

const PR37_IDS_B = {
  orgId: "47000000-0000-4000-8000-000000000001",
  workspaceId: "47000000-0000-4000-8000-000000000002",
  campaignId: "47000000-0000-4000-8000-000000000003",
  storyId: "47000000-0000-4000-8000-000000000004",
  storyVersionId: "47000000-0000-4000-8000-000000000005",
  animationPackageId: "47000000-0000-4000-8000-000000000006",
  assetId: "47000000-0000-4000-8000-000000000007",
} as const;

const CREATOR_ID = "37000000-0000-4000-8000-000000000040";
const AUTH_ID = "37000000-0000-5000-8000-000000000401";
const SCENE_RESULT_A = "37000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "37000000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OUTPUT_HASH =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

function snapshotHash(salt = "pr37") {
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

describeIntegration("Sprint 3 PR 3.7 Phase A Final Story Result persistence", () => {
  let sql: Sql;
  let jobRepo: AssemblyJobRepositoryImpl;
  let artifactRepo: AssemblyArtifactRepositoryImpl;
  let fsrRepo: FinalStoryResultRepositoryImpl;
  let executionPlanId: string;
  let assemblyDefinitionId: string;
  let baseJob: AssemblyJob;
  let baseArtifact: AssemblyArtifact;
  let baseRecord: FinalStoryResultPersistenceRecord;
  const orgIds = [PR37_IDS.orgId, PR37_IDS_B.orgId];

  async function cleanup() {
    await sql`DELETE FROM ai_story_final_story_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_artifacts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_job_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_jobs WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (${PR37_IDS.workspaceId}, ${PR37_IDS_B.workspaceId})`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${PR37_IDS.campaignId}, ${PR37_IDS_B.campaignId})`;
    await sql`DELETE FROM assets WHERE id IN (${PR37_IDS.assetId}, ${PR37_IDS_B.assetId})`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id IN (${PR37_IDS.animationPackageId}, ${PR37_IDS_B.animationPackageId})`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${PR37_IDS.storyVersionId}, ${PR37_IDS_B.storyVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${PR37_IDS.storyId}, ${PR37_IDS_B.storyId})`;
    await sql`DELETE FROM campaigns WHERE id IN (${PR37_IDS.campaignId}, ${PR37_IDS_B.campaignId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${PR37_IDS.workspaceId}, ${PR37_IDS_B.workspaceId})`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;
  }

  async function seedTenant(ids: typeof PR37_IDS, slug: string) {
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.orgId}, ${ids.workspaceId}, ${CREATOR_ID}, 'operator')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${slug})`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'Story', 'Idea')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${slug}/asset.png`})`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId})`;
  }

  async function insertAssemblyDefinition(planId: string, orderedSceneExecutionIds: string[]) {
    const fingerprint = buildAssemblyDefinitionFingerprint({
      executionPlanId: planId,
      orderedSceneExecutionIds,
    });
    const definitionId = deterministicPersistenceUuid("story-assembly-definition", fingerprint);
    const definition = {
      assemblyDefinitionId: definitionId,
      executionPlanId: planId,
      orgId: PR37_IDS.orgId,
      workspaceId: PR37_IDS.workspaceId,
      campaignId: PR37_IDS.campaignId,
      storyId: PR37_IDS.storyId,
      storyVersionId: PR37_IDS.storyVersionId,
      animationPackageId: PR37_IDS.animationPackageId,
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
        ${definitionId}, ${PR37_IDS.orgId}, ${PR37_IDS.workspaceId}, ${PR37_IDS.campaignId},
        ${PR37_IDS.storyId}, ${PR37_IDS.storyVersionId}, ${PR37_IDS.animationPackageId},
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
      runtimeAuthorizationId: overrides.runtimeAuthorizationId ?? AUTH_ID,
      ownership: {
        orgId: PR37_IDS.orgId,
        workspaceId: PR37_IDS.workspaceId,
        campaignId: PR37_IDS.campaignId,
        storyId: PR37_IDS.storyId,
        storyVersionId: PR37_IDS.storyVersionId,
        animationPackageId: PR37_IDS.animationPackageId,
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
    executionIdentity: string,
    contentHash = OUTPUT_HASH
  ): AssemblyArtifact {
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
      byteSize: 8192,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      integrityHash: `sha256:${contentHash.replace(/^sha256:/, "").slice(0, 64)}`,
      createdAt: job.acceptedAt,
    });
  }

  function makeRecord(
    job: AssemblyJob,
    artifact: AssemblyArtifact,
    overrides: Partial<{
      acceptedAt: string;
      projectedAt: string;
      totalDurationMs: number;
    }> = {}
  ): FinalStoryResultPersistenceRecord {
    return buildFinalStoryResultPersistenceRecord({
      ownership: job.ownership,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      assemblyJobIdentity: job.deterministicFingerprint,
      assemblyArtifactId: artifact.artifactId,
      orderedSceneResultIds: job.orderedSceneResultIds,
      outputMediaReference: artifact.artifactReference,
      contentHash: artifact.contentHash,
      totalDurationMs: overrides.totalDurationMs ?? artifact.durationMs,
      width: artifact.width,
      height: artifact.height,
      frameRate: artifact.frameRate,
      assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
      acceptedAt: overrides.acceptedAt ?? "2026-08-08T06:00:00.000Z",
      projectedAt: overrides.projectedAt ?? "2026-08-08T06:00:01.000Z",
    });
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
    // Idempotent second apply
    await applySqlFile(sql, "../packages/db/sql/ai-story-final-story-result-v1.sql");
    await applySqlFile(sql, "../packages/db/sql/ai-story-final-story-result-rls-v1.sql");

    await cleanup();
    await seedTenant(PR37_IDS, "phase-37a-a");
    await seedTenant(PR37_IDS_B, "phase-37a-b");

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PR37_IDS,
        instructionPurpose: "pr37-fsr",
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
    baseJob = makeJob();
    await jobRepo.acceptOrConverge(baseJob);
    const executionIdentity = buildAssemblyExecutionIdentity({
      executionPlanId: baseJob.executionPlanId,
      assemblyDefinitionId: baseJob.assemblyDefinitionId,
      assemblyJobId: baseJob.assemblyJobId,
      orderedSceneResultIds: [...baseJob.orderedSceneResultIds],
      orderedSceneContentHashes: [...baseJob.orderedSceneContentHashes],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    });
    baseArtifact = makeArtifact(baseJob, executionIdentity);
    await artifactRepo.persistOrConverge(baseArtifact, executionIdentity);
    baseRecord = makeRecord(baseJob, baseArtifact);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await sql.end();
    await closeDb();
  }, 60_000);

  it("exposes append-only repository surface", () => {
    const methods = listFinalStoryResultRepositoryMutators();
    expect(methods).toEqual([
      "getByFinalStoryResultId",
      "getByExecutionPlanId",
      "getByAssemblyJobId",
      "acceptOrConverge",
    ]);
  });

  it("accepts one Final Story Result and converges equivalent replay", async () => {
    const first = await fsrRepo.acceptOrConverge(baseRecord);
    expect(first.replayed).toBe(false);

    const replay = await fsrRepo.acceptOrConverge(
      makeRecord(baseJob, baseArtifact, {
        acceptedAt: "2026-08-08T09:00:00.000Z",
        projectedAt: "2026-08-08T09:00:01.000Z",
      })
    );
    expect(replay.replayed).toBe(true);
    expect(replay.result.acceptedAt).toBe(first.result.acceptedAt);
    expect(replay.result.projectedAt).toBe(first.result.projectedAt);
    expect(replay.result.finalStoryResultId).toBe(first.result.finalStoryResultId);

    const byId = await fsrRepo.getByFinalStoryResultId(first.result.finalStoryResultId);
    const byJob = await fsrRepo.getByAssemblyJobId(baseJob.assemblyJobId);
    const byPlan = await fsrRepo.getByExecutionPlanId(executionPlanId);
    expect(byId?.finalStoryResultId).toBe(first.result.finalStoryResultId);
    expect(byJob?.finalStoryResultId).toBe(first.result.finalStoryResultId);
    expect(byPlan?.finalStoryResultId).toBe(first.result.finalStoryResultId);

    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${baseJob.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("1");
  });

  it("rejects conflicting replay for the same Assembly Job", async () => {
    const conflicting = makeRecord(baseJob, baseArtifact, { totalDurationMs: 9999 });
    await expect(fsrRepo.acceptOrConverge(conflicting)).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
    });
  });

  it("converges parallel equivalent inserts", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("parallel"),
    });
    await jobRepo.acceptOrConverge(job);
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
    const artifact = makeArtifact(
      job,
      executionIdentity,
      "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    );
    await artifactRepo.persistOrConverge(artifact, executionIdentity);
    const record = makeRecord(job, artifact);

    const outcomes = await Promise.all([
      fsrRepo.acceptOrConverge(record),
      fsrRepo.acceptOrConverge(record),
      fsrRepo.acceptOrConverge(record),
      fsrRepo.acceptOrConverge(record),
    ]);
    const accepted = outcomes.filter((row) => !row.replayed);
    expect(accepted.length).toBe(1);
    expect(new Set(outcomes.map((row) => row.result.finalStoryResultId)).size).toBe(1);
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE assembly_job_id = ${job.assemblyJobId}
    `;
    expect(count[0]?.count).toBe("1");
  });

  it("converges high-contention equivalent inserts", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash("contention"),
    });
    await jobRepo.acceptOrConverge(job);
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
    const artifact = makeArtifact(
      job,
      executionIdentity,
      "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    );
    await artifactRepo.persistOrConverge(artifact, executionIdentity);
    const record = makeRecord(job, artifact);

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => fsrRepo.acceptOrConverge(record))
    );
    expect(outcomes.filter((row) => !row.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((row) => row.result.acceptedAt)).size).toBe(1);
  });

  it("fails closed on conflicting concurrent inserts for same Assembly Job", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash("conflict-race"),
    });
    await jobRepo.acceptOrConverge(job);
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
    const artifact = makeArtifact(
      job,
      executionIdentity,
      "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    );
    await artifactRepo.persistOrConverge(artifact, executionIdentity);
    const a = makeRecord(job, artifact, { totalDurationMs: 4000 });
    const b = makeRecord(job, artifact, { totalDurationMs: 5000 });

    const results = await Promise.allSettled([
      fsrRepo.acceptOrConverge(a),
      fsrRepo.acceptOrConverge(b),
    ]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row) => row.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(FinalStoryResultPersistenceError);
    expect((reason as FinalStoryResultPersistenceError).code).toBe(
      "FINAL_STORY_RESULT_IDENTITY_CONFLICT"
    );
  });

  it("denies ownership mismatch and foreign workspace ownership", async () => {
    const mismatched = buildFinalStoryResultPersistenceRecord({
      ownership: {
        ...baseJob.ownership,
        orgId: PR37_IDS_B.orgId,
        workspaceId: PR37_IDS_B.workspaceId,
      },
      assemblyDefinitionId: baseJob.assemblyDefinitionId,
      assemblyJobId: baseJob.assemblyJobId,
      assemblyJobIdentity: baseJob.deterministicFingerprint,
      assemblyArtifactId: baseArtifact.artifactId,
      orderedSceneResultIds: baseJob.orderedSceneResultIds,
      outputMediaReference: `${PR37_IDS_B.workspaceId}/assembly/${baseJob.assemblyJobId}/out.mp4`,
      contentHash: baseArtifact.contentHash,
      totalDurationMs: baseArtifact.durationMs,
      width: baseArtifact.width,
      height: baseArtifact.height,
      frameRate: baseArtifact.frameRate,
      assemblyEngineSnapshotHash: baseJob.assemblyEngineSnapshotHash,
      acceptedAt: "2026-08-08T08:00:00.000Z",
      projectedAt: "2026-08-08T08:00:01.000Z",
    });
    await expect(fsrRepo.acceptOrConverge(mismatched)).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
    });
  });

  it("enforces FK integrity for missing Assembly Artifact", async () => {
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash("fk-missing"),
    });
    await jobRepo.acceptOrConverge(job);
    const fakeArtifactId = "37000000-0000-4000-8000-000000000099";
    const bogus = buildFinalStoryResultPersistenceRecord({
      ownership: job.ownership,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      assemblyJobIdentity: job.deterministicFingerprint,
      assemblyArtifactId: fakeArtifactId,
      orderedSceneResultIds: job.orderedSceneResultIds,
      outputMediaReference: `${job.ownership.workspaceId}/assembly/${job.assemblyJobId}/missing.mp4`,
      contentHash: OUTPUT_HASH,
      totalDurationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
      acceptedAt: "2026-08-08T07:00:00.000Z",
      projectedAt: "2026-08-08T07:00:01.000Z",
    });
    await expect(fsrRepo.acceptOrConverge(bogus)).rejects.toMatchObject({
      code: "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
    });
  });
});
