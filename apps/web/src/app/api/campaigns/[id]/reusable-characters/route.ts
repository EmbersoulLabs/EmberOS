import { and, eq } from "drizzle-orm";
import { AiStoryReusableCharacterError, AiStoryReusableCharacterService, AiStoryCharacterVirtualizerService, getDb, schema } from "@ceo-agent/db";
import { isUuid, publicReusableCharacterCard } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

function asReusableError(error: unknown) {
  if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
  return handleApiError(error);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "client_viewer" });
    const service = new AiStoryReusableCharacterService(db);
    const virtualizer = new AiStoryCharacterVirtualizerService(db);
    const versions = await service.list({ orgId: campaign.orgId, workspaceId: campaign.workspaceId, actorUserId: user.id });
    const characters = await Promise.all(versions.map(async (version) => {
      const countRows = await db.select({ storyId: schema.aiStoryEpisodeCharacterBindings.storyId })
        .from(schema.aiStoryEpisodeCharacterBindings)
        .where(and(
          eq(schema.aiStoryEpisodeCharacterBindings.reusableCharacterId, version.reusableCharacterId),
          eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, campaign.workspaceId),
        ));
      const episodeCount = new Set(countRows.map((row) => row.storyId)).size;
      const virtual = await virtualizer.latestAcceptedForCharacter(
        { orgId: campaign.orgId, workspaceId: campaign.workspaceId, actorUserId: user.id },
        version.reusableCharacterId
      );
      return {
        ...publicReusableCharacterCard(version, episodeCount),
        visualClass: virtual?.visualClass,
        virtualStyle: virtual?.style,
        identityLocked: true as const,
      };
    }));
    return apiSuccess({ characters });
  } catch (error) { return asReusableError(error); }
}
