import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb, convergeAiStoryStatusFromRuntimeAuthority, getDb } from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration.sequential("AI Story status convergence PostgreSQL authority", () => {
  let sql: Sql;
  const ids = {
    org: crypto.randomUUID(),
    workspace: crypto.randomUUID(),
    otherWorkspace: crypto.randomUUID(),
    campaign: crypto.randomUUID(),
    otherCampaign: crypto.randomUUID(),
    story: crypto.randomUUID(),
    otherStory: crypto.randomUUID(),
    archived: crypto.randomUUID(),
    executing: crypto.randomUUID(),
    review: crypto.randomUUID(),
    version: crypto.randomUUID(),
    executingVersion: crypto.randomUUID(),
    reviewVersion: crypto.randomUUID(),
    archivedCampaign: crypto.randomUUID(),
    executingCampaign: crypto.randomUUID(),
    reviewCampaign: crypto.randomUUID(),
    package: crypto.randomUUID(),
    plan: crypto.randomUUID(),
    snapshot: crypto.randomUUID(),
    scene1: crypto.randomUUID(),
    scene2: crypto.randomUUID(),
    scene3: crypto.randomUUID(),
    reviewPackage: crypto.randomUUID(),
    reviewPlan: crypto.randomUUID(),
    reviewSnapshot: crypto.randomUUID(),
    reviewScene1: crypto.randomUUID(),
    reviewScene2: crypto.randomUUID(),
    reviewScene3: crypto.randomUUID(),
    sceneResult: crypto.randomUUID(),
    workerResult: crypto.randomUUID(),
    projection: crypto.randomUUID(),
  };
  const draft = {
    title: "Status convergence",
    summary: "S",
    objective: "O",
    targetAudience: "A",
    tone: "T",
    estimatedDuration: "15s",
    story: { opening: "a", development: "b", ending: "c" },
    keyMessages: [],
    cta: "Go",
    assetReferences: [],
    warnings: [],
  };

  async function count(table: string): Promise<number> {
    const rows = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`);
    return Number(rows[0]?.n ?? 0);
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.org}, 'Status Convergence', ${`status-conv-${ids.org.slice(0, 8)}`})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspace}, ${ids.org}, 'Status Convergence', ${`status-conv-${ids.workspace.slice(0, 8)}`})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.otherWorkspace}, ${ids.org}, 'Other Workspace', ${`status-conv-${ids.otherWorkspace.slice(0, 8)}`})`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaign}, ${ids.org}, ${ids.workspace}, 'Planning Only')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.otherCampaign}, ${ids.org}, ${ids.otherWorkspace}, 'Other')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.archivedCampaign}, ${ids.org}, ${ids.workspace}, 'Archived')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.executingCampaign}, ${ids.org}, ${ids.workspace}, 'Executing')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.reviewCampaign}, ${ids.org}, ${ids.workspace}, 'Review')`;
    await sql`
      INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea, status)
      VALUES
        (${ids.story}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, 'Planning', 'No runtime', 'planning_review'),
        (${ids.otherStory}, ${ids.org}, ${ids.otherWorkspace}, ${ids.otherCampaign}, 'Other', 'Isolation', 'planning_review'),
        (${ids.archived}, ${ids.org}, ${ids.workspace}, ${ids.archivedCampaign}, 'Archived', 'Frozen', 'archived'),
        (${ids.executing}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, 'Executing', 'Started', 'planning_review'),
        (${ids.review}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, 'Review', 'Pending', 'planning_review')
    `;
    await sql`UPDATE ai_stories SET archived_at = now() WHERE id = ${ids.archived}`;
    await sql`
      INSERT INTO ai_story_versions (id, story_id, version_number, structured_content)
      VALUES
        (${ids.version}, ${ids.story}, 1, ${sql.json(draft as never)}),
        (${ids.executingVersion}, ${ids.executing}, 1, ${sql.json(draft as never)}),
        (${ids.reviewVersion}, ${ids.review}, 1, ${sql.json(draft as never)})
    `;
  });

  afterAll(async () => {
    await closeDb();
    if (sql) await sql.end();
  });

  it("leaves planning_review unchanged without runtime evidence and does not touch Provider or commercial rows", async () => {
    const providerBefore = await count("provider_attempts");
    const commercialBefore = await count("certification_commercial_reservations");
    const db = getDb();
    const result = await convergeAiStoryStatusFromRuntimeAuthority(db, {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.story,
    });
    expect(result.to).toBe("planning_review");
    expect(result.changed).toBe(false);
    const [row] = await sql<{ status: string }[]>`SELECT status FROM ai_stories WHERE id = ${ids.story}`;
    expect(row?.status).toBe("planning_review");
    expect(await count("provider_attempts")).toBe(providerBefore);
    expect(await count("certification_commercial_reservations")).toBe(commercialBefore);
  });

  it("never reopens an archived Story", async () => {
    const result = await convergeAiStoryStatusFromRuntimeAuthority(getDb(), {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.archived,
    });
    expect(result.to).toBe("archived");
    expect(result.changed).toBe(false);
  });

  it("projects planning_review to executing when a Scene has entered runtime without a Scene Result", async () => {
    const instructionHash = `sha256:${"a".repeat(64)}`;
    await sql`
      INSERT INTO ai_story_scene_instruction_snapshots (
        content_hash, snapshot_id, org_id, workspace_id, contract_version, instructions
      ) VALUES (
        ${instructionHash}, ${ids.snapshot}, ${ids.org}, ${ids.workspace}, '1', ${sql.json({ scene: "1" } as never)}
      )
    `;
    await sql`
      INSERT INTO ai_story_animation_packages (
        id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload
      ) VALUES (
        ${ids.package}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, ${ids.executing}, ${ids.executingVersion},
        'ready_for_execution', ${sql.json({ scenePlan: [] } as never)}
      )
    `;
    await sql`
      INSERT INTO ai_story_execution_plans (
        id, org_id, workspace_id, campaign_id, story_id, story_version_id, animation_package_id,
        status, contract_version, compilation_hash, deterministic_fingerprint, plan, compiled_at
      ) VALUES (
        ${ids.plan}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, ${ids.executing}, ${ids.executingVersion},
        ${ids.package}, 'EXECUTING', '1', ${`hash-${ids.plan}`}, ${`fp-${ids.plan}`}, ${sql.json({ scenes: [] } as never)}, now()
      )
    `;
    const intent = { sceneId: "scene-1", sceneOrder: 0 };
    await sql`
      INSERT INTO ai_story_scene_executions (
        id, execution_plan_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
        animation_package_id, scene_id, scene_order, status, idempotency_key, deterministic_fingerprint,
        compilation_hash, instruction_hash, intent
      ) VALUES
        (${ids.scene1}, ${ids.plan}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, ${ids.executing}, ${ids.executingVersion}, ${ids.package}, 'scene-1', 0, 'QUEUED', ${`idem-${ids.scene1}`}, ${`fp-${ids.scene1}`}, ${`hash-${ids.plan}`}, ${instructionHash}, ${sql.json(intent as never)}),
        (${ids.scene2}, ${ids.plan}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, ${ids.executing}, ${ids.executingVersion}, ${ids.package}, 'scene-2', 1, 'PLANNED', ${`idem-${ids.scene2}`}, ${`fp-${ids.scene2}`}, ${`hash-${ids.plan}`}, ${instructionHash}, ${sql.json(intent as never)}),
        (${ids.scene3}, ${ids.plan}, ${ids.org}, ${ids.workspace}, ${ids.executingCampaign}, ${ids.executing}, ${ids.executingVersion}, ${ids.package}, 'scene-3', 2, 'PLANNED', ${`idem-${ids.scene3}`}, ${`fp-${ids.scene3}`}, ${`hash-${ids.plan}`}, ${instructionHash}, ${sql.json(intent as never)})
    `;
    const first = await convergeAiStoryStatusFromRuntimeAuthority(getDb(), {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.executing,
    });
    expect(first.to).toBe("executing");
    expect(first.changed).toBe(true);
    const replay = await convergeAiStoryStatusFromRuntimeAuthority(getDb(), {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.executing,
    });
    expect(replay.to).toBe("executing");
    expect(replay.changed).toBe(false);
    const [isolated] = await sql<{ status: string }[]>`SELECT status FROM ai_stories WHERE id = ${ids.otherStory}`;
    expect(isolated?.status).toBe("planning_review");
  });

  it("projects planning_review to execution_review from current Scene Result + PENDING_REVIEW while later Scenes stay held", async () => {
    const instructionHash = `sha256:${"b".repeat(64)}`;
    await sql`
      INSERT INTO ai_story_scene_instruction_snapshots (
        content_hash, snapshot_id, org_id, workspace_id, contract_version, instructions
      ) VALUES (
        ${instructionHash}, ${ids.reviewSnapshot}, ${ids.org}, ${ids.workspace}, '1', ${sql.json({ scene: "review" } as never)}
      )
    `;
    await sql`
      INSERT INTO ai_story_animation_packages (
        id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload
      ) VALUES (
        ${ids.reviewPackage}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewVersion},
        'ready_for_execution', ${sql.json({ scenePlan: [] } as never)}
      )
    `;
    await sql`
      INSERT INTO ai_story_execution_plans (
        id, org_id, workspace_id, campaign_id, story_id, story_version_id, animation_package_id,
        status, contract_version, compilation_hash, deterministic_fingerprint, plan, compiled_at
      ) VALUES (
        ${ids.reviewPlan}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewVersion},
        ${ids.reviewPackage}, 'EXECUTING', '1', ${`hash-${ids.reviewPlan}`}, ${`fp-${ids.reviewPlan}`}, ${sql.json({ scenes: [] } as never)}, now()
      )
    `;
    const intent = { sceneId: "scene-1", sceneOrder: 0 };
    await sql`
      INSERT INTO ai_story_scene_executions (
        id, execution_plan_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
        animation_package_id, scene_id, scene_order, status, idempotency_key, deterministic_fingerprint,
        compilation_hash, instruction_hash, intent
      ) VALUES
        (${ids.reviewScene1}, ${ids.reviewPlan}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewVersion}, ${ids.reviewPackage}, 'scene-1', 0, 'SUCCEEDED', ${`idem-${ids.reviewScene1}`}, ${`fp-${ids.reviewScene1}`}, ${`hash-${ids.reviewPlan}`}, ${instructionHash}, ${sql.json(intent as never)}),
        (${ids.reviewScene2}, ${ids.reviewPlan}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewVersion}, ${ids.reviewPackage}, 'scene-2', 1, 'PLANNED', ${`idem-${ids.reviewScene2}`}, ${`fp-${ids.reviewScene2}`}, ${`hash-${ids.reviewPlan}`}, ${instructionHash}, ${sql.json(intent as never)}),
        (${ids.reviewScene3}, ${ids.reviewPlan}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewVersion}, ${ids.reviewPackage}, 'scene-3', 2, 'PLANNED', ${`idem-${ids.reviewScene3}`}, ${`fp-${ids.reviewScene3}`}, ${`hash-${ids.reviewPlan}`}, ${instructionHash}, ${sql.json(intent as never)})
    `;
    await sql.unsafe("SET session_replication_role = replica");
    try {
      const projectedAt = new Date().toISOString();
      await sql`
        INSERT INTO ai_story_scene_results (
          scene_result_id, org_id, workspace_id, execution_plan_id, scene_runtime_id, scene_execution_id,
          worker_execution_result_id, projection_correlation_id, provider_execution_id, provider_attempt_id,
          provider_finalization_reference, scene_id, scene_order, status, integrity_hash, contract_version,
          result, accepted_at, projected_at
        ) VALUES (
          ${ids.sceneResult}, ${ids.org}, ${ids.workspace}, ${ids.reviewPlan}, ${crypto.randomUUID()}, ${ids.reviewScene1},
          ${ids.workerResult}, ${ids.projection}, 'exec-1', 'attempt-pending',
          'finalization-1', 'scene-1', 0, 'SUCCEEDED', ${`integrity-${ids.sceneResult}`}, '1',
          ${sql.json({ sceneResultId: ids.sceneResult, status: "SUCCEEDED" } as never)}, ${projectedAt}, ${projectedAt}
        )
      `;
      const reviewId = crypto.randomUUID();
      const fact = {
        generatedSceneReviewId: reviewId,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.reviewCampaign,
        storyId: ids.review,
        executionPlanId: ids.reviewPlan,
        sceneExecutionId: ids.reviewScene1,
        sceneId: "scene-1",
        providerAttemptId: "attempt-pending",
        sceneResultId: ids.sceneResult,
        decision: "PENDING_REVIEW",
        decidedBy: null,
        decidedAt: null,
        rationale: null,
        contractVersion: "1",
      };
      await sql`
        INSERT INTO ai_story_generated_scene_reviews (
          generated_scene_review_id, org_id, workspace_id, campaign_id, story_id, execution_plan_id,
          scene_execution_id, scene_id, provider_attempt_id, scene_result_id, decision, contract_version, fact
        ) VALUES (
          ${reviewId}, ${ids.org}, ${ids.workspace}, ${ids.reviewCampaign}, ${ids.review}, ${ids.reviewPlan},
          ${ids.reviewScene1}, 'scene-1', 'attempt-pending', ${ids.sceneResult}, 'PENDING_REVIEW', '1', ${sql.json(fact as never)}
        )
      `;
      await sql`
        INSERT INTO ai_story_scene_release_states (
          scene_execution_id, execution_plan_id, runtime_authorization_id, workspace_id, scene_order, release_state
        ) VALUES
          (${ids.reviewScene1}, ${ids.reviewPlan}, ${crypto.randomUUID()}, ${ids.workspace}, 1, 'RELEASED'),
          (${ids.reviewScene2}, ${ids.reviewPlan}, ${crypto.randomUUID()}, ${ids.workspace}, 2, 'AUTHORIZED_NOT_RELEASED'),
          (${ids.reviewScene3}, ${ids.reviewPlan}, ${crypto.randomUUID()}, ${ids.workspace}, 3, 'AUTHORIZED_NOT_RELEASED')
      `;
    } finally {
      await sql.unsafe("SET session_replication_role = origin");
    }

    const providerBefore = await count("provider_attempts");
    const first = await convergeAiStoryStatusFromRuntimeAuthority(getDb(), {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.review,
    });
    expect(first.to).toBe("execution_review");
    expect(first.changed).toBe(true);
    const replay = await convergeAiStoryStatusFromRuntimeAuthority(getDb(), {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.review,
    });
    expect(replay.to).toBe("execution_review");
    expect(replay.changed).toBe(false);
    const [row] = await sql<{ status: string }[]>`SELECT status FROM ai_stories WHERE id = ${ids.review}`;
    expect(row?.status).toBe("execution_review");
    const held = await sql<{ release_state: string; scene_order: number }[]>`
      SELECT release_state, scene_order FROM ai_story_scene_release_states
      WHERE execution_plan_id = ${ids.reviewPlan} ORDER BY scene_order
    `;
    expect(held.map((row) => row.release_state)).toEqual([
      "RELEASED",
      "AUTHORIZED_NOT_RELEASED",
      "AUTHORIZED_NOT_RELEASED",
    ]);
    expect(await count("provider_attempts")).toBe(providerBefore);
  });
});
