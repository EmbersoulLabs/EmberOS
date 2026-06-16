import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueProbe } from "@ceo-agent/queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, assetId } = await params;
    const body = await request.json();
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

    const [asset] = await db
      .update(schema.assets)
      .set({
        width,
        height,
        durationSec: durationSec ? String(durationSec) : undefined,
      })
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, campaign.workspaceId)
        )
      )
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
