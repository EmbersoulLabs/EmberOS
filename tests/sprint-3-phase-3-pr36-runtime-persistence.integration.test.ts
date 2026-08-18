/**
 * Sprint 3 PR 3.6 — Assembly Runtime DB integration (artifacts + terminal facts).
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyArtifactPersistenceError,
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  buildAssemblyDefinitionFingerprint,
  closeDb,
  deterministicPersistenceUuid,
  listAssemblyArtifactRepositoryMutators,
} from "@ceo-agent/db";
import {
  AssemblyArtifactSchema,
  AssemblyJobSchema,
  buildAssemblyArtifactId,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyExecutionIdentity,
  buildAssemblyJobIdentity,
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  type AssemblyArtifact,
  type AssemblyJob,
  type AssemblySceneMembership,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import {
  buildAssemblyProcessingStartedFact,
  buildAssemblySucceededFact,
  createLocalAssemblyArtifactBlobStore,
  runDeterministicAssemblyRuntime,
} from "../packages/agents/src/ai-story";
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
const OUTPUT_HASH =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

function snapshotHash(salt = "runtime") {
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

describeIntegration("Sprint 3 PR 3.6 Assembly Runtime persistence", () => {
  let sql: Sql;
  let jobRepo: AssemblyJobRepositoryImpl;
  let artifactRepo: AssemblyArtifactRepositoryImpl;
  let executionPlanId: string;
  let assemblyDefinitionId: string;
  let baseJob: AssemblyJob;
  const orgIds = [PHASE_2A_IDS.orgId, PHASE_2A_WORKSPACE_B_IDS.orgId];

  async function cleanup() {
    await sql`DELETE FROM ai_story_assembly_artifacts WHERE org_id = ANY(${orgIds})`;
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

  function makeArtifact(job: AssemblyJob, executionIdentity: string): AssemblyArtifact {
    return AssemblyArtifactSchema.parse({
      artifactId: buildAssemblyArtifactId(executionIdentity),
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      artifactReference: `${job.ownership.workspaceId}/assembly/${job.assemblyJobId}/out.mp4`,
      contentHash: OUTPUT_HASH,
      mediaType: "video/mp4",
      durationMs: 2000,
      width: 1280,
      height: 720,
      frameRate: 30,
      byteSize: 4096,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      integrityHash: `sha256:${"ab".repeat(32)}`,
      createdAt: job.acceptedAt,
    });
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }

    await cleanup();
    await seedTenant(PHASE_2A_IDS, "phase-36-rt-a");
    await seedTenant(PHASE_2A_WORKSPACE_B_IDS, "phase-36-rt-b");

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose: "pr36-runtime" })
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
    baseJob = makeJob();
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await sql.end();
    await closeDb();
  }, 60_000);

  it("exposes append-only artifact repository surface", () => {
    const methods = listAssemblyArtifactRepositoryMutators();
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(methods).toContain("persistOrConverge");
  });

  it("accepted job → processing → artifact → success converges on replay", async () => {
    const accepted = await jobRepo.acceptOrConverge(baseJob);
    expect(accepted.replayed).toBe(false);

    const processing = buildAssemblyProcessingStartedFact(baseJob);
    const proc = await jobRepo.appendAssemblyJobFact(processing);
    expect(proc.replayed).toBe(false);
    const procReplay = await jobRepo.appendAssemblyJobFact(processing);
    expect(procReplay.replayed).toBe(true);

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

    const artifact = makeArtifact(baseJob, executionIdentity);
    const persisted = await artifactRepo.persistOrConverge(artifact, executionIdentity);
    expect(persisted.replayed).toBe(false);
    const artifactReplay = await artifactRepo.persistOrConverge(artifact, executionIdentity);
    expect(artifactReplay.replayed).toBe(true);
    expect(artifactReplay.artifact.createdAt).toBe(baseJob.acceptedAt);

    const succeeded = buildAssemblySucceededFact({
      job: baseJob,
      executionIdentity,
      finalMediaContentHash: OUTPUT_HASH,
      assemblyEngineSnapshotHash: baseJob.assemblyEngineSnapshotHash,
      completedAt: artifact.createdAt,
    });
    const terminal = await jobRepo.appendAssemblyJobFact(succeeded);
    expect(terminal.replayed).toBe(false);
    const terminalReplay = await jobRepo.appendAssemblyJobFact(succeeded);
    expect(terminalReplay.replayed).toBe(true);

    const facts = await jobRepo.loadAssemblyFacts(baseJob.assemblyJobId);
    expect(facts.filter((f) => f.factKind === "SUCCEEDED")).toHaveLength(1);
    expect(facts.filter((f) => f.factKind === "FAILED")).toHaveLength(0);
  });

  it("rejects conflicting artifact identity", async () => {
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
    const conflicting = {
      ...makeArtifact(baseJob, executionIdentity),
      contentHash:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      integrityHash: `sha256:${"cd".repeat(32)}`,
    };
    await expect(
      artifactRepo.persistOrConverge(conflicting, executionIdentity)
    ).rejects.toBeInstanceOf(AssemblyArtifactPersistenceError);
  });

  it("denies cross-workspace artifact ownership", async () => {
    const foreignJob = makeJob({
      assemblyEngineSnapshotHash: snapshotHash("foreign"),
    });
    // Force foreign ownership while keeping same plan ids — ownership check vs plan must fail.
    const foreign = AssemblyJobSchema.parse({
      ...foreignJob,
      ownership: {
        ...foreignJob.ownership,
        orgId: PHASE_2A_WORKSPACE_B_IDS.orgId,
        workspaceId: PHASE_2A_WORKSPACE_B_IDS.workspaceId,
        campaignId: PHASE_2A_WORKSPACE_B_IDS.campaignId,
        storyId: PHASE_2A_WORKSPACE_B_IDS.storyId,
        storyVersionId: PHASE_2A_WORKSPACE_B_IDS.storyVersionId,
        animationPackageId: PHASE_2A_WORKSPACE_B_IDS.animationPackageId,
      },
    });
    // Cannot accept foreign job against plan A — use artifact with mismatched ownership against accepted job.
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
    const badArtifact = {
      ...makeArtifact(baseJob, executionIdentity),
      artifactId: "10000000-0000-5000-8000-000000000999",
      ownership: foreign.ownership,
      integrityHash: `sha256:${"ef".repeat(32)}`,
    };
    await expect(
      artifactRepo.persistOrConverge(badArtifact, `${executionIdentity}-foreign`)
    ).rejects.toMatchObject({ code: "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID" });
  });

  it("does not create Final Story Result rows", async () => {
    // PR 3.7 Phase A may create ai_story_final_story_results in shared DBs.
    // Assembly Runtime must still never write Final Story Result rows.
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'ai_story_final_story_results'
    `;
    if (tables.length === 0) {
      return;
    }
    const count = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE org_id = ANY(${orgIds})
    `;
    expect(count[0]?.count).toBe("0");
  });

  it("orchestrator recovers SUCCEEDED from Postgres artifact without media/engine access", async () => {
    const recoveryJob = makeJob({
      assemblyEngineSnapshotHash: snapshotHash("orchestrator-recover"),
    });
    await jobRepo.acceptOrConverge(recoveryJob);

    const bytes = Buffer.from("pr36-postgres-recovery-artifact-bytes");
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const executionIdentity = buildAssemblyExecutionIdentity({
      executionPlanId: recoveryJob.executionPlanId,
      assemblyDefinitionId: recoveryJob.assemblyDefinitionId,
      assemblyJobId: recoveryJob.assemblyJobId,
      orderedSceneResultIds: [...recoveryJob.orderedSceneResultIds],
      orderedSceneContentHashes: [...recoveryJob.orderedSceneContentHashes],
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    });
    const artifact = {
      ...makeArtifact(recoveryJob, executionIdentity),
      contentHash,
      integrityHash: `sha256:${"11".repeat(32)}`,
    };
    await artifactRepo.persistOrConverge(artifact, executionIdentity);

    const blobRoot = await mkdtemp(join(tmpdir(), "pr36-asm-recover-"));
    const blobPath = join(blobRoot, artifact.artifactReference);
    await mkdir(resolve(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, bytes);

    const [defRow] = await sql<{ definition: StoryAssemblyDefinition }[]>`
      SELECT definition FROM ai_story_assembly_definitions
      WHERE assembly_definition_id = ${assemblyDefinitionId}
    `;
    const acceptedDefinition = defRow!.definition;
    const memberships: AssemblySceneMembership[] =
      acceptedDefinition.orderedSceneExecutionIds.map((sceneExecutionId, index) => ({
        membershipId: deterministicPersistenceUuid("assembly-membership", {
          assemblyDefinitionId,
          sceneExecutionId,
        }),
        assemblyDefinitionId,
        executionPlanId,
        sceneExecutionId,
        sceneId: index === 0 ? "scene-a" : "scene-b",
        sceneOrder: index,
        contractVersion: "1",
        deterministicFingerprint: `sha256:${"22".repeat(32)}`,
      }));
    const sceneResults: CanonicalSceneResult[] = recoveryJob.orderedSceneResultIds.map(
      (sceneResultId, index) => ({
        sceneResultId,
        executionPlanId,
        sceneRuntimeId: deterministicPersistenceUuid("scene-runtime", {
          sceneResultId,
          index,
        }),
        sceneExecutionId: acceptedDefinition.orderedSceneExecutionIds[index]!,
        sceneId: index === 0 ? "scene-a" : "scene-b",
        sceneOrder: index,
        ownership: recoveryJob.ownership,
        status: "SUCCEEDED",
        failureClassification: null,
        mediaReference: {
          uri: `${PHASE_2A_IDS.workspaceId}/scene-${index}.mp4`,
          contentHash: recoveryJob.orderedSceneContentHashes[index]!,
          mediaType: "video/mp4",
        },
        durationMs: 1000,
        acceptedAt: recoveryJob.acceptedAt,
        integrityHash: recoveryJob.orderedSceneContentHashes[index]!,
        contractVersion: "1",
      })
    );

    let engineRuns = 0;
    const mediaAccess = {
      resolveToLocalPath: async () => {
        throw new Error("media access must not run during artifact recovery");
      },
    };
    const outcome = await runDeterministicAssemblyRuntime({
      assemblyJobId: recoveryJob.assemblyJobId,
      sources: {
        definition: acceptedDefinition,
        memberships,
        sceneResults,
      },
      jobRepository: jobRepo,
      artifactRepository: artifactRepo,
      mediaAccess,
      blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
      hooks: {
        beforeEngineRun: async () => {
          engineRuns += 1;
        },
      },
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(engineRuns).toBe(0);
    const facts = await jobRepo.loadAssemblyFacts(recoveryJob.assemblyJobId);
    expect(facts.filter((f) => f.factKind === "SUCCEEDED")).toHaveLength(1);

    const concurrent = await Promise.all([
      runDeterministicAssemblyRuntime({
        assemblyJobId: recoveryJob.assemblyJobId,
        sources: { definition: acceptedDefinition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
        hooks: { beforeEngineRun: async () => { engineRuns += 1; } },
      }),
      runDeterministicAssemblyRuntime({
        assemblyJobId: recoveryJob.assemblyJobId,
        sources: { definition: acceptedDefinition, memberships, sceneResults },
        jobRepository: jobRepo,
        artifactRepository: artifactRepo,
        mediaAccess,
        blobStore: createLocalAssemblyArtifactBlobStore(blobRoot),
        hooks: { beforeEngineRun: async () => { engineRuns += 1; } },
      }),
    ]);
    expect(concurrent.every((row) => row.status === "SUCCEEDED")).toBe(true);
    expect(engineRuns).toBe(0);
    expect(
      (await jobRepo.loadAssemblyFacts(recoveryJob.assemblyJobId)).filter(
        (f) => f.factKind === "SUCCEEDED"
      )
    ).toHaveLength(1);

    await rm(blobRoot, { recursive: true, force: true });
  }, 120_000);
});
