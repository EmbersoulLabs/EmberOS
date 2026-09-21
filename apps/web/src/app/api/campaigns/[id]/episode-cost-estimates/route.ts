import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { apiError, apiSuccess } from "@/lib/api";
import {
  AiStoryEpisodeRevisionError,
  plannedEpisodeCostFromUnitCount,
} from "@ceo-agent/shared/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }
    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({
      user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "reviewer",
    });
    const body = (await request.json()) as {
      unitCount?: number;
      durationSeconds?: number;
      aspectRatio?: "9:16" | "16:9" | "1:1";
      resolution?: "480p" | "720p" | "1080p";
      nativeAudio?: boolean;
    };
    const estimate = plannedEpisodeCostFromUnitCount({
      unitCount: body.unitCount ?? 6,
      durationSeconds: body.durationSeconds ?? 8,
      aspectRatio: body.aspectRatio ?? "9:16",
      resolution: body.resolution ?? "480p",
      nativeAudio: body.nativeAudio ?? true,
      createdBy: user.id,
      generatedAt: new Date().toISOString(),
    });
    return apiSuccess({
      estimate,
      authorizesSpend: false,
      providerCalls: 0,
    });
  } catch (error) {
    if (error instanceof AiStoryEpisodeRevisionError) {
      return apiError(error.message, error.code, 400);
    }
    return handleApiError(error);
  }
}
