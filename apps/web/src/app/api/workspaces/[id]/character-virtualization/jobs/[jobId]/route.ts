import { AiStoryCharacterVirtualizerError } from "@ceo-agent/db";
import { isUuid, publicVirtualizationJob } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext } from "@/lib/character-virtualizer-access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const { id, jobId } = await params;
    if (!isUuid(id) || !isUuid(jobId)) return apiError("Invalid Virtualization job", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, false);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const job = await ctx.service.readJob(ctx.scope, jobId);
    return apiSuccess({ job: publicVirtualizationJob(job), lineage: await ctx.service.lineage(ctx.scope, jobId) });
  } catch (error) {
    if (error instanceof AiStoryCharacterVirtualizerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
