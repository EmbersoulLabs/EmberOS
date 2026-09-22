import { eq } from "drizzle-orm";
import { AiStoryReusableCharacterError, AiStoryReusableCharacterService, getDb, schema } from "@ceo-agent/db";
import { isUuid, publicReusableCharacterCard } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const character = await new AiStoryReusableCharacterService(db).promoteFromCampaignCharacter(
      { orgId: campaign.orgId, workspaceId: campaign.workspaceId, actorUserId: user.id },
      { campaignId: id, campaignCharacterId: characterId }
    );
    return apiSuccess({ character: publicReusableCharacterCard(character, 0) }, 201);
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
