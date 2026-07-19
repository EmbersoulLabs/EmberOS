import { eq, and, isNull } from "drizzle-orm";
import {
  getDb,
  schema,
  requireWorkspaceRole,
  saveMarketingPackageUserEdited,
} from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isMarketingPackageCardId } from "@ceo-agent/shared";

/** Save user-edited Marketing Package card text — not AI generation. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const { cardId, text } = body as { cardId?: string; text?: string };
    if (!isMarketingPackageCardId(cardId)) {
      return apiError("Invalid marketing package card id", "VALIDATION_ERROR");
    }
    if (typeof text !== "string") {
      return apiError("text is required", "VALIDATION_ERROR");
    }

    const marketingPackage = await saveMarketingPackageUserEdited(
      db,
      campaign,
      user.id,
      cardId,
      text
    );

    return apiSuccess({ marketingPackage });
  } catch (error) {
    return handleApiError(error);
  }
}
