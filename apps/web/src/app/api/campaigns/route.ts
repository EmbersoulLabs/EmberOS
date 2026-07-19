import { eq, and, desc, isNull } from "drizzle-orm";
import {
  getDb,
  schema,
  requireWorkspaceRole,
  ensureBusinessProfileForWorkspace,
} from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  isVoicePreset,
  isContentStyle,
  isCampaignMarketingGoal,
  isBgmUserPreference,
  isBgmStartPreference,
  legacyGoalFromMarketingGoal,
  DEFAULT_VOICE_PRESET,
  DEFAULT_BGM_PREFERENCE,
  DEFAULT_BGM_START_PREFERENCE,
  isSubtitleLanguagePair,
  isSubtitleStylePreset,
  assessBusinessProfileCompletion,
  normalizeBusinessProfileRecord,
  validateCampaignObjective,
  validateCampaignLanguages,
  defaultCampaignLanguages,
  isCampaignBusinessStatus,
  isContentLocale,
} from "@ceo-agent/shared";
import { isCampaignDeletable } from "@/lib/campaigns";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const status = searchParams.get("status");
    const businessStatus = searchParams.get("businessStatus");

    if (!workspaceId) return apiError("workspaceId is required", "VALIDATION_ERROR");
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const db = getDb();
    const conditions = [
      eq(schema.campaigns.workspaceId, workspaceId),
      isNull(schema.campaigns.deletedAt),
    ];
    if (status) conditions.push(eq(schema.campaigns.status, status));
    if (businessStatus && isCampaignBusinessStatus(businessStatus)) {
      conditions.push(eq(schema.campaigns.businessStatus, businessStatus));
    }

    const campaigns = await db
      .select()
      .from(schema.campaigns)
      .where(and(...conditions))
      .orderBy(desc(schema.campaigns.updatedAt));

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
    const {
      workspaceId,
      name,
      goal,
      platforms,
      campaignBrief,
      voicePreset,
      contentStyle,
      campaignGoal,
      bgmPreference,
      bgmStartPreference,
      subtitleStyle,
      subtitleLanguage,
      description,
      targetAudienceOverride,
      campaignObjectiveId,
      campaignObjectiveCustom,
      outputLanguage,
      subtitleLanguage: specSubtitleLanguage,
      ctaLanguage,
      hashtagLanguage,
      tags,
      folder,
      isFavorite,
      assignedTo,
      externalAssetUrl,
      uiLocale,
    } = body as Record<string, unknown>;

    if (!workspaceId || !name || typeof name !== "string") {
      return apiError("workspaceId and name are required", "VALIDATION_ERROR");
    }

    const objectiveCheck = validateCampaignObjective(
      campaignObjectiveId,
      typeof campaignObjectiveCustom === "string" ? campaignObjectiveCustom : null
    );
    if (!objectiveCheck.ok) {
      return apiError(objectiveCheck.error, "VALIDATION_ERROR");
    }

    const langDefaults = defaultCampaignLanguages(
      typeof uiLocale === "string" ? uiLocale : "en"
    );
    const langCheck = validateCampaignLanguages({
      outputLanguage: isContentLocale(outputLanguage) ? outputLanguage : langDefaults.outputLanguage,
      subtitleLanguage: isContentLocale(specSubtitleLanguage)
        ? specSubtitleLanguage
        : langDefaults.subtitleLanguage,
      ctaLanguage: isContentLocale(ctaLanguage) ? ctaLanguage : langDefaults.ctaLanguage,
      hashtagLanguage: isContentLocale(hashtagLanguage)
        ? hashtagLanguage
        : langDefaults.hashtagLanguage,
    });
    if (!langCheck.ok) {
      return apiError(langCheck.error, "VALIDATION_ERROR");
    }

    const member = await requireWorkspaceRole(workspaceId as string, user.id, "operator");
    const db = getDb();

    const profileRow = await ensureBusinessProfileForWorkspace(
      member.orgId,
      workspaceId as string,
      user.id
    );
    const businessProfile = normalizeBusinessProfileRecord(
      profileRow as Record<string, unknown>
    );
    const profileCompletion = assessBusinessProfileCompletion(businessProfile);

    const briefText =
      typeof campaignBrief === "string" ? campaignBrief.trim() || null : null;
    const voice = isVoicePreset(voicePreset) ? voicePreset : DEFAULT_VOICE_PRESET;
    const style = isContentStyle(contentStyle) ? contentStyle : null;
    const marketingGoal = isCampaignMarketingGoal(campaignGoal) ? campaignGoal : null;
    const bgm = isBgmUserPreference(bgmPreference) ? bgmPreference : DEFAULT_BGM_PREFERENCE;
    const bgmStart = isBgmStartPreference(bgmStartPreference)
      ? bgmStartPreference
      : DEFAULT_BGM_START_PREFERENCE;
    const legacyGoal =
      (typeof goal === "string" ? goal.trim() : undefined) ||
      (marketingGoal ? legacyGoalFromMarketingGoal(marketingGoal) : undefined);

    const renderPreferences =
      isSubtitleStylePreset((subtitleStyle as string) ?? "") &&
      isSubtitleLanguagePair((subtitleLanguage as string) ?? "")
        ? { subtitleStyle, subtitleLanguage }
        : undefined;

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        orgId: member.orgId,
        workspaceId: workspaceId as string,
        companyProfileId: profileRow.id,
        name: name as string,
        goal: legacyGoal,
        platforms: Array.isArray(platforms)
          ? (platforms as string[])
          : ["tiktok", "xiaohongshu", "instagram"],
        businessStatus: "draft",
        description:
          typeof description === "string" ? description.trim() || null : null,
        targetAudienceOverride:
          typeof targetAudienceOverride === "string"
            ? targetAudienceOverride.trim() || null
            : null,
        campaignObjectiveId: objectiveCheck.objectiveId,
        campaignObjectiveCustom:
          objectiveCheck.objectiveId === "custom"
            ? (campaignObjectiveCustom as string).trim()
            : null,
        campaignBrief: briefText,
        outputLanguage: langCheck.languages.outputLanguage,
        subtitleLanguage: langCheck.languages.subtitleLanguage,
        ctaLanguage: langCheck.languages.ctaLanguage,
        hashtagLanguage: langCheck.languages.hashtagLanguage,
        voicePreset: voice,
        contentStyle: style,
        campaignGoal: marketingGoal,
        bgmPreference: bgm,
        tags: Array.isArray(tags) ? (tags as string[]) : [],
        folder: typeof folder === "string" ? folder.trim() || null : null,
        isFavorite: Boolean(isFavorite),
        assignedTo: typeof assignedTo === "string" ? assignedTo : null,
        externalAssetUrl:
          typeof externalAssetUrl === "string" ? externalAssetUrl.trim() || null : null,
        metadata: {
          bgmStartPreference: bgmStart,
          ...(renderPreferences ? { renderPreferences } : {}),
        },
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();

    return apiSuccess(
      {
        campaign,
        ...(!profileCompletion.complete
          ? {
              warnings: [
                {
                  code: "BUSINESS_PROFILE_INCOMPLETE",
                  message: "Business Profile is incomplete. AI quality may be affected.",
                  missing: profileCompletion.missing,
                },
              ],
            }
          : {}),
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
