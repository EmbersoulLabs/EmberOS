import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { getDb, closeDb } from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  getIntegrationDbUrl,
  createIntegrationSql,
} from "./helpers/db-integration";
import { startOrReuseCampaignRun } from "../apps/web/src/lib/campaign-run";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("Marketing vertical slice (DB integration)", () => {
  let sql: Sql;
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);
  const enqueued: Array<{ taskId: string; campaignId: string }> = [];

  beforeAll(async () => {
    sql = createIntegrationSql();

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${"Marketing Slice Org"}, ${`mkt-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"WS"}, ${`ws-${suffix}`})
    `;
    await sql`
      INSERT INTO campaigns (
        id, org_id, workspace_id, name, platforms, status,
        objective, output_language, subtitle_language, cta_language, hashtag_language,
        generate_status
      )
      VALUES (
        ${campaignId}, ${orgId}, ${workspaceId}, ${"Spring Promo"}, ${["tiktok"]}, ${"draft"},
        ${"awareness"}, ${"en"}, ${"en"}, ${"en"}, ${"en"},
        ${"idle"}
      )
    `;
    await sql`
      INSERT INTO assets (
        id, org_id, workspace_id, type, storage_path, original_filename, display_name
      )
      VALUES (
        ${assetId}, ${orgId}, ${workspaceId}, ${"image"}, ${`${workspaceId}/img.jpg`},
        ${"hero.jpg"}, ${"Hero"}
      )
    `;
    await sql`
      INSERT INTO campaign_asset_refs (campaign_id, asset_id, sort_order)
      VALUES (${campaignId}, ${assetId}, 0)
    `;
  }, 30_000);

  afterAll(async () => {
    await sql`DELETE FROM tasks WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM assets WHERE id = ${assetId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end();
    await closeDb();
  }, 30_000);

  it("Generate path creates a queued task via startOrReuseCampaignRun", async () => {
    const db = getDb();
    const [row] = await sql`
      SELECT * FROM campaigns WHERE id = ${campaignId}
    `;
    expect(row).toBeTruthy();

    const campaign = {
      id: row!.id as string,
      orgId: row!.org_id as string,
      workspaceId: row!.workspace_id as string,
      name: row!.name as string,
      objective: row!.objective as string | null,
      objectiveCustom: row!.objective_custom as string | null,
      outputLanguage: row!.output_language as string | null,
      subtitleLanguage: row!.subtitle_language as string | null,
      ctaLanguage: row!.cta_language as string | null,
      hashtagLanguage: row!.hashtag_language as string | null,
      status: row!.status as string,
      generateStatus: row!.generate_status as string,
      generateSummary: row!.generate_summary,
      metadata: row!.metadata,
    };

    const result = await startOrReuseCampaignRun(db, campaign as never, {
      enqueue: async (taskId, cId) => {
        enqueued.push({ taskId, campaignId: cId });
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.campaignId).toBe(campaignId);

    const tasks = await sql`
      SELECT id, status, campaign_id FROM tasks WHERE campaign_id = ${campaignId}
    `;
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe("queued");
  });

  it("completed task content is readable for review and export surfaces", async () => {
    const tasks = await sql`
      SELECT id FROM tasks WHERE campaign_id = ${campaignId} LIMIT 1
    `;
    const taskId = tasks[0]?.id as string;
    expect(taskId).toBeTruthy();

    const stepProgress = {
      content_generate: {
        status: "completed",
        output: {
          hooks: ["Launch hook"],
          cta: "Shop now",
          captions: { en: "Caption" },
          platformAssets: {},
          hashtagPack: { industry: [], local: [], trending: [], seo: ["spring"] },
          seo: { primaryKeywords: ["spring"], searchIntent: "awareness" },
        },
      },
      marketing_score: { status: "completed", output: { overall: 82 } },
    };

    await sql`
      UPDATE tasks
      SET status = ${"completed"}, step_progress = ${JSON.stringify(stepProgress)}::jsonb
      WHERE id = ${taskId}
    `;

    const [row] = await sql`
      SELECT step_progress, status FROM tasks WHERE id = ${taskId}
    `;
    expect(row?.status).toBe("completed");
    const progress =
      typeof row?.step_progress === "string"
        ? (JSON.parse(row.step_progress) as Record<string, { status?: string; output?: unknown }>)
        : (row?.step_progress as Record<string, { status?: string; output?: unknown }>);
    expect(progress?.content_generate?.status).toBe("completed");
    expect(progress?.content_generate?.output).toMatchObject({ cta: "Shop now" });
  });
});
