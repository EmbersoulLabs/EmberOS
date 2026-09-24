import { z } from "zod";
import { AiStoryCharacterVirtualizerError } from "@ceo-agent/db";
import { isUuid, publicReusableCharacterCard, publicVirtualizationJob } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext } from "@/lib/character-virtualizer-access";

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  targetReusableCharacterId: z.string().uuid().nullable().optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const { id, jobId } = await params;
    if (!isUuid(id) || !isUuid(jobId)) return apiError("Invalid Virtualization job", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Character name is required", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const result = await ctx.service.accept(ctx.scope, {
      jobId,
      name: parsed.data.name,
      targetReusableCharacterId: parsed.data.targetReusableCharacterId ?? null,
    });
    return apiSuccess({
      job: publicVirtualizationJob(result.job),
      character: publicReusableCharacterCard(result.character, 0),
      lineage: result.lineage,
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterVirtualizerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
