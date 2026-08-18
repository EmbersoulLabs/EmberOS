/**
 * Sprint 3 PR 3.6 Phase 3 — Assembly Job persistence integration tests.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyJobPersistenceError,
  AssemblyJobRepositoryImpl,
  buildAssemblyDefinitionFingerprint,
  closeDb,
  deterministicPersistenceUuid,
  listAssemblyJobRepositoryMutators,
} from "@ceo-agent/db";
import {
  AssemblyFailedFactSchema,
  AssemblyJobSchema,
  AssemblyProcessingStartedFactSchema,
  AssemblySucceededFactSchema,
  assemblyIntegrityHash,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyJobIdentity,
  type AssemblyEngineSnapshotConfig,
  type AssemblyJob,
  type AssemblyJobFact,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { makePhase2aCompilation, PHASE_2A_IDS, PHASE_2A_WORKSPACE_B_IDS } from "./helpers/ai-story-phase-2a";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const CREATOR_ID = "10000000-0000-4000-8000-000000000040";
const AUTH_ID = "10000000-0000-5000-8000-000000000401";
const SCENE_RESULT_A = "10000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "10000000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

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

async function applySqlFile(sqlClient: Sql, relativePath: string) {
  const migration = readFileSync(resolve(__dirname, relativePath), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sqlClient.unsafe(statement);
  }
}

describeIntegration("Sprint 3 PR 3.6 Phase 3 assembly job persistence", () => {
  let sql: Sql;
  let repo: AssemblyJobRepositoryImpl;
  let executionPlanId: string;
  let assemblyDefinitionId: string;
  let baseJob: AssemblyJob;
  const orgIds = [PHASE_2A_IDS.orgId, PHASE_2A_WORKSPACE_B_IDS.orgId];

  async function cleanup() {
    await sql`DELETE FROM ai_story_assembly_job_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_jobs WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId})`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM assets WHERE id IN (${PHASE_2A_IDS.assetId}, ${PHASE_2A_WORKSPACE_B_IDS.assetId})`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id IN (${PHASE_2A_IDS.animationPackageId}, ${PHASE_2A_WORKSPACE_B_IDS.animationPackageId})`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${PHASE_2A_IDS.storyId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId})`;
    await sql`DELETE FROM campaigns WHERE id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId})`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;
  }

  async function seedTenant(ids: typeof PHASE_2A_IDS, slug: string) {
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
      orgId: PHASE_2A_IDS.orgId,
      workspaceId: PHASE_2A_IDS.workspaceId,
      campaignId: PHASE_2A_IDS.campaignId,
      storyId: PHASE_2A_IDS.storyId,
      storyVersionId: PHASE_2A_IDS.storyVersionId,
      animationPackageId: PHASE_2A_IDS.animationPackageId,
      sceneCount: orderedSceneExecutionIds.length,
      orderedSceneExecutionIds,
      createdBy: CREATOR_ID,
      createdAt: "2026-08-06T04:00:00.000Z",
      contractVersion: "1",
      deterministicFingerprint: fingerprint,
    };
    await sql`
      INSERT INTO ai_story_assembly_definitions (
        assembly_definition_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
        animation_package_id, execution_plan_id, scene_count, created_by, created_at,
        contract_version, deterministic_fingerprint, definition, accepted_at
      ) VALUES (
        ${definitionId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId},
        ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
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
      overrides.assemblyEngineSnapshotHash ??
      buildAssemblyEngineSnapshotContentHash(snapshotConfig());
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
      ownership: overrides.ownership ?? {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        campaignId: PHASE_2A_IDS.campaignId,
        storyId: PHASE_2A_IDS.storyId,
        storyVersionId: PHASE_2A_IDS.storyVersionId,
        animationPackageId: PHASE_2A_IDS.animationPackageId,
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
      acceptedAt: overrides.acceptedAt ?? "2026-08-06T05:00:00.000Z",
    });
  }

  function processingFact(job: AssemblyJob, startedAt: string): AssemblyJobFact {
    const payload = {
      factKind: "PROCESSING_STARTED" as const,
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      startedAt,
      contractVersion: "1" as const,
    };
    const integrityHash = assemblyIntegrityHash({
      kind: "assembly-processing-started-fact",
      ...payload,
    });
    return AssemblyProcessingStartedFactSchema.parse({
      ...payload,
      factId: crypto.randomUUID(),
      integrityHash,
    });
  }

  function failedFact(job: AssemblyJob): AssemblyJobFact {
    const payload = {
      factKind: "FAILED" as const,
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      failureClassification: "ASSEMBLY_ENGINE_FAILED" as const,
      message: "Assembly failed closed",
      failedAt: "2026-08-06T05:10:00.000Z",
      contractVersion: "1" as const,
    };
    const integrityHash = assemblyIntegrityHash({
      kind: "assembly-failed-fact",
      ...payload,
    });
    return AssemblyFailedFactSchema.parse({
      ...payload,
      factId: crypto.randomUUID(),
      integrityHash,
    });
  }

  function succeededFact(job: AssemblyJob, storyResultId: string): AssemblyJobFact {
    const payload = {
      factKind: "SUCCEEDED" as const,
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      storyResultId,
      finalMediaContentHash: HASH_C,
      completedAt: "2026-08-06T05:12:00.000Z",
      contractVersion: "1" as const,
    };
    const integrityHash = assemblyIntegrityHash({
      kind: "assembly-succeeded-fact",
      ...payload,
    });
    return AssemblySucceededFactSchema.parse({
      ...payload,
      factId: crypto.randomUUID(),
      integrityHash,
    });
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }

    await cleanup();
    await seedTenant(PHASE_2A_IDS, "phase-36-p3-a");
    await seedTenant(PHASE_2A_WORKSPACE_B_IDS, "phase-36-p3-b");

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose: "pr36-phase3" })
    );
    executionPlanId = persisted.plan.storyExecutionId;
    const orderedSceneExecutionIds = persisted.plan.sceneExecutions.map(
      (scene) => scene.sceneExecutionId
    );
    assemblyDefinitionId = await insertAssemblyDefinition(
      executionPlanId,
      orderedSceneExecutionIds
    );
    repo = new AssemblyJobRepositoryImpl();
    baseJob = makeJob();
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await sql.end();
    await closeDb();
  }, 60_000);

  it("exposes append-only repository surface without update/delete", () => {
    const methods = listAssemblyJobRepositoryMutators();
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(methods).toContain("acceptOrConverge");
    expect(methods).toContain("appendAssemblyJobFact");
  });

  it("accepts an Assembly Job", async () => {
    const result = await repo.acceptOrConverge(baseJob);
    expect(result.replayed).toBe(false);
    expect(result.job.assemblyJobId).toBe(baseJob.assemblyJobId);
    expect(result.acceptedFact.factKind).toBe("ACCEPTED");
    const loaded = await repo.getByAssemblyJobId(baseJob.assemblyJobId);
    expect(loaded?.acceptedAt).toBe(baseJob.acceptedAt);
  });

  it("converges equivalent replay and preserves acceptedAt", async () => {
    const replay = await repo.acceptOrConverge({
      ...baseJob,
      acceptedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.job.acceptedAt).toBe(baseJob.acceptedAt);
    expect(replay.job.deterministicFingerprint).toBe(baseJob.deterministicFingerprint);
  });

  it("rejects conflicting replay", async () => {
    const conflicting = {
      ...baseJob,
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000499",
    };
    await expect(repo.acceptOrConverge(conflicting)).rejects.toMatchObject({
      code: "ASSEMBLY_IDENTITY_CONFLICT",
    });
  });

  it("rejects duplicate fingerprint with conflicting identity", async () => {
    const colliding = {
      ...baseJob,
      assemblyJobId: "10000000-0000-5000-8000-000000000777",
    };
    await expect(repo.acceptOrConverge(colliding)).rejects.toMatchObject({
      code: "ASSEMBLY_IDENTITY_CONFLICT",
    });
  });

  it("converges concurrent identical requests", async () => {
    const config = snapshotConfig({ binaryBuildHash: HASH_C });
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_C],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    const job = makeJob({
      orderedSceneContentHashes: [HASH_A, HASH_C],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyJobId: identity.assemblyJobId,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T06:00:00.000Z",
    });

    const [a, b, c] = await Promise.all([
      repo.acceptOrConverge(job),
      repo.acceptOrConverge(job),
      repo.acceptOrConverge(job),
    ]);
    const ids = new Set([a.job.assemblyJobId, b.job.assemblyJobId, c.job.assemblyJobId]);
    expect(ids.size).toBe(1);
    expect([a, b, c].filter((row) => !row.replayed).length).toBeLessThanOrEqual(1);
    expect(a.job.acceptedAt).toBe(b.job.acceptedAt);
  });

  it("fails concurrent conflicting requests", async () => {
    const config = snapshotConfig({ engineImplementationVersion: "conflict" });
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_B, SCENE_RESULT_A],
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    const job = makeJob({
      orderedSceneResultIds: [SCENE_RESULT_B, SCENE_RESULT_A],
      orderedSceneContentHashes: [HASH_B, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyJobId: identity.assemblyJobId,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T06:30:00.000Z",
    });
    await repo.acceptOrConverge(job);

    const conflicting = {
      ...job,
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000498",
    };
    const results = await Promise.allSettled([
      repo.acceptOrConverge(conflicting),
      repo.acceptOrConverge(conflicting),
    ]);
    expect(results.every((row) => row.status === "rejected")).toBe(true);
    for (const row of results) {
      if (row.status === "rejected") {
        expect((row.reason as AssemblyJobPersistenceError).code).toBe(
          "ASSEMBLY_IDENTITY_CONFLICT"
        );
      }
    }
  });

  it("treats ProcessingStartedFact as operational only", async () => {
    const before = await repo.getByAssemblyJobId(baseJob.assemblyJobId);
    const appended = await repo.appendAssemblyJobFact(
      processingFact(baseJob, "2026-08-06T05:05:00.000Z")
    );
    expect(appended.fact.factKind).toBe("PROCESSING_STARTED");
    const after = await repo.getByAssemblyJobId(baseJob.assemblyJobId);
    expect(after?.acceptedAt).toBe(before?.acceptedAt);
    expect(after?.deterministicFingerprint).toBe(before?.deterministicFingerprint);
    const facts = await repo.loadAssemblyFacts(baseJob.assemblyJobId);
    expect(facts.some((fact) => fact.factKind === "PROCESSING_STARTED")).toBe(true);
    expect(facts.filter((fact) => fact.factKind === "SUCCEEDED" || fact.factKind === "FAILED")).toHaveLength(0);
  });

  it("allows only one terminal fact", async () => {
    const failed = await repo.appendAssemblyJobFact(failedFact(baseJob));
    expect(failed.replayed).toBe(false);
    await expect(
      repo.appendAssemblyJobFact(
        succeededFact(baseJob, "10000000-0000-5000-8000-000000000801")
      )
    ).rejects.toMatchObject({ code: "ASSEMBLY_STATE_INVALID" });

    const conflictingFailed = AssemblyFailedFactSchema.parse({
      ...failedFact(baseJob),
      factId: crypto.randomUUID(),
      message: "A different terminal failure",
      integrityHash: assemblyIntegrityHash({
        kind: "assembly-failed-fact-conflict",
        assemblyJobId: baseJob.assemblyJobId,
        message: "A different terminal failure",
      }),
    });
    await expect(repo.appendAssemblyJobFact(conflictingFailed)).rejects.toMatchObject({
      code: "ASSEMBLY_STATE_INVALID",
    });

    // Equivalent FAILED payload converges instead of creating a second terminal.
    const equivalentReplay = await repo.appendAssemblyJobFact(failed.fact);
    expect(equivalentReplay.replayed).toBe(true);
    expect(equivalentReplay.fact.factId).toBe(failed.fact.factId);
  });

  it("enforces append-only fact identity convergence under lock", async () => {
    const config = snapshotConfig({ binaryName: "ffmpeg-lock" });
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_B, HASH_B],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    const job = makeJob({
      orderedSceneContentHashes: [HASH_B, HASH_B],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyJobId: identity.assemblyJobId,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-06T07:00:00.000Z",
    });
    await repo.acceptOrConverge(job);
    const lock = await repo.acquireTerminalAcceptanceLock(job.assemblyJobId);
    const terminal = failedFact(job);
    const results = await Promise.allSettled([
      lock.run(({ appendFact }) => appendFact(terminal)),
      lock.run(({ appendFact }) => appendFact(terminal)),
    ]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const facts = await repo.loadAssemblyFacts(job.assemblyJobId);
    expect(facts.filter((fact) => fact.factKind === "FAILED")).toHaveLength(1);
  });

  it("rejects ownership mismatch", async () => {
    const config = snapshotConfig({ pixelFormat: "yuv422p" });
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_A],
      orderedSceneContentHashes: [HASH_A],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    // Need min 1 scene - AssemblyJob requires min 1. Use two for schema consistency with definition? Job identity can have different scene lists than definition for this ownership test — ownership fails first.
    const bad = makeJob({
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyJobId: identity.assemblyJobId,
      deterministicFingerprint: identity.deterministicFingerprint,
      ownership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        campaignId: PHASE_2A_IDS.campaignId,
        storyId: PHASE_2A_IDS.storyId,
        storyVersionId: PHASE_2A_IDS.storyVersionId,
        animationPackageId: PHASE_2A_IDS.animationPackageId,
        executionPlanId,
      },
    });
    // Force ownership drift on campaign
    const drifted = {
      ...bad,
      ownership: {
        ...bad.ownership,
        campaignId: PHASE_2A_WORKSPACE_B_IDS.campaignId,
      },
    };
    // Recompute identity for drifted content hashes path - use unique fingerprint via hash list
    const uniqueIdentity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    const ownershipMismatchJob = AssemblyJobSchema.parse({
      ...drifted,
      assemblyJobId: uniqueIdentity.assemblyJobId,
      deterministicFingerprint: uniqueIdentity.deterministicFingerprint,
      orderedSceneContentHashes: [HASH_A, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
    });
    await expect(repo.acceptOrConverge(ownershipMismatchJob)).rejects.toMatchObject({
      code: "ASSEMBLY_OWNERSHIP_INVALID",
    });
  });

  it("rejects cross-workspace Assembly Job", async () => {
    const config = snapshotConfig({ audioCodec: "none" });
    const snapshotHash = buildAssemblyEngineSnapshotContentHash(config);
    const identity = buildAssemblyJobIdentity({
      executionPlanId,
      assemblyDefinitionId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_C, HASH_A],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: snapshotHash,
    });
    const crossWorkspace = AssemblyJobSchema.parse({
      ...makeJob(),
      orderedSceneContentHashes: [HASH_C, HASH_A],
      assemblyEngineSnapshotHash: snapshotHash,
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(snapshotHash),
      assemblyJobId: identity.assemblyJobId,
      deterministicFingerprint: identity.deterministicFingerprint,
      ownership: {
        orgId: PHASE_2A_WORKSPACE_B_IDS.orgId,
        workspaceId: PHASE_2A_WORKSPACE_B_IDS.workspaceId,
        campaignId: PHASE_2A_WORKSPACE_B_IDS.campaignId,
        storyId: PHASE_2A_WORKSPACE_B_IDS.storyId,
        storyVersionId: PHASE_2A_WORKSPACE_B_IDS.storyVersionId,
        animationPackageId: PHASE_2A_WORKSPACE_B_IDS.animationPackageId,
        executionPlanId,
      },
      acceptedAt: "2026-08-06T08:00:00.000Z",
    });
    await expect(repo.acceptOrConverge(crossWorkspace)).rejects.toMatchObject({
      code: "ASSEMBLY_OWNERSHIP_INVALID",
    });
  });
});
