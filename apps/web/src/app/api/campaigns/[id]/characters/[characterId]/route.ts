import { eq } from "drizzle-orm";
import { z } from "zod";
import { AiStoryCharacterAuthorityService, getDb, schema } from "@ceo-agent/db";
import { AiStoryCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import { AiStoryPreDirectorCharacterSyncError, synchronizePreDirectorCharacterAuthority } from "@/lib/ai-story-planning-service";

const EditSchema = z.object({ expectedVersion: z.number().int().positive(), character: AiStoryCharacterMutationInputSchema }).strict();
const DeleteSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const SyncPlanningSchema = z.object({ storyId: z.string().uuid() }).strict();

async function context(campaignId: string) {
  const user = await requireAuth(); const db = getDb();
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (!campaign) return null;
  await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
  return { db, scope: { orgId: campaign.orgId, workspaceId: campaign.workspaceId, campaignId, actorUserId: user.id } };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character identity", "VALIDATION_ERROR", 400);
    const body = EditSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return apiError("Character edit is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id); if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    return apiSuccess({ character: await new AiStoryCharacterAuthorityService(ctx.db).edit(ctx.scope, characterId, body.data.character, body.data.expectedVersion) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character identity", "VALIDATION_ERROR", 400);
    const body = SyncPlanningSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return apiError("Story identity is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id); if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    const loaded = await loadCampaignAiStory(ctx.db, id, body.data.storyId, ctx.scope.workspaceId);
    if (!loaded?.currentVersion) return apiError("AI Story not found", "NOT_FOUND", 404);
    if (!["ready_for_animation", "planning"].includes(loaded.story.status)) {
      return apiError("Character authority synchronization requires pre-Director Planning", "PLANNING_CHARACTER_SUCCESSOR_REQUIRED", 409);
    }
    const character = await new AiStoryCharacterAuthorityService(ctx.db).read(ctx.scope, characterId);
    const synchronized = await synchronizePreDirectorCharacterAuthority(ctx.db, {
      ...ctx.scope, storyId: body.data.storyId,
      storyVersionId: loaded.currentVersion.id, character,
    });
    return apiSuccess({
      character, creativeContext: synchronized.context,
      planningDraft: synchronized.planningDraft,
      providerCalls: synchronized.providerCalls,
    });
  } catch (error) {
    if (error instanceof AiStoryPreDirectorCharacterSyncError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character identity", "VALIDATION_ERROR", 400);
    const body = DeleteSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return apiError("Character delete is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id); if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    return apiSuccess({ character: await new AiStoryCharacterAuthorityService(ctx.db).delete(ctx.scope, characterId, body.data.expectedVersion) });
  } catch (error) { return handleApiError(error); }
}
