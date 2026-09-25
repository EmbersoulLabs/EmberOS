import { and, eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid, VOICE_CONTINUITY_STATUS } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const { id, storyId } = await params;
    if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Episode", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "admin" });
    await requireWorkspaceRole(campaign.workspaceId, user.id, "admin");
    const rows = await db.select().from(schema.aiStoryEpisodeCharacterBindings)
      .where(and(
        eq(schema.aiStoryEpisodeCharacterBindings.storyId, storyId),
        eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, campaign.workspaceId),
      ));
    return apiSuccess({
      voiceContinuityStatus: VOICE_CONTINUITY_STATUS,
      lineage: rows.map((row) => row.snapshot),
    });
  } catch (error) { return handleApiError(error); }
}
