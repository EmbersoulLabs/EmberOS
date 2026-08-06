/**
 * Sprint 3 Phase 2B PR 2B.3 — AI Story RLS remediation integration tests.
 * Direct authenticated-role SQL must be rejected by PostgreSQL RLS itself.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  OwnershipIntegrityViolationError,
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
  isRlsEnabled,
  withAuthenticatedUser,
} from "./helpers/db-integration";
import {
  makePhase2aCompilation,
  PHASE_2A_IDS,
  PHASE_2A_WORKSPACE_B_IDS,
} from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const USER_A = "10000000-0000-4000-8000-000000000040";
const USER_B = "20000000-0000-4000-8000-000000000040";

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
    /row-level security|violates row-level security/i.test(message) ||
    code === "42501"
  );
}

async function expectRlsInsertRejected(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    expect.fail("expected PostgreSQL RLS to reject INSERT");
  } catch (error) {
    expect(isRlsViolation(error)).toBe(true);
  }
}

async function seedTenant(
  sql: Sql,
  ids: typeof PHASE_2A_IDS,
  userId: string,
  label: string
) {
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${label}, ${`org-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${label}, ${`ws-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId} AND user_id = ${userId}`;
  await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.orgId}, ${ids.workspaceId}, ${userId}, 'operator')`;
  await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${label}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${label}, 'Idea') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW()) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${label}/asset.png`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId}) ON CONFLICT DO NOTHING`;
}

async function wipeOrg(sql: Sql, orgId: string, workspaceId: string, campaignId: string, ids: typeof PHASE_2A_IDS) {
  await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ${orgId}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
  await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM assets WHERE id = ${ids.assetId}`;
  await sql`DELETE FROM ai_story_animation_packages WHERE id = ${ids.animationPackageId}`;
  await sql`DELETE FROM ai_story_versions WHERE id = ${ids.storyVersionId}`;
  await sql`DELETE FROM ai_stories WHERE id = ${ids.storyId}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
  await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
}

describeIntegration("Sprint 3 Phase 2B PR 2B.3 AI Story RLS and ownership", () => {
  let sql: Sql;
  let planAId = "";
  let planBId = "";
  let sceneAId = "";
  let sceneA2Id = "";
  let sceneBId = "";
  let assemblyAId = "";
  let hashA = "";
  let hashB = "";
  let orphanHash = "";

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/ai-story-canonical-rls-v1.sql",
    ]) {
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

    const rlsOn = await isRlsEnabled(sql, "ai_story_execution_plans");
    if (!rlsOn) {
      throw new Error("RLS is not enabled on ai_story_execution_plans. Apply sql:ai-story-rls.");
    }

    await wipeOrg(sql, PHASE_2A_IDS.orgId, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.campaignId, PHASE_2A_IDS);
    await wipeOrg(
      sql,
      PHASE_2A_WORKSPACE_B_IDS.orgId,
      PHASE_2A_WORKSPACE_B_IDS.workspaceId,
      PHASE_2A_WORKSPACE_B_IDS.campaignId,
      PHASE_2A_WORKSPACE_B_IDS
    );

    await seedTenant(sql, PHASE_2A_IDS, USER_A, "2b3-a");
    await seedTenant(sql, PHASE_2A_WORKSPACE_B_IDS, USER_B, "2b3-b");

    const persistedA = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose: "rls-a" })
    );
    planAId = persistedA.plan.storyExecutionId;
    sceneAId = persistedA.intents[0]!.identity.sceneExecutionId;
    sceneA2Id = persistedA.intents[1]!.identity.sceneExecutionId;
    hashA = persistedA.intents[0]!.normalizedPayloadReference.contentHash;

    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planAId, openedBy: USER_A });
    for (const intent of persistedA.intents) {
      await review.appendSceneIntentDecision({
        executionPlanId: planAId,
        sceneExecutionId: intent.identity.sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: USER_A,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: planAId,
      decision: "APPROVED",
      reviewedBy: USER_A,
    });

    const assembly = await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
      executionPlanId: planAId,
      createdBy: USER_A,
      orderedSceneExecutionIds: persistedA.intents.map((i) => i.identity.sceneExecutionId),
    });
    assemblyAId = assembly.definition.assemblyDefinitionId;

    const persistedB = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PHASE_2A_WORKSPACE_B_IDS,
        instructionPurpose: "rls-b",
      })
    );
    planBId = persistedB.plan.storyExecutionId;
    sceneBId = persistedB.intents[0]!.identity.sceneExecutionId;
    hashB = persistedB.intents[0]!.normalizedPayloadReference.contentHash;

    orphanHash = `orphan-${crypto.randomUUID().replace(/-/g, "")}`;
    await sql`
      INSERT INTO ai_story_scene_instruction_snapshots (
        content_hash, snapshot_id, org_id, workspace_id, contract_version, instructions
      ) VALUES (
        ${orphanHash},
        ${crypto.randomUUID()},
        ${PHASE_2A_IDS.orgId},
        ${PHASE_2A_IDS.workspaceId},
        '1',
        ${sql.json({ orphan: true })}
      )
    `;
  }, 180_000);

  afterAll(async () => {
    await wipeOrg(sql, PHASE_2A_IDS.orgId, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.campaignId, PHASE_2A_IDS);
    await wipeOrg(
      sql,
      PHASE_2A_WORKSPACE_B_IDS.orgId,
      PHASE_2A_WORKSPACE_B_IDS.workspaceId,
      PHASE_2A_WORKSPACE_B_IDS.campaignId,
      PHASE_2A_WORKSPACE_B_IDS
    );
    await sql.end();
    await closeDb();
  }, 120_000);

  it("live pg_policies have no tautologies and Snapshot has no INSERT", async () => {
    const policies = await sql<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }[]>`
      SELECT tablename, policyname, cmd, qual::text AS qual, with_check::text AS with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename LIKE 'ai_story_%'
      ORDER BY tablename, policyname
    `;

    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      for (const expr of [policy.qual, policy.with_check]) {
        if (!expr) continue;
        expect(expr).not.toMatch(/\b(\w+)\.(\w+)\s*=\s*\1\.\2\b/);
      }
    }

    const snapshotPolicies = policies.filter(
      (p) => p.tablename === "ai_story_scene_instruction_snapshots"
    );
    expect(snapshotPolicies.some((p) => p.cmd === "SELECT")).toBe(true);
    expect(snapshotPolicies.some((p) => p.cmd === "INSERT")).toBe(false);
    expect(snapshotPolicies.some((p) => p.cmd === "UPDATE" || p.cmd === "DELETE" || p.cmd === "ALL")).toBe(
      false
    );
    expect(policies.some((p) => p.cmd === "UPDATE" || p.cmd === "DELETE" || p.cmd === "ALL")).toBe(
      false
    );
  }, 60_000);

  it("Workspace A cannot SELECT Execution Plan B / Scene B / Assembly B / Review B", async () => {
    const plans = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM ai_story_execution_plans WHERE workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
      `;
    });
    expect(plans).toHaveLength(0);

    const scenes = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM ai_story_scene_executions WHERE workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
      `;
    });
    expect(scenes).toHaveLength(0);

    const assemblies = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ assembly_definition_id: string }[]>`
        SELECT assembly_definition_id FROM ai_story_assembly_definitions
        WHERE workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
      `;
    });
    expect(assemblies).toHaveLength(0);

    const reviews = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ fact_id: string }[]>`
        SELECT fact_id FROM ai_story_review_opened_facts
        WHERE workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
      `;
    });
    expect(reviews).toHaveLength(0);
  }, 60_000);

  it("Workspace A can SELECT own plan / scene / assembly", async () => {
    const plans = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM ai_story_execution_plans WHERE id = ${planAId}
      `;
    });
    expect(plans).toHaveLength(1);

    const scenes = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM ai_story_scene_executions WHERE id = ${sceneAId}
      `;
    });
    expect(scenes).toHaveLength(1);

    const assemblies = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ assembly_definition_id: string }[]>`
        SELECT assembly_definition_id FROM ai_story_assembly_definitions
        WHERE assembly_definition_id = ${assemblyAId}
      `;
    });
    expect(assemblies).toHaveLength(1);
  }, 60_000);

  it("direct authenticated INSERT with wrong Organization fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_WORKSPACE_B_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-org', 90, 'PLANNED',
            ${`idem-org-${crypto.randomUUID()}`}, ${`fp-org-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "org" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Workspace fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_WORKSPACE_B_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-ws', 91, 'PLANNED',
            ${`idem-ws-${crypto.randomUUID()}`}, ${`fp-ws-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "ws" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Campaign fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_WORKSPACE_B_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-campaign', 92, 'PLANNED',
            ${`idem-camp-${crypto.randomUUID()}`}, ${`fp-camp-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "campaign" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Story fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_WORKSPACE_B_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-story', 93, 'PLANNED',
            ${`idem-story-${crypto.randomUUID()}`}, ${`fp-story-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "story" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Story Version fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-version', 94, 'PLANNED',
            ${`idem-ver-${crypto.randomUUID()}`}, ${`fp-ver-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "version" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Animation Package fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planAId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_WORKSPACE_B_IDS.animationPackageId},
            'attack-pkg', 95, 'PLANNED',
            ${`idem-pkg-${crypto.randomUUID()}`}, ${`fp-pkg-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "pkg" })}
          )
        `;
      })
    );
  }, 60_000);

  it("direct authenticated INSERT with wrong Execution Plan fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_executions (
            id, execution_plan_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, scene_id, scene_order, status,
            idempotency_key, deterministic_fingerprint, compilation_hash, instruction_hash, intent
          ) VALUES (
            ${crypto.randomUUID()}, ${planBId},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            'attack-plan', 96, 'PLANNED',
            ${`idem-plan-${crypto.randomUUID()}`}, ${`fp-plan-${crypto.randomUUID()}`},
            'hash', ${hashA}, ${tx.json({ attack: "plan" })}
          )
        `;
      })
    );
  }, 60_000);

  it("cross-plan Scene membership INSERT fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_assembly_scene_memberships (
            membership_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
            animation_package_id, execution_plan_id, assembly_definition_id, scene_execution_id,
            scene_id, scene_order, contract_version, deterministic_fingerprint, membership
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId},
            ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            ${planAId}, ${assemblyAId}, ${sceneBId},
            'cross-plan', 99, '1', ${`fp-mem-${crypto.randomUUID()}`},
            ${tx.json({ attack: "cross-plan" })}
          )
        `;
      })
    );
  }, 60_000);

  it("review fact belonging to another Plan/Scene fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_intent_review_facts (
            fact_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
            animation_package_id, execution_plan_id, scene_execution_id, scene_id, scene_order,
            decision, reviewed_by, reviewed_at, instruction_hash, qc_result_hash,
            contract_version, deterministic_fingerprint, fact
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId},
            ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            ${planAId}, ${sceneBId}, 'x', 0,
            'APPROVED', ${USER_A}, NOW(), ${hashA}, 'qc',
            '1', ${`fp-rev-${crypto.randomUUID()}`},
            ${tx.json({ attack: "review" })}
          )
        `;
      })
    );
  }, 60_000);

  it("assembly definition ownership mismatch fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_assembly_definitions (
            assembly_definition_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
            animation_package_id, execution_plan_id, scene_count, created_by, created_at,
            contract_version, deterministic_fingerprint, definition
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_WORKSPACE_B_IDS.campaignId},
            ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.animationPackageId},
            ${planAId}, 2, ${USER_A}, NOW(),
            '1', ${`fp-asm-${crypto.randomUUID()}`},
            ${tx.json({ attack: "assembly" })}
          )
        `;
      })
    );
  }, 60_000);

  it("known Snapshot hash without authorized Scene relationship returns no row", async () => {
    const rows = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ content_hash: string }[]>`
        SELECT content_hash FROM ai_story_scene_instruction_snapshots
        WHERE content_hash = ${orphanHash}
      `;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("Snapshot referenced by authorized Scene is readable", async () => {
    const rows = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ content_hash: string }[]>`
        SELECT content_hash FROM ai_story_scene_instruction_snapshots
        WHERE content_hash = ${hashA}
      `;
    });
    expect(rows).toHaveLength(1);
  }, 60_000);

  it("Snapshot hash referenced only by foreign Workspace is not readable", async () => {
    const rows = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx<{ content_hash: string }[]>`
        SELECT content_hash FROM ai_story_scene_instruction_snapshots
        WHERE content_hash = ${hashB}
      `;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("authenticated direct Snapshot INSERT fails via RLS", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, USER_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_instruction_snapshots (
            content_hash, snapshot_id, org_id, workspace_id, contract_version, instructions
          ) VALUES (
            ${`client-${crypto.randomUUID().replace(/-/g, "")}`},
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId},
            ${PHASE_2A_IDS.workspaceId},
            '1',
            ${tx.json({ client: true })}
          )
        `;
      })
    );
  }, 60_000);

  it("authenticated Snapshot UPDATE fails (no rows / no policy)", async () => {
    const updated = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx`
        UPDATE ai_story_scene_instruction_snapshots
        SET contract_version = 'hacked'
        WHERE content_hash = ${hashA}
      `;
    });
    expect(updated.count).toBe(0);
  }, 60_000);

  it("authenticated Snapshot DELETE fails (no rows / no policy)", async () => {
    const deleted = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx`
        DELETE FROM ai_story_scene_instruction_snapshots WHERE content_hash = ${hashA}
      `;
    });
    expect(deleted.count).toBe(0);
  }, 60_000);

  it("denies UPDATE and DELETE on immutable AI Story rows under authenticated role", async () => {
    const updated = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx`
        UPDATE ai_story_execution_plans SET contract_version = 'hacked' WHERE id = ${planAId}
      `;
    });
    expect(updated.count).toBe(0);

    const deleted = await withAuthenticatedUser(sql, USER_A, async (tx) => {
      return tx`
        DELETE FROM ai_story_assembly_definitions WHERE assembly_definition_id = ${assemblyAId}
      `;
    });
    expect(deleted.count).toBe(0);
  }, 60_000);

  it("service-role repository valid persistence still passes", async () => {
    const result = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose: `rls-service-${Date.now()}` })
    );
    expect(result.plan.storyExecutionId).toBeTruthy();
    expect(result.intents.length).toBeGreaterThan(0);
    // Clean duplicate plan for this workspace to avoid clutter — wipeOrg handles org cleanup.
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE execution_plan_id = ${result.plan.storyExecutionId}`;
    await sql`DELETE FROM ai_story_scene_executions WHERE execution_plan_id = ${result.plan.storyExecutionId}`;
    await sql`DELETE FROM ai_story_execution_plans WHERE id = ${result.plan.storyExecutionId}`;
  }, 120_000);

  it("ownership drift on Scene vs Plan fails closed with OWNERSHIP_INTEGRITY_VIOLATION", async () => {
    await sql`
      UPDATE ai_story_scene_executions
      SET workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
      WHERE id = ${sceneAId}
    `;

    await expect(
      new ExecutionPlanReviewRepository().getLogicalProjection(planAId)
    ).rejects.toBeInstanceOf(OwnershipIntegrityViolationError);

    await expect(
      new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
        executionPlanId: planAId,
        createdBy: USER_A,
      })
    ).rejects.toMatchObject({ code: "OWNERSHIP_INTEGRITY_VIOLATION", status: 409 });

    await sql`
      UPDATE ai_story_scene_executions
      SET workspace_id = ${PHASE_2A_IDS.workspaceId}
      WHERE id = ${sceneAId}
    `;
  }, 120_000);

  it("execution remains PHASE1_EXECUTION_LOCKED", () => {
    expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
    expect(PHASE1_EXECUTION_LOCKED).toBe("PHASE1_EXECUTION_LOCKED");
  });

  it("unused sceneA2Id is present for assembly integrity", () => {
    expect(sceneA2Id).toBeTruthy();
  });
});
