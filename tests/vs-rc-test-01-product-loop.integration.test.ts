/**
 * VS-RC-TEST-01 automated product-loop MUST scenarios.
 * Throws ENVIRONMENT_BLOCKED instead of skip() when required env is absent.
 * AUTH-01 entitlement cutover is intentionally excluded from this bounded assembly.
 */
import { afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { closeDb, requireWorkspaceRole } from "@ceo-agent/db";
import { applyTaskExportFailure, persistTaskExportFailure } from "../packages/agents/src/task-export";
import { AUTO_CLIP } from "@ceo-agent/shared";
import { projectVideoStudioResult } from "../apps/web/src/lib/video-studio-result-state";
import {
  cleanupRlsFixture,
  createIntegrationSql,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

config({ path: resolve(process.cwd(), "apps/worker/.env") });
config({ path: resolve(process.cwd(), ".env.local") });

function requireGateEnv() {
  if (process.env.RUN_DB_INTEGRATION_TESTS !== "1" || !process.env.DATABASE_URL?.trim()) {
    throw new Error("ENVIRONMENT_BLOCKED DATABASE_URL/RUN_DB_INTEGRATION_TESTS");
  }
}

describe("VS-RC-TEST-01 automated product-loop MUST", () => {
  it("persists export failure, isolation, and wrong-campaign handling", async () => {
    requireGateEnv();
    const sql = createIntegrationSql();
    let fixture: RlsTestFixture | undefined;
    const taskA = crypto.randomUUID();
    const taskB = crypto.randomUUID();
    const creativeA1 = crypto.randomUUID();
    const creativeA2 = crypto.randomUUID();
    const creativeA3 = crypto.randomUUID();
    const creativeB = crypto.randomUUID();
    const fingerprintA = `sha256:${"a".repeat(64)}`;
    try {
      fixture = await seedRlsFixture(sql);
      const { orgId, workspaceAId, workspaceBId, campaignAId, campaignBId, userAId } = fixture;

      await sql`
        INSERT INTO tasks (
          id, org_id, workspace_id, campaign_id, status,
          generation_input_fingerprint, generation_input_capsule, step_progress
        )
        VALUES
          (
            ${taskA}, ${orgId}, ${workspaceAId}, ${campaignAId}, ${"completed"},
            ${fingerprintA}, ${JSON.stringify({ version: 1, source: "TEST-01" })}::jsonb,
            ${JSON.stringify({
              edit_director_plan: { status: "completed", output: { mode: "AI_DIRECTED" } },
              export_request: {
                status: "running",
                output: { resolution: "720p", status: "exporting", requestedAt: new Date().toISOString() },
              },
            })}::jsonb
          ),
          (
            ${taskB}, ${orgId}, ${workspaceBId}, ${campaignBId}, ${"completed"},
            ${`sha256:${"b".repeat(64)}`}, ${JSON.stringify({ version: 1 })}::jsonb,
            ${JSON.stringify({})}::jsonb
          )
      `;
      await sql`
        INSERT INTO creatives (
          id, org_id, workspace_id, campaign_id, task_id, status, render_status, video_url
        )
        VALUES
          (${creativeA1}, ${orgId}, ${workspaceAId}, ${campaignAId}, ${taskA}, ${"completed"}, ${"preview_ready"}, ${"ws/a/preview-1.mp4"}),
          (${creativeA2}, ${orgId}, ${workspaceAId}, ${campaignAId}, ${taskA}, ${"completed"}, ${"preview_ready"}, ${"ws/a/preview-2.mp4"}),
          (${creativeA3}, ${orgId}, ${workspaceAId}, ${campaignAId}, ${taskA}, ${"failed"}, ${"failed"}, ${null}),
          (${creativeB}, ${orgId}, ${workspaceBId}, ${campaignBId}, ${taskB}, ${"failed"}, ${"failed"}, ${null})
      `;

      await persistTaskExportFailure({
        taskId: taskA,
        error: "Export ZIP missing video files\nffmpeg --secret=abc",
        resolution: "720p",
      });
      const [task] = await sql<{
        generation_input_fingerprint: string | null;
        generation_input_capsule: unknown;
        step_progress: Record<
          string,
          { status?: string; error?: string; output?: { status?: string; error?: string; mode?: string } }
        >;
      }[]>`
        SELECT generation_input_fingerprint, generation_input_capsule, step_progress
        FROM tasks
        WHERE id = ${taskA}
      `;
      const progress = task?.step_progress ?? {};
      expect(task?.generation_input_fingerprint).toBe(fingerprintA);
      const capsule =
        typeof task?.generation_input_capsule === "string"
          ? JSON.parse(task.generation_input_capsule)
          : task?.generation_input_capsule;
      expect(capsule).toEqual({ version: 1, source: "TEST-01" });
      expect(progress.export_request?.status).toBe("failed");
      expect(progress.export_request?.output?.status).toBe("failed");
      expect(progress.export_request?.error).toBe("Export ZIP missing video files");
      expect(progress.edit_director_plan).toEqual({
        status: "completed",
        output: { mode: "AI_DIRECTED" },
      });
      expect(applyTaskExportFailure(progress, { error: "bounded" }).edit_director_plan).toEqual(
        progress.edit_director_plan
      );

      const creatives = await sql<{
        id: string;
        video_url: string | null;
        render_status: string | null;
      }[]>`
        SELECT id, video_url, render_status
        FROM creatives
        WHERE task_id = ${taskA}
      `;
      expect(creatives).toHaveLength(3);
      const partial = projectVideoStudioResult({
        routeCampaignId: campaignAId,
        task: { status: "completed", campaignId: campaignAId },
        creatives: creatives.map((row) => ({
          id: row.id,
          videoUrl: row.video_url,
          renderStatus: row.render_status,
        })),
      });
      expect(partial.slots).toHaveLength(AUTO_CLIP.CLIP_COUNT);
      expect(partial.state).toBe("PARTIAL");
      expect(partial.readyCount).toBe(2);
      expect(partial.failedCount).toBe(1);

      await expect(requireWorkspaceRole(workspaceBId, userAId, "client_viewer")).rejects.toThrow();
      await expect(requireWorkspaceRole(workspaceAId, userAId, "client_viewer")).resolves.toMatchObject({
        orgId,
      });

      const wrong = projectVideoStudioResult({
        routeCampaignId: campaignAId,
        task: { status: "completed", campaignId: campaignBId },
        creatives: [{ id: creativeB, renderStatus: "preview_ready", videoUrl: "storage-key" }],
      });
      expect(wrong.state).toBe("STALE_OR_WRONG_TASK");
      expect(wrong.slots).toHaveLength(AUTO_CLIP.CLIP_COUNT);
    } finally {
      if (fixture) {
        const orgIds = [fixture.orgId, fixture.otherOrgId];
        await sql`DELETE FROM creatives WHERE org_id = ANY(${orgIds}::uuid[])`.catch(() => undefined);
        await sql`DELETE FROM tasks WHERE org_id = ANY(${orgIds}::uuid[])`.catch(() => undefined);
        await cleanupRlsFixture(sql, fixture);
      }
      await sql.end({ timeout: 1 }).catch(() => undefined);
      await closeDb().catch(() => undefined);
    }
  }, 30_000);
});

afterAll(async () => {
  await closeDb().catch(() => undefined);
});
