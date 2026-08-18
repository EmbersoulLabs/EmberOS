/**
 * Sprint 3 PR 3.7 Phase A — Final Story Result RLS integration.
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
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
  isRlsEnabled,
  withAuthenticatedUser,
} from "./helpers/db-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const IDS_A = {
  orgId: "37100000-0000-4000-8000-000000000001",
  workspaceId: "37100000-0000-4000-8000-000000000002",
  campaignId: "37100000-0000-4000-8000-000000000003",
  storyId: "37100000-0000-4000-8000-000000000004",
  storyVersionId: "37100000-0000-4000-8000-000000000005",
  animationPackageId: "37100000-0000-4000-8000-000000000006",
  assetId: "37100000-0000-4000-8000-000000000007",
} as const;

const IDS_B = {
  orgId: "47100000-0000-4000-8000-000000000001",
  workspaceId: "47100000-0000-4000-8000-000000000002",
  campaignId: "47100000-0000-4000-8000-000000000003",
  storyId: "47100000-0000-4000-8000-000000000004",
  storyVersionId: "47100000-0000-4000-8000-000000000005",
  animationPackageId: "47100000-0000-4000-8000-000000000006",
  assetId: "47100000-0000-4000-8000-000000000007",
} as const;

const USER_A = "37100000-0000-4000-8000-000000000040";
const USER_B = "47100000-0000-4000-8000-000000000040";
const AUTH_ID = "37100000-0000-5000-8000-000000000401";
const SCENE_RESULT_A = "37100000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "37100000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OUTPUT_HASH =
  "sha256:4444444444444444444444444444444444444444444444444444444444444444";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

function isRlsViolation(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: string })?.code ?? "");
  return (
    /row-level security|violates row-level security|permission denied/i.test(
      message
    ) || code === "42501"
  );
}

async function applySqlFile(sql: Sql, relative: string): Promise<void> {
  const migration = readFileSync(resolve(__dirname, relative), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
}

describeIntegration("Sprint 3 PR 3.7 Phase A Final Story Result RLS", () => {
  let sql: Sql;
  let finalStoryResultId: string;
  const orgIds = [IDS_A.orgId, IDS_B.orgId];

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
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (${IDS_A.workspaceId}, ${IDS_B.workspaceId})`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${IDS_A.campaignId}, ${IDS_B.campaignId})`;
    await sql`DELETE FROM assets WHERE id IN (${IDS_A.assetId}, ${IDS_B.assetId})`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id IN (${IDS_A.animationPackageId}, ${IDS_B.animationPackageId})`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${IDS_A.storyVersionId}, ${IDS_B.storyVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${IDS_A.storyId}, ${IDS_B.storyId})`;
    await sql`DELETE FROM campaigns WHERE id IN (${IDS_A.campaignId}, ${IDS_B.campaignId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${IDS_A.workspaceId}, ${IDS_B.workspaceId})`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;
  }

  async function seedTenant(
    ids: typeof IDS_A,
    userId: string,
    slug: string
  ): Promise<void> {
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${slug}, ${slug})`;
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.orgId}, ${ids.workspaceId}, ${userId}, 'operator')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${slug})`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'Story', 'Idea')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${slug}/asset.png`})`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId})`;
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

    expect(await isRlsEnabled(sql, "ai_story_final_story_results")).toBe(true);

    await cleanup();
    await seedTenant(IDS_A, USER_A, "pr37-rls-a");
    await seedTenant(IDS_B, USER_B, "pr37-rls-b");

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ ids: IDS_A, instructionPurpose: "pr37-rls" })
    );
    const executionPlanId = persisted.plan.storyExecutionId;
    const orderedSceneExecutionIds = persisted.plan.sceneExecutions.map(
      (scene) => scene.sceneExecutionId
    );
    const fingerprint = buildAssemblyDefinitionFingerprint({
      executionPlanId,
      orderedSceneExecutionIds,
    });
    const definitionId = deterministicPersistenceUuid(
      "story-assembly-definition",
      fingerprint
    );
    const definition = {
      assemblyDefinitionId: definitionId,
      executionPlanId,
      orgId: IDS_A.orgId,
      workspaceId: IDS_A.workspaceId,
      campaignId: IDS_A.campaignId,
      storyId: IDS_A.storyId,
      storyVersionId: IDS_A.storyVersionId,
      animationPackageId: IDS_A.animationPackageId,
      sceneCount: orderedSceneExecutionIds.length,
      orderedSceneExecutionIds,
      createdBy: USER_A,
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
        ${definitionId}, ${IDS_A.orgId}, ${IDS_A.workspaceId}, ${IDS_A.campaignId},
        ${IDS_A.storyId}, ${IDS_A.storyVersionId}, ${IDS_A.animationPackageId},
        ${executionPlanId}, ${orderedSceneExecutionIds.length}, ${USER_A}, ${definition.createdAt},
        ${"1"}, ${fingerprint}, ${sql.json(definition)}, NOW()
      )
    `;

    const engineHash = buildAssemblyEngineSnapshotContentHash({
      engineName: "ember-story-assembly",
      engineContractVersion: "1",
      engineImplementationVersion: "1.0.0-rls",
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
      executionPlanId,
      assemblyDefinitionId: definitionId,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotHash: engineHash,
    });
    const job = AssemblyJobSchema.parse({
      assemblyJobId: identity.assemblyJobId,
      executionPlanId,
      assemblyDefinitionId: definitionId,
      runtimeAuthorizationId: AUTH_ID,
      ownership: {
        orgId: IDS_A.orgId,
        workspaceId: IDS_A.workspaceId,
        campaignId: IDS_A.campaignId,
        storyId: IDS_A.storyId,
        storyVersionId: IDS_A.storyVersionId,
        animationPackageId: IDS_A.animationPackageId,
        executionPlanId,
      },
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      assemblyContractVersion: "1",
      assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(engineHash),
      assemblyEngineSnapshotHash: engineHash,
      deterministicFingerprint: identity.deterministicFingerprint,
      acceptedAt: "2026-08-08T05:00:00.000Z",
    });
    await new AssemblyJobRepositoryImpl().acceptOrConverge(job);

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
    const artifact = AssemblyArtifactSchema.parse({
      artifactId: buildAssemblyArtifactId(executionIdentity),
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      artifactReference: `${job.ownership.workspaceId}/assembly/${job.assemblyJobId}/out.mp4`,
      contentHash: OUTPUT_HASH,
      mediaType: "video/mp4",
      durationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      byteSize: 8192,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      integrityHash: `sha256:${"44".repeat(32)}`,
      createdAt: job.acceptedAt,
    });
    await new AssemblyArtifactRepositoryImpl().persistOrConverge(
      artifact,
      executionIdentity
    );

    const record = buildFinalStoryResultPersistenceRecord({
      ownership: job.ownership,
      assemblyDefinitionId: job.assemblyDefinitionId,
      assemblyJobId: job.assemblyJobId,
      assemblyJobIdentity: job.deterministicFingerprint,
      assemblyArtifactId: artifact.artifactId,
      orderedSceneResultIds: job.orderedSceneResultIds,
      outputMediaReference: artifact.artifactReference,
      contentHash: artifact.contentHash,
      totalDurationMs: artifact.durationMs,
      width: artifact.width,
      height: artifact.height,
      frameRate: artifact.frameRate,
      assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
      acceptedAt: "2026-08-08T06:00:00.000Z",
      projectedAt: "2026-08-08T06:00:01.000Z",
    });
    const accepted = await new FinalStoryResultRepositoryImpl().acceptOrConverge(
      record
    );
    finalStoryResultId = accepted.result.finalStoryResultId;
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await sql.end();
    await closeDb();
  }, 60_000);

  it("allows own workspace SELECT and denies foreign workspace SELECT", async () => {
    const own = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT final_story_result_id::text AS id
        FROM ai_story_final_story_results
        WHERE final_story_result_id = ${finalStoryResultId}
      `;
      return rows;
    });
    expect(own).toHaveLength(1);

    const foreign = await withAuthenticatedUser(sql, USER_B, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT final_story_result_id::text AS id
        FROM ai_story_final_story_results
        WHERE final_story_result_id = ${finalStoryResultId}
      `;
      return rows;
    });
    expect(foreign).toHaveLength(0);
  });

  it("denies authenticated INSERT / UPDATE / DELETE", async () => {
    try {
      await withAuthenticatedUser(sql, USER_A, (tx) =>
        tx`
          INSERT INTO ai_story_final_story_results (
            final_story_result_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            assembly_definition_id, assembly_job_id, assembly_artifact_id,
            assembly_job_identity, ordered_scene_result_ids, output_media_reference,
            content_hash, media_type, total_duration_ms, width, height, frame_rate,
            assembly_runtime_contract_version, assembly_engine_version,
            normalization_policy_version, final_story_result_contract_version,
            assembly_engine_snapshot_hash, accepted_at, projected_at,
            projection_version, integrity_hash, result
          ) SELECT
            '37100000-0000-4000-8000-000000000099', org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            assembly_definition_id, assembly_job_id, assembly_artifact_id,
            assembly_job_identity || '-x', ordered_scene_result_ids, output_media_reference,
            content_hash, media_type, total_duration_ms, width, height, frame_rate,
            assembly_runtime_contract_version, assembly_engine_version,
            normalization_policy_version, final_story_result_contract_version,
            assembly_engine_snapshot_hash, accepted_at, projected_at,
            projection_version, integrity_hash || '-x', result
          FROM ai_story_final_story_results
          WHERE final_story_result_id = ${finalStoryResultId}
        `
      );
      expect.fail("expected INSERT denied");
    } catch (error) {
      expect(isRlsViolation(error)).toBe(true);
    }

    // No UPDATE/DELETE policies ⇒ 0 rows affected (deny-by-default), not always an error.
    const updated = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      const result = await tx`
        UPDATE ai_story_final_story_results
        SET content_hash = 'tampered'
        WHERE final_story_result_id = ${finalStoryResultId}
      `;
      return result.count;
    });
    expect(updated).toBe(0);

    const deleted = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      const result = await tx`
        DELETE FROM ai_story_final_story_results
        WHERE final_story_result_id = ${finalStoryResultId}
      `;
      return result.count;
    });
    expect(deleted).toBe(0);

    const stillThere = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ai_story_final_story_results
      WHERE final_story_result_id = ${finalStoryResultId}
    `;
    expect(stillThere[0]?.count).toBe("1");
  });
});
