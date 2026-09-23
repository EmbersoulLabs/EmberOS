import { z } from "zod";
import { AiStoryCharacterDnaError, AiStoryReusableCharacterError } from "@ceo-agent/db";
import { AiStoryCharacterDnaSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterDnaContext } from "@/lib/character-dna-access";

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  approvedDna: AiStoryCharacterDnaSchema,
  targetReusableCharacterId: z.string().uuid().nullable().optional(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  try {
    const { id, jobId } = await params;
    if (!isUuid(id) || !isUuid(jobId)) return apiError("Invalid Character DNA job", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Reviewed Character DNA is invalid", "VALIDATION_ERROR", 400);
    const ctx = await characterDnaContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const result = await ctx.service.save(ctx.scope, {
      jobId,
      name: parsed.data.name,
      approvedDna: parsed.data.approvedDna,
      targetReusableCharacterId: parsed.data.targetReusableCharacterId,
    });
    return apiSuccess(result, 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterDnaError || error instanceof AiStoryReusableCharacterError) {
      return apiError(error.message, error.code, 409);
    }
    return handleApiError(error);
  }
}
