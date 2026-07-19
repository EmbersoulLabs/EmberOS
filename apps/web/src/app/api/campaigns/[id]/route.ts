import { eq, and, desc, asc, isNull } from "drizzle-orm";
import {
  getDb,
  schema,
  requireWorkspaceRole,
  softDeleteCampaign,
  getMarketingPackageForCampaign,
} from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  isCampaignBusinessStatus,
  validateCampaignObjective,
  validateCampaignLanguages,
  isContentLocale,
} from "@ceo-agent/shared";
import { isCampaignDeletable } from "@/lib/campaigns";

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
      .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const assets = await db
      .select()
      .from(schema.assets)
      .where(
        and(eq(schema.assets.campaignId, id), eq(schema.assets.workspaceId, campaign.workspaceId))
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

    const marketingPackage = await getMarketingPackageForCampaign(
      db,
      id,
      campaign.workspaceId
    );

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

    const aiGenerationState = task
      ? task.status === "queued" || task.status === "running"
        ? "running"
        : task.status === "failed"
          ? "failed"
          : task.status === "completed"
            ? "completed"
            : "idle"
      : "idle";

    return apiSuccess({
      campaign: campaignRecord,
      assets,
      task: task ?? null,
      creative: creative ?? null,
      creatives,
      marketingPackage,
      hasVideoAsset,
      clipCount: creatives.length,
      aiGenerationState,
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
      .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: user.id };

    if (body.name != null) patch.name = body.name;
    if (body.goal != null) patch.goal = body.goal;
    if (body.platforms != null) patch.platforms = body.platforms;
    if (body.description != null) patch.description = body.description || null;
    if (body.targetAudienceOverride != null) {
      patch.targetAudienceOverride = body.targetAudienceOverride || null;
    }
    if (body.campaignBrief != null) patch.campaignBrief = body.campaignBrief || null;
    if (body.tags != null) patch.tags = body.tags;
    if (body.folder != null) patch.folder = body.folder || null;
    if (body.isFavorite != null) patch.isFavorite = Boolean(body.isFavorite);
    if (body.assignedTo != null) patch.assignedTo = body.assignedTo || null;
    if (body.externalAssetUrl != null) patch.externalAssetUrl = body.externalAssetUrl || null;

    if (body.campaignObjectiveId != null) {
      const check = validateCampaignObjective(
        body.campaignObjectiveId,
        body.campaignObjectiveCustom
      );
      if (!check.ok) return apiError(check.error, "VALIDATION_ERROR");
      patch.campaignObjectiveId = check.objectiveId;
      patch.campaignObjectiveCustom =
        check.objectiveId === "custom" ? body.campaignObjectiveCustom?.trim() : null;
    }

    if (
      body.outputLanguage != null ||
      body.subtitleLanguage != null ||
      body.ctaLanguage != null ||
      body.hashtagLanguage != null
    ) {
      const langCheck = validateCampaignLanguages({
        outputLanguage: body.outputLanguage ?? campaign.outputLanguage,
        subtitleLanguage: body.subtitleLanguage ?? campaign.subtitleLanguage,
        ctaLanguage: body.ctaLanguage ?? campaign.ctaLanguage,
        hashtagLanguage: body.hashtagLanguage ?? campaign.hashtagLanguage,
      });
      if (!langCheck.ok) return apiError(langCheck.error, "VALIDATION_ERROR");
      Object.assign(patch, langCheck.languages);
    }

    if (body.businessStatus != null) {
      if (!isCampaignBusinessStatus(body.businessStatus)) {
        return apiError("Invalid business status", "VALIDATION_ERROR");
      }
      patch.businessStatus = body.businessStatus;
      if (body.businessStatus === "archived") {
        patch.archivedAt = new Date();
      }
    }

    if (body.suggestedLanguages != null && typeof body.suggestedLanguages === "object") {
      const suggested = body.suggestedLanguages as Record<string, unknown>;
      const fields = ["outputLanguage", "subtitleLanguage", "ctaLanguage", "hashtagLanguage"] as const;
      const next: Record<string, string> = {};
      for (const f of fields) {
        const v = suggested[f];
        if (isContentLocale(v)) next[f] = v;
      }
      if (Object.keys(next).length === 4) {
        Object.assign(patch, next);
      }
    }

    const [updated] = await db
      .update(schema.campaigns)
      .set(patch)
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
      .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
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

    const deleted = await softDeleteCampaign(db, id, campaign.workspaceId, user.id);
    if (!deleted) {
      return apiError("Campaign not found", "NOT_FOUND", 404);
    }

    return apiSuccess({
      deleted: true,
      softDelete: true,
      purgeAfter: deleted.purgeAfter,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
