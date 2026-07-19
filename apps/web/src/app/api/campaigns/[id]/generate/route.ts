import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { canGenerateCampaign } from "@ceo-agent/shared";

/** Placeholder generate endpoint — no real AI per SPEC-002 boundaries. */
export async function POST(
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

    const assets = await db
      .select()
      .from(schema.assets)
      .where(
        and(eq(schema.assets.campaignId, id), eq(schema.assets.workspaceId, campaign.workspaceId))
      );

    if (
      !canGenerateCampaign({
        assetCount: assets.length,
        externalAssetUrl: campaign.externalAssetUrl,
      })
    ) {
      return apiError(
        "At least one input source is required before Generate",
        "VALIDATION_ERROR",
        422
      );
    }

    const now = new Date();
    const [updated] = await db
      .update(schema.campaigns)
      .set({
        businessStatus: "active",
        firstGeneratedAt: campaign.firstGeneratedAt ?? now,
        lastGeneratedAt: now,
        updatedAt: now,
        updatedBy: user.id,
        version: campaign.version + 1,
      })
      .where(eq(schema.campaigns.id, id))
      .returning();

    return apiSuccess({
      campaign: updated,
      placeholder: true,
      message:
        "Generate is a UI placeholder until AI Job / Workflow specifications are locked.",
      aiGenerationState: "queued",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
