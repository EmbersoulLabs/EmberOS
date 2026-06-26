import { eq, and, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
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
} from "@ceo-agent/shared";
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
    } = body as {
      workspaceId: string;
      name: string;
      goal?: string;
      platforms?: string[];
      campaignBrief?: string;
      voicePreset?: string;
      contentStyle?: string;
      campaignGoal?: string;
      bgmPreference?: string;
      bgmStartPreference?: string;
    };

    if (!workspaceId || !name) {
      return apiError("workspaceId and name are required", "VALIDATION_ERROR");
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const db = getDb();

    const briefText = campaignBrief?.trim() || null;
    const voice = isVoicePreset(voicePreset) ? voicePreset : DEFAULT_VOICE_PRESET;
    const style = isContentStyle(contentStyle) ? contentStyle : null;
    const marketingGoal = isCampaignMarketingGoal(campaignGoal) ? campaignGoal : null;
    const bgm = isBgmUserPreference(bgmPreference) ? bgmPreference : DEFAULT_BGM_PREFERENCE;
    const bgmStart = isBgmStartPreference(bgmStartPreference)
      ? bgmStartPreference
      : DEFAULT_BGM_START_PREFERENCE;
    const legacyGoal = goal?.trim() || (marketingGoal ? legacyGoalFromMarketingGoal(marketingGoal) : undefined);

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        orgId: member.orgId,
        workspaceId,
        name,
        goal: legacyGoal,
        platforms: platforms ?? ["tiktok", "xiaohongshu", "instagram"],
        campaignBrief: briefText,
        voicePreset: voice,
        contentStyle: style,
        campaignGoal: marketingGoal,
        bgmPreference: bgm,
        metadata: { bgmStartPreference: bgmStart },
        createdBy: user.id,
      })
      .returning();

    return apiSuccess({ campaign }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
