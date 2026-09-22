import { z } from "zod";
import { AiStoryCharacterVirtualizerError } from "@ceo-agent/db";
import { isUuid, publicVirtualizationJob } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext, characterVirtualizerExecutionOptions } from "@/lib/character-virtualizer-access";

const Body = z.object({
  permissionConfirmed: z.literal(true),
  costAuthorized: z.literal(true),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const { id, jobId } = await params;
    if (!isUuid(id) || !isUuid(jobId)) return apiError("Invalid Virtualization job", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Generate Again requires a new paid authorization", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const job = await ctx.service.generateAgain(ctx.scope, {
      parentJobId: jobId,
      permissionConfirmed: true,
      costAuthorized: true,
      ...characterVirtualizerExecutionOptions(id),
    });
    return apiSuccess({ job: publicVirtualizationJob(job) }, job.status === "SUCCEEDED" ? 201 : 422);
  } catch (error) {
    if (error instanceof AiStoryCharacterVirtualizerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
