import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { getDb, closeDb } from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  getIntegrationDbUrl,
  createIntegrationSql,
} from "./helpers/db-integration";
import { submitCreativeForReview, findPendingReview } from "../apps/web/src/lib/review-resubmit";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("reject → resubmit review (DB integration)", () => {
  let sql: Sql;
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const creativeId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rejectedReviewId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    sql = createIntegrationSql();

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${"Resubmit Test Org"}, ${`resubmit-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"WS"}, ${`ws-${suffix}`})
    `;
    await sql`
      INSERT INTO campaigns (id, org_id, workspace_id, name, platforms, status)
      VALUES (${campaignId}, ${orgId}, ${workspaceId}, ${"Campaign"}, ${["tiktok"]}, ${"pending_internal_review"})
    `;
    await sql`
      INSERT INTO tasks (id, org_id, workspace_id, campaign_id, status, current_step, step_progress)
      VALUES (
        ${taskId},
        ${orgId},
        ${workspaceId},
        ${campaignId},
        ${"completed"},
        ${"human_review"},
        ${JSON.stringify({
          human_review: { status: "failed", error: "Hook too aggressive" },
        })}::jsonb
      )
    `;
    await sql`
      INSERT INTO creatives (id, org_id, workspace_id, campaign_id, task_id, status)
      VALUES (${creativeId}, ${orgId}, ${workspaceId}, ${campaignId}, ${taskId}, ${"compliance_failed"})
    `;
    await sql`
      INSERT INTO reviews (id, org_id, workspace_id, creative_id, reviewer_type, decision, comment, decided_at)
      VALUES (
        ${rejectedReviewId},
        ${orgId},
        ${workspaceId},
        ${creativeId},
        ${"internal"},
        ${"rejected"},
        ${"Hook too aggressive"},
        NOW()
      )
    `;
  }, 30_000);

  afterAll(async () => {
    await sql`DELETE FROM reviews WHERE org_id = ${orgId}`;
    await sql`DELETE FROM creatives WHERE org_id = ${orgId}`;
    await sql`DELETE FROM tasks WHERE org_id = ${orgId}`;
    await sql`DELETE FROM campaigns WHERE org_id = ${orgId}`;
    await sql`DELETE FROM workspaces WHERE org_id = ${orgId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end();
    await closeDb();
  }, 30_000);

  it("creates a new pending review and syncs campaign status after rejection", async () => {
    const db = getDb();

    const result = await submitCreativeForReview(db, {
      creativeId,
      userId,
      type: "internal",
    });

    expect("error" in result).toBe(false);
    if ("error" in result && result.error) throw new Error(result.error);

    expect(result.creativeStatus).toBe("pending_internal_review");
    expect(result.campaignStatus).toBe("pending_internal_review");
    expect(result.review?.decision).toBe("pending");

    const pending = await findPendingReview(db, creativeId);
    expect(pending?.id).toBe(result.review?.id);

    const [creative] = await sql<{ status: string }[]>`
      SELECT status FROM creatives WHERE id = ${creativeId}
    `;
    expect(creative?.status).toBe("pending_internal_review");

    const [campaign] = await sql<{ status: string }[]>`
      SELECT status FROM campaigns WHERE id = ${campaignId}
    `;
    expect(campaign?.status).toBe("pending_internal_review");

    const [task] = await sql<{ step_progress: Record<string, unknown>; current_step: string }[]>`
      SELECT step_progress, current_step FROM tasks WHERE id = ${taskId}
    `;
    const hr = (task?.step_progress?.human_review ?? {}) as Record<string, unknown>;
    expect(task?.current_step).toBe("human_review");
    expect(hr.status).toBe("pending");
  });

  it("blocks duplicate resubmit while review is pending", async () => {
    const db = getDb();
    const result = await submitCreativeForReview(db, {
      creativeId,
      userId,
      type: "internal",
    });
    expect("error" in result).toBe(true);
    if (!("error" in result) || !result.error) return;
    expect(result.code).toBe("REVIEW_PENDING");
  });
});
