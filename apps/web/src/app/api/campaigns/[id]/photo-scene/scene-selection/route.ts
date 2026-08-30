import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isUuid, PhotoSceneOutputPresetIdSchema, PhotoScenePlacementV1Schema } from "@ceo-agent/shared";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  latestReadyExtractedProductId,
  mapOfficialSceneApiError,
  persistOfficialSceneSelection,
  readOfficialSceneSelection,
} from "@/lib/photo-scene-official-scenes";

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
    const selection = await readOfficialSceneSelection(db, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      orgId: campaign.orgId,
    });
    return apiSuccess({ selection, marketingImageCreated: false });
  } catch (error) {
    try {
      const mapped = mapOfficialSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "campaignRun", user.id);
    if (limited) return limited;
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);
    const body = (await request.json()) as {
      sceneId?: string;
      sceneVersion?: number;
      presetId?: string;
      extractedAssetId?: string | null;
      placement?: unknown;
    };
    if (!isUuid(body.sceneId) || !Number.isInteger(body.sceneVersion) || (body.sceneVersion ?? 0) < 1) {
      return apiError("sceneId and sceneVersion are required", "VALIDATION_ERROR", 400);
    }
    const presetId = PhotoSceneOutputPresetIdSchema.parse(body.presetId);
    const placement = body.placement
      ? PhotoScenePlacementV1Schema.partial().parse(body.placement)
      : undefined;
    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");
    const extractedAssetId =
      body.extractedAssetId && isUuid(body.extractedAssetId)
        ? body.extractedAssetId
        : await latestReadyExtractedProductId(db, {
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
          });
    const saved = await persistOfficialSceneSelection(db, {
      campaign,
      userId: user.id,
      extractedAssetId,
      sceneId: body.sceneId,
      sceneVersion: body.sceneVersion!,
      presetId,
      placement,
    });
    return apiSuccess({
      selection: {
        frozen: saved.frozen,
        scene: saved.scene,
        extractedAssetId: saved.selection.extractedAssetId,
      },
      marketingImageCreated: false,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return apiError("Placement or preset is invalid", "PLACEMENT_INVALID", 400);
    }
    try {
      const mapped = mapOfficialSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}
