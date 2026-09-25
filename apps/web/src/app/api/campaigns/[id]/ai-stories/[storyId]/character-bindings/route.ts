import { eq } from "drizzle-orm";
import { z } from "zod";
import { AiStoryReusableCharacterError, AiStoryReusableCharacterService, getDb, schema } from "@ceo-agent/db";
import { AiStoryCharacterEpisodeLookSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

const BindSchema = z.object({
  reusableCharacterId: z.string().uuid(),
  reusableCharacterVersionId: z.string().uuid().optional(),
  episodeLook: AiStoryCharacterEpisodeLookSchema.partial().optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const { id, storyId } = await params;
    if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Episode", "VALIDATION_ERROR", 400);
    const parsed = BindSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Character binding is invalid", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const look = {
      wardrobe: parsed.data.episodeLook?.wardrobe ?? null,
      makeup: parsed.data.episodeLook?.makeup ?? null,
      accessories: parsed.data.episodeLook?.accessories ?? null,
      hairstyle: parsed.data.episodeLook?.hairstyle ?? null,
      hairColor: parsed.data.episodeLook?.hairColor ?? null,
      expression: parsed.data.episodeLook?.expression ?? null,
      pose: parsed.data.episodeLook?.pose ?? null,
      location: parsed.data.episodeLook?.location ?? null,
      action: parsed.data.episodeLook?.action ?? null,
      product: parsed.data.episodeLook?.product ?? null,
      dialogue: parsed.data.episodeLook?.dialogue ?? null,
    };
    const bound = await new AiStoryReusableCharacterService(db).bindEpisode(
      { orgId: campaign.orgId, workspaceId: campaign.workspaceId, actorUserId: user.id },
      {
        storyId,
        campaignId: id,
        reusableCharacterId: parsed.data.reusableCharacterId,
        reusableCharacterVersionId: parsed.data.reusableCharacterVersionId,
        episodeLook: look,
      }
    );
    return apiSuccess({
      binding: {
        reusableCharacterId: bound.binding.reusableCharacterId,
        reusableCharacterVersionId: bound.binding.reusableCharacterVersionId,
        identityLocked: true,
      },
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const { id, storyId } = await params;
    if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Episode", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "client_viewer" });
    const rows = await new AiStoryReusableCharacterService(db).listEpisodeBindings(
      { orgId: campaign.orgId, workspaceId: campaign.workspaceId, actorUserId: user.id },
      storyId
    );
    return apiSuccess({
      bindings: rows.map((row) => ({
        reusableCharacterId: row.reusableCharacterId,
        reusableCharacterVersionId: row.reusableCharacterVersionId,
        identityLocked: true,
      })),
    });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
