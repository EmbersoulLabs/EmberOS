import { eq, and, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  defaultCampaignLanguages,
  CAMPAIGN_OBJECTIVE_LABELS,
  CampaignWorkspaceCreateSchema,
  DEFAULT_VOICE_PRESET,
  DEFAULT_BGM_PREFERENCE,
} from "@ceo-agent/shared";
import { isCampaignDeletable } from "@/lib/campaigns";
import { isDatabaseSchemaError } from "@/lib/database-errors";

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
    const parsed = CampaignWorkspaceCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid campaign payload", "VALIDATION_ERROR", 400);
    }

    const {
      workspaceId,
      name,
      objective,
      objectiveCustom,
      targetAudienceOverride,
      campaignBrief,
      outputLanguage,
      subtitleLanguage,
      ctaLanguage,
      hashtagLanguage,
      platforms,
    } = parsed.data;

    if (objective === "other" && !objectiveCustom?.trim()) {
      return apiError("Custom objective is required when Other is selected", "VALIDATION_ERROR", 400);
    }

    const langs = defaultCampaignLanguages("en");
    const languages = {
      outputLanguage: outputLanguage ?? langs.outputLanguage,
      subtitleLanguage: subtitleLanguage ?? langs.subtitleLanguage,
      ctaLanguage: ctaLanguage ?? langs.ctaLanguage,
      hashtagLanguage: hashtagLanguage ?? langs.hashtagLanguage,
    };

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const db = getDb();

    const objectiveLabel =
      objective === "other"
        ? objectiveCustom!.trim()
        : CAMPAIGN_OBJECTIVE_LABELS[objective];

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        orgId: member.orgId,
        workspaceId,
        name: name.trim(),
        goal: objectiveLabel,
        objective,
        objectiveCustom: objective === "other" ? objectiveCustom!.trim() : null,
        // PD-044: do not write legacy campaigns.description
        targetAudienceOverride: targetAudienceOverride?.trim() || null,
        // PD-005: platforms must not block V1 — keep optional non-empty default for legacy consumers.
        platforms: Array.isArray(platforms) && platforms.length > 0 ? platforms : [],
        campaignBrief: campaignBrief?.trim() || null,
        outputLanguage: languages.outputLanguage,
        subtitleLanguage: languages.subtitleLanguage,
        ctaLanguage: languages.ctaLanguage,
        hashtagLanguage: languages.hashtagLanguage,
        generateStatus: "idle",
        voicePreset: DEFAULT_VOICE_PRESET,
        bgmPreference: DEFAULT_BGM_PREFERENCE,
        metadata: {},
        createdBy: user.id,
        status: "draft",
      })
      .returning();

    return apiSuccess({ campaign }, 201);
  } catch (error) {
    if (isDatabaseSchemaError(error)) {
      console.error("Campaign schema is not ready for Campaign Workspace", error);
      return apiError(
        "We could not save this Campaign step.",
        "CAMPAIGN_SCHEMA_NOT_READY",
        503
      );
    }
    return handleApiError(error);
  }
}
