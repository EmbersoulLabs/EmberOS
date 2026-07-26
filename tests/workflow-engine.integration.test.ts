import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { getDb, closeDb } from "@ceo-agent/db";
import { startOrReuseCampaignRun } from "../apps/web/src/lib/campaign-run";
import { finalizeReviewAfterGates } from "../packages/agents/src/review-finalization";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("PR-2.1 Workflow Engine database guarantees", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
  }, 30_000);

  afterAll(async () => {
    if (sql && fixture) await cleanupRlsFixture(sql, fixture);
    await closeDb();
    if (sql) await sql.end();
  }, 30_000);

  it("serializes concurrent Campaign Run requests and creates one active Task", async () => {
    const db = getDb();
    const [row] = await sql<{
      id: string;
      org_id: string;
      workspace_id: string;
      name: string;
      status: string;
      platforms: string[];
      metadata: Record<string, unknown> | null;
    }[]>`
      SELECT id, org_id, workspace_id, name, status, platforms, metadata
      FROM campaigns
      WHERE id = ${fixture.campaignAId}
    `;
    const campaign = row
      ? {
          id: row.id,
          orgId: row.org_id,
          workspaceId: row.workspace_id,
          name: row.name,
          status: row.status,
          platforms: row.platforms,
          metadata: row.metadata,
        }
      : null;
    expect(campaign).toBeTruthy();
    const enqueue = vi.fn(async () => undefined);

    const [first, second] = await Promise.all([
      startOrReuseCampaignRun(db, campaign as never, { enqueue }),
      startOrReuseCampaignRun(db, campaign as never, { enqueue }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.ok && second.ok && first.taskId).toBe(
      first.ok && second.ok ? second.taskId : ""
    );
    expect([first, second].filter((result) => result.ok && result.reused)).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledOnce();

    const tasks = await sql<{ id: string }[]>`
      SELECT id FROM tasks WHERE campaign_id = ${fixture.campaignAId}
    `;
    expect(tasks).toHaveLength(1);
  });

  it("persists Review-visible state atomically only after gates pass", async () => {
    const [task] = await sql<{ id: string }[]>`
      SELECT id FROM tasks WHERE campaign_id = ${fixture.campaignAId} LIMIT 1
    `;
    const [creative] = await sql<{ id: string }[]>`
      INSERT INTO creatives (
        org_id, workspace_id, campaign_id, task_id, status, render_status, video_url
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${task!.id}, ${"processing"}, ${"preview_ready"},
        ${"https://example.test/preview.mp4"}
      )
      RETURNING id
    `;
    const failedProgress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "completed" as const },
      marketing_score: { status: "failed" as const },
    };
    const input = {
      taskId: task!.id,
      campaignId: fixture.campaignAId,
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      creativeIds: [creative!.id],
      finalOutputReferences: ["https://example.test/preview.mp4"],
      progress: failedProgress,
    };

    await expect(
      finalizeReviewAfterGates(
        [{
          progress: failedProgress,
          creativeRegistered: true,
          outputReady: true,
        }],
        input
      )
    ).rejects.toThrow(/marketing_score/);
    expect(
      await sql<{ id: string }[]>`
        SELECT id FROM reviews WHERE creative_id = ${creative!.id}
      `
    ).toHaveLength(0);

    const completedProgress = {
      ...failedProgress,
      marketing_score: { status: "completed" as const },
      human_review: { status: "pending" as const },
    };
    await finalizeReviewAfterGates(
      [{
        progress: completedProgress,
        creativeRegistered: true,
        outputReady: true,
      }],
      { ...input, progress: completedProgress }
    );

    const [review] = await sql<{ decision: string }[]>`
      SELECT decision FROM reviews WHERE creative_id = ${creative!.id}
    `;
    const [finalTask] = await sql<{ status: string }[]>`
      SELECT status FROM tasks WHERE id = ${task!.id}
    `;
    const [finalCreative] = await sql<{ status: string }[]>`
      SELECT status FROM creatives WHERE id = ${creative!.id}
    `;
    expect(review?.decision).toBe("pending");
    expect(finalTask?.status).toBe("completed");
    expect(finalCreative?.status).toBe("pending_internal_review");
  });

  it("serializes concurrent Finalization and rejects conflicting persisted results", async () => {
    const [task] = await sql<{ id: string }[]>`
      INSERT INTO tasks (org_id, workspace_id, campaign_id, status, step_progress)
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${"running"}, ${sql.json({})}
      )
      RETURNING id
    `;
    const [creative] = await sql<{ id: string }[]>`
      INSERT INTO creatives (
        org_id, workspace_id, campaign_id, task_id, status, render_status, video_url
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${task!.id}, ${"processing"}, ${"preview_ready"},
        ${"https://example.test/atomic-preview.mp4"}
      )
      RETURNING id
    `;
    const progress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "completed" as const },
      marketing_score: { status: "completed" as const },
    };
    const gates = [{
      progress,
      creativeRegistered: true,
      outputReady: true,
    }];
    const input = {
      taskId: task!.id,
      campaignId: fixture.campaignAId,
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      creativeIds: [creative!.id],
      finalOutputReferences: ["https://example.test/atomic-preview.mp4"],
      progress,
    };

    await Promise.all([
      finalizeReviewAfterGates(gates, input),
      finalizeReviewAfterGates(gates, input),
    ]);

    const reviews = await sql<{ id: string }[]>`
      SELECT id FROM reviews WHERE creative_id = ${creative!.id}
    `;
    const [persisted] = await sql<{
      step_progress: Record<string, {
        output?: { deterministicFingerprint?: string };
      }>;
    }[]>`
      SELECT step_progress FROM tasks WHERE id = ${task!.id}
    `;
    const acceptedFingerprint =
      persisted?.step_progress.finalization_pipeline?.output
        ?.deterministicFingerprint;
    expect(reviews).toHaveLength(1);
    expect(acceptedFingerprint).toBeTruthy();

    const [conflictingCreative] = await sql<{ id: string }[]>`
      INSERT INTO creatives (
        org_id, workspace_id, campaign_id, task_id, status, render_status, video_url
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${task!.id}, ${"processing"}, ${"preview_ready"},
        ${"https://example.test/conflicting-preview.mp4"}
      )
      RETURNING id
    `;
    await expect(
      finalizeReviewAfterGates(gates, {
        ...input,
        creativeIds: [conflictingCreative!.id],
        finalOutputReferences: [
          "https://example.test/conflicting-preview.mp4",
        ],
      })
    ).rejects.toThrow("Conflicting Finalization result");

    const [afterConflict] = await sql<{
      step_progress: Record<string, {
        output?: { deterministicFingerprint?: string };
      }>;
    }[]>`
      SELECT step_progress FROM tasks WHERE id = ${task!.id}
    `;
    expect(
      afterConflict?.step_progress.finalization_pipeline?.output
        ?.deterministicFingerprint
    ).toBe(acceptedFingerprint);
    expect(
      await sql<{ id: string }[]>`
        SELECT id FROM reviews WHERE creative_id = ${conflictingCreative!.id}
      `
    ).toHaveLength(0);
  });

  it("rolls back Finalization when output readiness changes before commit", async () => {
    const [task] = await sql<{ id: string }[]>`
      INSERT INTO tasks (org_id, workspace_id, campaign_id, status, step_progress)
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${"running"}, ${sql.json({})}
      )
      RETURNING id
    `;
    const [creative] = await sql<{ id: string }[]>`
      INSERT INTO creatives (
        org_id, workspace_id, campaign_id, task_id, status, render_status
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
        ${task!.id}, ${"processing"}, ${"preview_rendering"}
      )
      RETURNING id
    `;
    const progress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "completed" as const },
      marketing_score: { status: "completed" as const },
    };

    await expect(
      finalizeReviewAfterGates(
        [{ progress, creativeRegistered: true, outputReady: true }],
        {
          taskId: task!.id,
          campaignId: fixture.campaignAId,
          orgId: fixture.orgId,
          workspaceId: fixture.workspaceAId,
          creativeIds: [creative!.id],
          finalOutputReferences: [
            "https://example.test/not-ready-preview.mp4",
          ],
          progress,
        }
      )
    ).rejects.toThrow("Finalization output is not ready");

    const [persisted] = await sql<{
      status: string;
      step_progress: Record<string, unknown>;
    }[]>`
      SELECT status, step_progress FROM tasks WHERE id = ${task!.id}
    `;
    expect(persisted?.status).toBe("running");
    expect(persisted?.step_progress.finalization_pipeline).toBeUndefined();
    expect(
      await sql<{ id: string }[]>`
        SELECT id FROM reviews WHERE creative_id = ${creative!.id}
      `
    ).toHaveLength(0);
  });
});
