import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryStructuredDraftSchema,
  AiStoryUpdateDraftBodySchema,
  isUuid,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { apiSuccess, apiError } from "@/lib/api";
import {
  createAiStoryVersion,
  loadCampaignAiStory,
  setAiStoryStatus,
} from "@/lib/ai-story-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "client_viewer" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    if (loaded.verificationFixtureState === "LEGACY_PARTIAL_VERIFICATION_FIXTURE") {
      return apiSuccess({
        ...loaded,
        story: { ...loaded.story, status: "failed" },
        persistedStoryStatus: loaded.story.status,
      });
    }
    return apiSuccess(loaded);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }

    const parsed = AiStoryUpdateDraftBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid Story Draft update", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (!["draft", "review", "failed"].includes(status)) {
      return apiError("Story is not editable in its current state", "VALIDATION_ERROR", 409);
    }
    if (loaded.currentVersion?.frozenAt) {
      return apiError("Frozen Story versions cannot be edited", "VALIDATION_ERROR", 409);
    }

    const draft = AiStoryStructuredDraftSchema.parse(parsed.data.structuredContent);
    const version = await createAiStoryVersion(db, {
      storyId,
      structuredContent: draft,
      sourceContextSnapshot: { editedAt: new Date().toISOString() },
      userEdited: true,
      createdBy: user.id,
    });

    if (status !== "review") {
      await setAiStoryStatus(db, storyId, status, "review");
    }

    return apiSuccess({ story: loaded.story, version });
  } catch (error) {
    return handleApiError(error);
  }
}
