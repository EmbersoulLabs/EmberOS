import { AiStorySupportingCastAuthorityService } from "@ceo-agent/db";
import { AiStoryCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { resolveAiStoryCastApiScope } from "@/lib/ai-story-cast-access";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string; supportingCharacterId: string }> }) {
  try { const { id, storyId, supportingCharacterId } = await params; if (![id, storyId, supportingCharacterId].every(isUuid)) return apiError("Invalid Cast identity", "VALIDATION_ERROR", 400); const parsed = AiStoryCharacterMutationInputSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return apiError("Campaign Character facts are required for explicit promotion", "VALIDATION_ERROR", 400); const context = await resolveAiStoryCastApiScope(id, storyId, true); if (!context) return apiError("Story not found", "NOT_FOUND", 404); return apiSuccess({ promotion: await new AiStorySupportingCastAuthorityService(context.db).promoteSupportingToCampaign(context.scope, supportingCharacterId, parsed.data) }, 201); } catch (error) { return handleApiError(error); }
}
