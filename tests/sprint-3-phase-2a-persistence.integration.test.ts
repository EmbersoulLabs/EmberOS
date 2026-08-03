import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanIdentityConflictError,
  ExecutionPlanOwnershipError,
  closeDb,
  executionPlanDeterministicFingerprint,
  type PersistSceneExecutionCompilationInput,
} from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  makePhase2aCompilation,
  PHASE_2A_IDS,
  PHASE_2A_WORKSPACE_B_IDS,
} from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

function replaceIds(
  input: PersistSceneExecutionCompilationInput,
  replacements: Readonly<Record<string, string>>
): PersistSceneExecutionCompilationInput {
  let json = JSON.stringify(input);
  for (const [from, to] of Object.entries(replacements)) json = json.replaceAll(from, to);
  return JSON.parse(json) as PersistSceneExecutionCompilationInput;
}

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

describeIntegration("Sprint 3 Phase 2A persistence foundation", () => {
  let sql: Sql;
  const secondVersionId = "10000000-0000-4000-8000-000000000015";
  const secondPackageId = "10000000-0000-4000-8000-000000000016";
  const sameVersionAltPackageId = "10000000-0000-4000-8000-000000000017";

  beforeAll(async () => {
    sql = createIntegrationSql();
    const migration = readFileSync(
      resolve(__dirname, "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql"),
      "utf8"
    );
    for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
      await sql.unsafe(statement);
    }

    const orgIds = [PHASE_2A_IDS.orgId, PHASE_2A_WORKSPACE_B_IDS.orgId];
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM assets WHERE id IN (${PHASE_2A_IDS.assetId}, ${PHASE_2A_WORKSPACE_B_IDS.assetId})`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id IN (${PHASE_2A_IDS.animationPackageId}, ${secondPackageId}, ${sameVersionAltPackageId}, ${PHASE_2A_WORKSPACE_B_IDS.animationPackageId})`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${PHASE_2A_IDS.storyVersionId}, ${secondVersionId}, ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${PHASE_2A_IDS.storyId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId})`;
    await sql`DELETE FROM campaigns WHERE id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId})`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;

    await sql`INSERT INTO organizations (id, name, slug) VALUES (${PHASE_2A_IDS.orgId}, 'Phase 2A', 'phase-2a-persistence'), (${PHASE_2A_WORKSPACE_B_IDS.orgId}, 'Phase 2A B', 'phase-2a-persistence-b')`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.orgId}, 'Phase 2A', 'phase-2a'), (${PHASE_2A_WORKSPACE_B_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.orgId}, 'Phase 2A B', 'phase-2a-b')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, 'Phase 2A'), (${PHASE_2A_WORKSPACE_B_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.orgId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}, 'Phase 2A B')`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'Story', 'Idea'), (${PHASE_2A_WORKSPACE_B_IDS.storyId}, ${PHASE_2A_WORKSPACE_B_IDS.orgId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId}, 'Story B', 'Idea B')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.storyId}, 1, ${sql.json({})}, NOW()), (${secondVersionId}, ${PHASE_2A_IDS.storyId}, 2, ${sql.json({})}, NOW()), (${PHASE_2A_WORKSPACE_B_IDS.storyVersionId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES
      (${PHASE_2A_IDS.animationPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}),
      (${secondPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${secondVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}),
      (${sameVersionAltPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}),
      (${PHASE_2A_WORKSPACE_B_IDS.animationPackageId}, ${PHASE_2A_WORKSPACE_B_IDS.orgId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId}, ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${PHASE_2A_IDS.assetId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'image', 'phase-2a/asset.png'), (${PHASE_2A_WORKSPACE_B_IDS.assetId}, ${PHASE_2A_WORKSPACE_B_IDS.orgId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId}, 'image', 'phase-2a-b/asset.png')`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.assetId}), (${PHASE_2A_WORKSPACE_B_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.assetId})`;
  });

  afterAll(async () => {
    const orgIds = [PHASE_2A_IDS.orgId, PHASE_2A_WORKSPACE_B_IDS.orgId];
    const snapshotHashes = [
      ...makePhase2aCompilation().intents,
      ...makePhase2aCompilation({ ids: PHASE_2A_WORKSPACE_B_IDS }).intents,
      ...makePhase2aCompilation({ animationPackageId: sameVersionAltPackageId }).intents,
    ].map((intent) => intent.normalizedPayloadReference.contentHash);
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE content_hash = ANY(${snapshotHashes}) AND content_hash NOT IN (SELECT instruction_hash FROM ai_story_scene_executions)`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM assets WHERE id IN (${PHASE_2A_IDS.assetId}, ${PHASE_2A_WORKSPACE_B_IDS.assetId})`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id IN (${PHASE_2A_IDS.animationPackageId}, ${secondPackageId}, ${sameVersionAltPackageId}, ${PHASE_2A_WORKSPACE_B_IDS.animationPackageId})`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${PHASE_2A_IDS.storyVersionId}, ${secondVersionId}, ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${PHASE_2A_IDS.storyId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId})`;
    await sql`DELETE FROM campaigns WHERE id IN (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.campaignId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId})`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;
    await sql.end();
    await closeDb();
  });

  it("persists atomically and idempotently with immutable snapshot/QC lookup", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const input = makePhase2aCompilation();
    const legacyJobsBefore = await sql`SELECT count(*)::int AS count FROM ai_story_execution_jobs`;
    const legacyOutputsBefore = await sql`SELECT count(*)::int AS count FROM ai_story_execution_outputs`;
    const first = await repository.persistCompilation(input);
    const repeated = await repository.persistCompilation(input);
    expect(repeated.plan.storyExecutionId).toBe(first.plan.storyExecutionId);
    expect(repeated.acceptedAt).toBe(first.acceptedAt);
    expect(await repository.getByExecutionPlanId(first.plan.storyExecutionId)).toMatchObject({
      plan: { storyExecutionId: first.plan.storyExecutionId },
    });
    expect(
      await repository.getByDeterministicFingerprint(
        executionPlanDeterministicFingerprint(input.plan)
      )
    ).toMatchObject({ plan: { storyExecutionId: first.plan.storyExecutionId } });
    expect(await repository.getInstructionSnapshot(input.intents[0]!.normalizedPayloadReference.contentHash)).toEqual(input.instructionsBySceneExecutionId[input.intents[0]!.identity.sceneExecutionId]);
    expect(await repository.getValidationResults(input.intents[0]!.identity.sceneExecutionId)).toEqual([input.validationResults[0]]);
    const legacyJobsAfter = await sql`SELECT count(*)::int AS count FROM ai_story_execution_jobs`;
    const legacyOutputsAfter = await sql`SELECT count(*)::int AS count FROM ai_story_execution_outputs`;
    expect(legacyJobsAfter[0]?.count).toBe(legacyJobsBefore[0]?.count);
    expect(legacyOutputsAfter[0]?.count).toBe(legacyOutputsBefore[0]?.count);
  });

  it("parallel deterministic persistence converges to one Execution Plan", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const input = makePhase2aCompilation({
      animationPackageId: sameVersionAltPackageId,
      instructionPurpose: "parallel-persist",
    });
    const fingerprint = executionPlanDeterministicFingerprint(input.plan);
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE execution_plan_id IN (SELECT id FROM ai_story_execution_plans WHERE deterministic_fingerprint = ${fingerprint})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE execution_plan_id IN (SELECT id FROM ai_story_execution_plans WHERE deterministic_fingerprint = ${fingerprint})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE deterministic_fingerprint = ${fingerprint}`;

    const [first, second] = await Promise.all([
      repository.persistCompilation(input),
      repository.persistCompilation(input),
    ]);
    expect(first.plan.storyExecutionId).toBe(second.plan.storyExecutionId);
    expect(first.acceptedAt).toBe(second.acceptedAt);
    const planRows =
      await sql`SELECT count(*)::int AS count FROM ai_story_execution_plans WHERE deterministic_fingerprint = ${fingerprint}`;
    const sceneRows =
      await sql`SELECT count(*)::int AS count FROM ai_story_scene_executions WHERE execution_plan_id = ${first.plan.storyExecutionId}`;
    expect(planRows[0]?.count).toBe(1);
    expect(sceneRows[0]?.count).toBe(input.intents.length);
  });

  it("isolates independent Execution Plans across workspaces", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const workspaceA = makePhase2aCompilation({
      ids: PHASE_2A_IDS,
      instructionPurpose: "workspace-isolation",
    });
    const workspaceB = makePhase2aCompilation({
      ids: PHASE_2A_WORKSPACE_B_IDS,
      instructionPurpose: "workspace-isolation",
    });
    expect(executionPlanDeterministicFingerprint(workspaceA.plan)).not.toBe(
      executionPlanDeterministicFingerprint(workspaceB.plan)
    );
    const persistedA = await repository.persistCompilation(workspaceA);
    const persistedB = await repository.persistCompilation(workspaceB);
    expect(persistedA.plan.storyExecutionId).not.toBe(persistedB.plan.storyExecutionId);
    expect(
      (await repository.listByStoryVersionId(PHASE_2A_IDS.storyVersionId, PHASE_2A_IDS.workspaceId))
        .map((row) => row.plan.storyExecutionId)
    ).toContain(persistedA.plan.storyExecutionId);
    expect(
      (
        await repository.listByStoryVersionId(
          PHASE_2A_WORKSPACE_B_IDS.storyVersionId,
          PHASE_2A_WORKSPACE_B_IDS.workspaceId
        )
      ).map((row) => row.plan.storyExecutionId)
    ).toContain(persistedB.plan.storyExecutionId);
  });

  it("allows multiple deterministic plans for the same Story Version", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const first = makePhase2aCompilation();
    const alternate = makePhase2aCompilation({
      animationPackageId: sameVersionAltPackageId,
      instructionPurpose: "alternate-package-compile",
    });
    await repository.persistCompilation(first);
    const second = await repository.persistCompilation(alternate);
    expect(second.plan.storyExecutionId).not.toBe(first.plan.storyExecutionId);
    const plans = await repository.listByStoryVersionId(
      PHASE_2A_IDS.storyVersionId,
      PHASE_2A_IDS.workspaceId
    );
    expect(plans.map((row) => row.plan.storyExecutionId)).toEqual(
      expect.arrayContaining([first.plan.storyExecutionId, second.plan.storyExecutionId])
    );
  });

  it.each([
    ["organization", PHASE_2A_IDS.orgId],
    ["workspace", PHASE_2A_IDS.workspaceId],
    ["campaign", PHASE_2A_IDS.campaignId],
    ["story", PHASE_2A_IDS.storyId],
    ["story version", PHASE_2A_IDS.storyVersionId],
    ["animation package", PHASE_2A_IDS.animationPackageId],
  ])("fails closed for invalid %s ownership", async (_label, currentId) => {
    const invalidId = crypto.randomUUID();
    const input = replaceIds(makePhase2aCompilation(), { [currentId]: invalidId });
    await expect(new AiStorySceneExecutionPersistenceRepository().persistCompilation(input)).rejects.toBeInstanceOf(ExecutionPlanOwnershipError);
  });

  it("fails closed for unauthorized Campaign Assets", async () => {
    const input = replaceIds(makePhase2aCompilation(), { [PHASE_2A_IDS.assetId]: crypto.randomUUID() });
    await expect(new AiStorySceneExecutionPersistenceRepository().persistCompilation(input)).rejects.toBeInstanceOf(ExecutionPlanOwnershipError);
  });

  it("fails closed when a Scene is not owned by the Animation Package", async () => {
    const input = makePhase2aCompilation();
    const foreign = structuredClone(input) as PersistSceneExecutionCompilationInput;
    (foreign.intents[0]!.identity as { sceneId: string }).sceneId = "scene-foreign";
    (foreign.plan.sceneExecutions[0] as { sceneId: string }).sceneId = "scene-foreign";
    (foreign.validationResults[0] as { sceneId: string }).sceneId = "scene-foreign";
    await expect(
      new AiStorySceneExecutionPersistenceRepository().persistCompilation(foreign)
    ).rejects.toBeInstanceOf(ExecutionPlanOwnershipError);
  });

  it("rolls back the plan when a Scene immutable identity conflicts", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const existing = makePhase2aCompilation();
    await repository.persistCompilation(existing);
    const second = replaceIds(makePhase2aCompilation({ animationPackageId: secondPackageId }), {
      [PHASE_2A_IDS.storyVersionId]: secondVersionId,
    });
    const fingerprint = executionPlanDeterministicFingerprint(second.plan);
    (second.intents[0]!.identity as { idempotencyKey: string }).idempotencyKey =
      existing.intents[0]!.identity.idempotencyKey;
    await expect(repository.persistCompilation(second)).rejects.toThrow();
    expect(await repository.getByDeterministicFingerprint(fingerprint)).toBeNull();
  });

  it("returns 409 when an accepted deterministic identity is challenged by a non-equivalent plan", async () => {
    const repository = new AiStorySceneExecutionPersistenceRepository();
    const accepted = makePhase2aCompilation({ instructionPurpose: "identity-conflict-base" });
    await repository.persistCompilation(accepted);
    const conflicting = structuredClone(accepted) as PersistSceneExecutionCompilationInput;
    (conflicting.plan as { compilationHash: string }).compilationHash =
      `${accepted.plan.compilationHash}:mutated`;
    await expect(repository.persistCompilation(conflicting)).rejects.toBeInstanceOf(
      ExecutionPlanIdentityConflictError
    );
  });
});
