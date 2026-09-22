import { z } from "zod";
import { AiStoryCharacterVirtualizerError } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext } from "@/lib/character-virtualizer-access";

const Body = z.object({ assetId: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Source portrait is invalid", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const asset = await ctx.service.registerSourcePortrait(ctx.scope, parsed.data.assetId);
    return apiSuccess({
      sourceAssetId: asset.id,
      semantic: "CHARACTER_SOURCE_PORTRAIT",
      contentHash: asset.contentHash,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterVirtualizerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
