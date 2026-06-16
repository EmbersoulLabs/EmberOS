import { eq, and, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const assets = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.campaignId, id), eq(schema.assets.workspaceId, campaign.workspaceId)));

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.campaignId, id), eq(schema.tasks.workspaceId, campaign.workspaceId)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    const [creative] = task
      ? await db
          .select()
          .from(schema.creatives)
          .where(eq(schema.creatives.taskId, task.id))
          .limit(1)
      : [null];

    return apiSuccess({ campaign, assets, task: task ?? null, creative: creative ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const [updated] = await db
      .update(schema.campaigns)
      .set({
        name: body.name ?? campaign.name,
        goal: body.goal ?? campaign.goal,
        platforms: body.platforms ?? campaign.platforms,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, id))
      .returning();

    return apiSuccess({ campaign: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
