import { eq, and, desc, asc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole, getCampaignAssets } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isCampaignDeletable } from "@/lib/campaigns";
import { deleteCampaignCascade } from "@/lib/campaign-delete";
import {
  isCampaignObjective,
  isCampaignLanguageCode,
  CAMPAIGN_OBJECTIVE_LABELS,
  CampaignWorkspacePatchSchema,
} from "@ceo-agent/shared";

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

    const assets = await getCampaignAssets(db, id, campaign.workspaceId);

    const storyRefs = await db
      .select({
        storyId: schema.campaignStoryRefs.storyId,
        name: schema.stories.name,
        status: schema.stories.status,
      })
      .from(schema.campaignStoryRefs)
      .innerJoin(schema.stories, eq(schema.stories.id, schema.campaignStoryRefs.storyId))
      .where(
        and(
          eq(schema.campaignStoryRefs.campaignId, id),
          eq(schema.stories.status, "ready")
        )
      );

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
          .orderBy(asc(schema.creatives.createdAt))
          .limit(1)
      : [null];

    const creatives = task
      ? await db
          .select()
          .from(schema.creatives)
          .where(eq(schema.creatives.taskId, task.id))
          .orderBy(asc(schema.creatives.createdAt))
      : [];

    const hasVideoAsset = assets.some((a) => a.type === "video");

    let campaignRecord = campaign;
    if (task?.status === "failed" && campaign.status === "processing") {
      const [synced] = await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, id))
        .returning();
      campaignRecord = synced ?? campaign;
    }

    return apiSuccess({
      campaign: campaignRecord,
      assets,
      stories: storyRefs,
      mediaAnalysisMode:
        ((campaign.metadata ?? {}) as Record<string, unknown>).mediaAnalysisMode ?? null,
      task: task ?? null,
      creative: creative ?? null,
      creatives,
      hasVideoAsset,
      clipCount: creatives.length,
      canDelete: isCampaignDeletable(
        campaignRecord.status,
        task?.status,
        (task?.stepProgress as Record<string, { status?: string }>) ?? null
      ),
    });
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

    const parsed = CampaignWorkspacePatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid campaign update", "VALIDATION_ERROR", 400);
    }
    const patch = parsed.data;

    const nextObjective = patch.objective ?? campaign.objective;
    const nextCustom =
      patch.objectiveCustom !== undefined
        ? patch.objectiveCustom
        : campaign.objectiveCustom;

    if (patch.objective != null && !isCampaignObjective(patch.objective)) {
      return apiError("Invalid objective", "VALIDATION_ERROR", 400);
    }
    if (nextObjective === "other" && !String(nextCustom ?? "").trim()) {
      return apiError(
        "Custom objective is required when Other is selected",
        "VALIDATION_ERROR",
        400
      );
    }

    for (const key of [
      "outputLanguage",
      "subtitleLanguage",
      "ctaLanguage",
      "hashtagLanguage",
    ] as const) {
      const value = patch[key];
      if (value != null && !isCampaignLanguageCode(value)) {
        return apiError(`Invalid ${key}`, "VALIDATION_ERROR", 400);
      }
    }

    const objectiveLabel = isCampaignObjective(nextObjective)
      ? nextObjective === "other"
        ? String(nextCustom).trim()
        : CAMPAIGN_OBJECTIVE_LABELS[nextObjective]
      : campaign.goal;

    const [updated] = await db
      .update(schema.campaigns)
      .set({
        name: patch.name ?? campaign.name,
        goal: objectiveLabel ?? campaign.goal,
        objective: (nextObjective as string | null) ?? campaign.objective,
        objectiveCustom:
          nextObjective === "other" ? String(nextCustom).trim() : null,
        description:
          patch.description !== undefined ? patch.description : campaign.description,
        targetAudienceOverride:
          patch.targetAudienceOverride !== undefined
            ? patch.targetAudienceOverride
            : campaign.targetAudienceOverride,
        campaignBrief:
          patch.campaignBrief !== undefined
            ? patch.campaignBrief
            : campaign.campaignBrief,
        outputLanguage: patch.outputLanguage ?? campaign.outputLanguage,
        subtitleLanguage: patch.subtitleLanguage ?? campaign.subtitleLanguage,
        ctaLanguage: patch.ctaLanguage ?? campaign.ctaLanguage,
        hashtagLanguage: patch.hashtagLanguage ?? campaign.hashtagLanguage,
        platforms: patch.platforms ?? campaign.platforms,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, id))
      .returning();

    return apiSuccess({ campaign: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
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
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.campaignId, id), eq(schema.tasks.workspaceId, campaign.workspaceId))
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    if (
      !isCampaignDeletable(
        campaign.status,
        task?.status,
        (task?.stepProgress as Record<string, { status?: string }>) ?? null
      )
    ) {
      return apiError(
        "This campaign cannot be deleted in its current state",
        "INVALID_STATE",
        400
      );
    }

    await deleteCampaignCascade(db, id, campaign.workspaceId);

    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
