import { eq, and, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isCampaignDeletable } from "@/lib/campaigns";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const status = searchParams.get("status");

    if (!workspaceId) return apiError("workspaceId is required", "VALIDATION_ERROR");
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const db = getDb();
    let conditions = [eq(schema.campaigns.workspaceId, workspaceId)];
    if (status) {
      conditions.push(eq(schema.campaigns.status, status));
    }

    const campaigns = await db
      .select()
      .from(schema.campaigns)
      .where(and(...conditions));

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.workspaceId, workspaceId))
      .orderBy(desc(schema.tasks.createdAt));

    const latestTaskByCampaign = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) {
      if (!latestTaskByCampaign.has(task.campaignId)) {
        latestTaskByCampaign.set(task.campaignId, task);
      }
    }

    return apiSuccess({
      campaigns: campaigns.map((campaign) => ({
        ...campaign,
        canDelete: isCampaignDeletable(
          campaign.status,
          latestTaskByCampaign.get(campaign.id)?.status,
          (latestTaskByCampaign.get(campaign.id)?.stepProgress as Record<
            string,
            { status?: string }
          >) ?? null
        ),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { workspaceId, name, goal, platforms } = body as {
      workspaceId: string;
      name: string;
      goal?: string;
      platforms?: string[];
    };

    if (!workspaceId || !name) {
      return apiError("workspaceId and name are required", "VALIDATION_ERROR");
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const db = getDb();

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        orgId: member.orgId,
        workspaceId,
        name,
        goal,
        platforms: platforms ?? ["tiktok", "xiaohongshu", "instagram"],
        createdBy: user.id,
      })
      .returning();

    return apiSuccess({ campaign }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
