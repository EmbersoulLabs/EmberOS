/**
 * Sprint 3 Phase 2B PR 2B.2 — Assembly Definition repository integration tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  AssemblyIdentityConflictError,
  AssemblyIntegrityViolationError,
  AssemblyOwnershipError,
  AssemblyValidationError,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  closeDb,
} from "@ceo-agent/db";
import {
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
} from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { makePhase2aCompilation, PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant } from "./helpers/ai-story-pr32-scheduling";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const CREATOR_ID = "10000000-0000-4000-8000-000000000040";
const UNAUTH_CREATOR_ID = "10000000-0000-4000-8000-000000000041";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

describeIntegration("Sprint 3 Phase 2B PR 2B.2 assembly definition persistence", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
    ]) {
      const migration = readFileSync(resolve(__dirname, relative), "utf8");
      for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
        await sql.unsafe(statement);
      }
    }

    await cleanupPr32Tenant(sql);

    await sql`INSERT INTO organizations (id, name, slug) VALUES (${PHASE_2A_IDS.orgId}, 'Phase 2B.2', 'phase-2b2-assembly')`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.orgId}, 'Phase 2B.2', 'phase-2b2')`;
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${CREATOR_ID}, 'operator')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, 'Phase 2B.2')`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'Story', 'Idea')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${PHASE_2A_IDS.animationPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${PHASE_2A_IDS.assetId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'image', 'phase-2b2/asset.png')`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.assetId})`;
  }, 60_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  async function persistPlan(instructionPurpose: string) {
    return new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose })
    );
  }

  async function approveReview(
    planId: string,
    sceneExecutionIds: readonly string[]
  ) {
    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planId, openedBy: CREATOR_ID });
    for (const sceneExecutionId of sceneExecutionIds) {
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: CREATOR_ID,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: planId,
      decision: "APPROVED",
      reviewedBy: CREATOR_ID,
    });
  }

  it(
    "creates Assembly Definition, idempotent replay, derives projection, stays locked",
    async () => {
      const persisted = await persistPlan("assembly-create");
      const planId = persisted.plan.storyExecutionId;
      const sceneIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
      await approveReview(planId, sceneIds);

      const assembly = new ExecutionPlanAssemblyRepository();
      const created = await assembly.createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: CREATOR_ID,
        createdAt: "2026-08-03T16:00:00.000Z",
        orderedSceneExecutionIds: sceneIds,
      });
      expect(created.replayed).toBe(false);
      expect(created.definition.sceneCount).toBe(2);
      expect(created.memberships).toHaveLength(2);
      expect(created.memberships.map((row) => row.sceneExecutionId)).toEqual(sceneIds);

      const replayed = await assembly.createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: CREATOR_ID,
        createdAt: "2026-08-03T17:00:00.000Z",
        orderedSceneExecutionIds: sceneIds,
      });
      expect(replayed.replayed).toBe(true);
      expect(replayed.definition.assemblyDefinitionId).toBe(
        created.definition.assemblyDefinitionId
      );
      expect(replayed.definition.createdAt).toBe(created.definition.createdAt);
      expect(replayed.memberships.map((row) => row.membershipId)).toEqual(
        created.memberships.map((row) => row.membershipId)
      );

      const projection = await assembly.getProjection(planId);
      expect(projection?.prerequisites.hasDefinition).toBe(true);
      expect(projection?.prerequisites.membershipComplete).toBe(true);
      expect(projection?.prerequisites.reviewApproved).toBe(true);
      expect(projection?.prerequisites.orderingDeterministic).toBe(true);
      expect(projection?.sceneCount).toBe(2);
      expect(projection).not.toHaveProperty("readyForExecution");

      const definitionCount =
        await sql`SELECT count(*)::int AS count FROM ai_story_assembly_definitions WHERE execution_plan_id = ${planId}`;
      expect(definitionCount[0]?.count).toBe(1);

      expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
      expect(PHASE1_EXECUTION_LOCKED).toBe("PHASE1_EXECUTION_LOCKED");
    },
    120_000
  );

  it(
    "fails closed on identity conflict when ordering changes",
    async () => {
      const persisted = await persistPlan("assembly-identity-conflict");
      const planId = persisted.plan.storyExecutionId;
      const sceneIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
      await approveReview(planId, sceneIds);
      const assembly = new ExecutionPlanAssemblyRepository();

      await assembly.createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: CREATOR_ID,
        orderedSceneExecutionIds: sceneIds,
      });

      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: CREATOR_ID,
          orderedSceneExecutionIds: [...sceneIds].reverse(),
        })
      ).rejects.toMatchObject({
        code: "ASSEMBLY_IDENTITY_CONFLICT",
        status: 409,
      });
      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: CREATOR_ID,
          orderedSceneExecutionIds: [...sceneIds].reverse(),
        })
      ).rejects.toBeInstanceOf(AssemblyIdentityConflictError);
    },
    120_000
  );

  it(
    "rejects duplicate Scene, foreign Scene, missing Scene, and unauthorized creator",
    async () => {
      const persisted = await persistPlan("assembly-validation");
      const planId = persisted.plan.storyExecutionId;
      const sceneIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
      await approveReview(planId, sceneIds);
      const assembly = new ExecutionPlanAssemblyRepository();

      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: CREATOR_ID,
          orderedSceneExecutionIds: [sceneIds[0]!, sceneIds[0]!],
        })
      ).rejects.toBeInstanceOf(AssemblyValidationError);

      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: CREATOR_ID,
          orderedSceneExecutionIds: [
            sceneIds[0]!,
            "10000000-0000-4000-8000-000000000299",
          ],
        })
      ).rejects.toBeInstanceOf(AssemblyValidationError);

      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: CREATOR_ID,
          orderedSceneExecutionIds: [sceneIds[0]!],
        })
      ).rejects.toBeInstanceOf(AssemblyValidationError);

      await expect(
        assembly.createOrReturnAssembly({
          executionPlanId: planId,
          createdBy: UNAUTH_CREATOR_ID,
          orderedSceneExecutionIds: sceneIds,
        })
      ).rejects.toBeInstanceOf(AssemblyOwnershipError);
    },
    120_000
  );

  it(
    "does not enqueue Queue / Outbox / Provider work when accepting an Assembly Definition",
    async () => {
      const persisted = await persistPlan("assembly-no-runtime");
      const planId = persisted.plan.storyExecutionId;
      const sceneIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
      await approveReview(planId, sceneIds);

      const outboxBefore = await sql`SELECT count(*)::int AS count FROM provider_outbox`.catch(
        () => [{ count: 0 }]
      );
      await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: CREATOR_ID,
        orderedSceneExecutionIds: sceneIds,
      });
      const outboxAfter = await sql`SELECT count(*)::int AS count FROM provider_outbox`.catch(
        () => outboxBefore
      );
      expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
      expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
    },
    120_000
  );

  it(
    "fails closed on JSONB snapshot mismatch vs relational membership authority",
    async () => {
      const persisted = await persistPlan("assembly-integrity");
      const planId = persisted.plan.storyExecutionId;
      const sceneIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
      await approveReview(planId, sceneIds);
      const assembly = new ExecutionPlanAssemblyRepository();
      await assembly.createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: CREATOR_ID,
        orderedSceneExecutionIds: sceneIds,
      });

      const [definitionRow] = await sql`
        SELECT assembly_definition_id, definition
        FROM ai_story_assembly_definitions
        WHERE execution_plan_id = ${planId}
      `;
      const corrupted = {
        ...(definitionRow!.definition as Record<string, unknown>),
        orderedSceneExecutionIds: [...sceneIds].reverse(),
      };
      await sql`
        UPDATE ai_story_assembly_definitions
        SET definition = ${sql.json(corrupted)}
        WHERE assembly_definition_id = ${definitionRow!.assembly_definition_id}
      `;

      await expect(assembly.getProjection(planId)).rejects.toBeInstanceOf(
        AssemblyIntegrityViolationError
      );
      await expect(assembly.getAssemblyDefinition(planId)).rejects.toMatchObject({
        code: "ASSEMBLY_INTEGRITY_VIOLATION",
      });
    },
    120_000
  );
});
