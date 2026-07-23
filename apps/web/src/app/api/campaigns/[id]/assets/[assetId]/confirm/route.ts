import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueProbe } from "@ceo-agent/queue";
import { suggestReadableAssetName } from "@/lib/asset-auto-name";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, assetId } = await params;
    const body = await request.json().catch(() => ({}));
    const { width, height, durationSec } = body as {
      width?: number;
      height?: number;
      durationSec?: number;
    };

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const [existing] = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, campaign.workspaceId)
        )
      )
      .limit(1);

    if (!existing) return apiError("Asset not found", "NOT_FOUND", 404);

    const metadata =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const manualName = metadata.displayNameSource === "manual";

    let displayName = existing.displayName;
    let displayNameSource = metadata.displayNameSource;
    if (!manualName) {
      const suggested = await suggestReadableAssetName({
        originalFilename: existing.originalFilename || existing.displayName || "asset",
        type: existing.type,
        mimeType: existing.mimeType,
        metadata,
        campaignId,
        assetId,
        workspaceId: campaign.workspaceId,
      });
      displayName = suggested.displayName;
      displayNameSource = suggested.source;
    } else {
      displayName = existing.displayName;
      displayNameSource = "manual";
    }

    const [asset] = await db
      .update(schema.assets)
      .set({
        status: "ready",
        width: width ?? existing.width,
        height: height ?? existing.height,
        durationSec: durationSec != null ? String(durationSec) : existing.durationSec,
        displayName,
        metadata: {
          ...metadata,
          originalFilename:
            existing.originalFilename ||
            (typeof metadata.originalFilename === "string"
              ? metadata.originalFilename
              : undefined),
          displayNameSource,
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId))
      .returning();

    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);

    if (asset.type === "video") {
      await enqueueProbe({
        assetId: asset.id,
        workspaceId: asset.workspaceId,
        storagePath: asset.storagePath,
      });
    }

    return apiSuccess({ asset });
  } catch (error) {
    return handleApiError(error);
  }
}
