import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isUuid } from "@ceo-agent/shared";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  mapPhotoSceneApiError,
  readLatestCampaignExtraction,
  requestProductExtraction,
} from "@/lib/photo-scene-extraction";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const generation = await readLatestCampaignExtraction(db, {
      campaignId: campaign.id,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
    });
    return apiSuccess({ generation });
  } catch (error) {
    try {
      const mapped = mapPhotoSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "campaignRun", user.id);
    if (limited) return limited;

    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);

    const body = (await request.json()) as { sourceAssetId?: string };
    if (!isUuid(body.sourceAssetId)) {
      return apiError("sourceAssetId is required", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const result = await requestProductExtraction(db, {
      campaign,
      sourceAssetId: body.sourceAssetId,
      userId: user.id,
    });
    return apiSuccess(result.dto, result.status);
  } catch (error) {
    try {
      const mapped = mapPhotoSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}
