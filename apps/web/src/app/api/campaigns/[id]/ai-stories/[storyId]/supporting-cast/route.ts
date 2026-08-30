import { AiStorySupportingCastAuthorityService, getDb, withDbDeadline } from "@ceo-agent/db";
import { AiStorySupportingCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAiStoryCastApiScope } from "@/lib/ai-story-cast-access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try { const { id, storyId } = await params; if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Cast scope", "VALIDATION_ERROR", 400); const user = await requireAuth(); return await withDbDeadline(getDb(), async (db) => { const context = await resolveAiStoryCastApiScope(id, storyId, false, { user, db }); if (!context) return apiError("Story not found", "NOT_FOUND", 404); return apiSuccess({ supportingCharacters: await new AiStorySupportingCastAuthorityService(context.db).list(context.scope) }); }); } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try { const { id, storyId } = await params; if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Cast scope", "VALIDATION_ERROR", 400); const parsed = AiStorySupportingCharacterMutationInputSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return apiError("Supporting Character facts are invalid", "VALIDATION_ERROR", 400); const context = await resolveAiStoryCastApiScope(id, storyId, true); if (!context) return apiError("Story not found", "NOT_FOUND", 404); return apiSuccess({ supportingCharacter: await new AiStorySupportingCastAuthorityService(context.db).add(context.scope, parsed.data) }, 201); } catch (error) { return handleApiError(error); }
}
