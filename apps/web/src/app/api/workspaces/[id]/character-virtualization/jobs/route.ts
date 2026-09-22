import { z } from "zod";
import { AiStoryCharacterVirtualizerError } from "@ceo-agent/db";
import {
  AiStoryCharacterVirtualStyleSchema,
  isUuid,
  publicVirtualizationJob,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext, characterVirtualizerExecutionOptions } from "@/lib/character-virtualizer-access";

const Body = z.object({
  sourceAssetId: z.string().uuid(),
  style: AiStoryCharacterVirtualStyleSchema.default("PREMIUM_3D"),
  creativeDirection: z.string().trim().max(500).nullable().optional(),
  permissionConfirmed: z.literal(true),
  costAuthorized: z.literal(true),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Virtual Character request is invalid", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const job = await ctx.service.generate(ctx.scope, {
      sourceAssetId: parsed.data.sourceAssetId,
      style: parsed.data.style,
      creativeDirection: parsed.data.creativeDirection ?? null,
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
