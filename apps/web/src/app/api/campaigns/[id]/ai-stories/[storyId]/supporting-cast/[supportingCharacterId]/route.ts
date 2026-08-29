import { AiStorySupportingCastAuthorityService } from "@ceo-agent/db";
import { AiStorySupportingCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { resolveAiStoryCastApiScope } from "@/lib/ai-story-cast-access";

const Edit = z.object({ expectedVersion: z.number().int().positive(), supportingCharacter: AiStorySupportingCharacterMutationInputSchema }).strict();
const Delete = z.object({ expectedVersion: z.number().int().positive() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; storyId: string; supportingCharacterId: string }> }) {
  try { const { id, storyId, supportingCharacterId } = await params; if (![id, storyId, supportingCharacterId].every(isUuid)) return apiError("Invalid Cast identity", "VALIDATION_ERROR", 400); const parsed = Edit.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return apiError("Supporting Character update is invalid", "VALIDATION_ERROR", 400); const context = await resolveAiStoryCastApiScope(id, storyId, true); if (!context) return apiError("Story not found", "NOT_FOUND", 404); return apiSuccess({ supportingCharacter: await new AiStorySupportingCastAuthorityService(context.db).edit(context.scope, supportingCharacterId, parsed.data.supportingCharacter, parsed.data.expectedVersion) }); } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; storyId: string; supportingCharacterId: string }> }) {
  try { const { id, storyId, supportingCharacterId } = await params; if (![id, storyId, supportingCharacterId].every(isUuid)) return apiError("Invalid Cast identity", "VALIDATION_ERROR", 400); const parsed = Delete.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return apiError("Supporting Character deletion is invalid", "VALIDATION_ERROR", 400); const context = await resolveAiStoryCastApiScope(id, storyId, true); if (!context) return apiError("Story not found", "NOT_FOUND", 404); return apiSuccess({ supportingCharacter: await new AiStorySupportingCastAuthorityService(context.db).delete(context.scope, supportingCharacterId, parsed.data.expectedVersion) }); } catch (error) { return handleApiError(error); }
}
