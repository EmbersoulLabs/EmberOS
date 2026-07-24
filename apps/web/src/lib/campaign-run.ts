/**
 * Campaign Run helpers — OPS-002 Rule 1 (one active run) + shared start path.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueuePipeline } from "@ceo-agent/queue";
import {
  ACTIVE_CAMPAIGN_TASK_STATUSES,
  LLM_BUDGET_PER_TASK_USD,
  isActiveCampaignTaskStatus,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;
type CampaignRow = typeof schema.campaigns.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;

export async function findActiveCampaignTask(
  db: Db,
  campaignId: string
): Promise<TaskRow | null> {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.campaignId, campaignId),
        inArray(schema.tasks.status, [...ACTIVE_CAMPAIGN_TASK_STATUSES])
      )
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1);
  return task ?? null;
}

export type StartCampaignRunResult =
  | { ok: true; taskId: string; status: string; reused: boolean }
  | { ok: false; error: string; code: string; status: number };

/**
 * Start a Campaign AI pipeline once, or return the existing active task.
 * Never creates a second active task for the same Campaign (OPS-002 Rule 1).
 */
export async function startOrReuseCampaignRun(
  db: Db,
  campaign: CampaignRow,
  options?: {
    contentLocale?: string;
    renderPreferences?: { subtitleStyle: string; subtitleLanguage: string };
  }
): Promise<StartCampaignRunResult> {
  const active = await findActiveCampaignTask(db, campaign.id);
  if (active && isActiveCampaignTaskStatus(active.status)) {
    return {
      ok: true,
      taskId: active.id,
      status: active.status,
      reused: true,
    };
  }

  if (options?.contentLocale || options?.renderPreferences) {
    const campaignMeta = (campaign.metadata ?? {}) as Record<string, unknown>;
    await db
      .update(schema.campaigns)
      .set({
        metadata: {
          ...campaignMeta,
          ...(options.contentLocale ? { contentLocale: options.contentLocale } : {}),
          ...(options.renderPreferences
            ? { renderPreferences: options.renderPreferences }
            : {}),
        },
      })
      .where(eq(schema.campaigns.id, campaign.id));
  }

  const [task] = await db
    .insert(schema.tasks)
    .values({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      status: "queued",
      costBudgetUsd: String(LLM_BUDGET_PER_TASK_USD),
      stepProgress: {},
    })
    .returning();

  if (!task) {
    return { ok: false, error: "Failed to create task", code: "INTERNAL", status: 500 };
  }

  await db
    .update(schema.campaigns)
    .set({ status: "processing" })
    .where(eq(schema.campaigns.id, campaign.id));

  await enqueuePipeline(task.id, campaign.id, campaign.workspaceId, campaign.orgId);

  return { ok: true, taskId: task.id, status: "queued", reused: false };
}
