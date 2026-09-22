import {
  AiStoryCharacterVirtualStyleSchema,
  characterVirtualizationCostEstimate,
  isUuid,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { characterVirtualizerContext } from "@/lib/character-virtualizer-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const ctx = await characterVirtualizerContext(id, false);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const style = AiStoryCharacterVirtualStyleSchema.catch("PREMIUM_3D").parse(
      new URL(request.url).searchParams.get("style") ?? "PREMIUM_3D"
    );
    return apiSuccess({ estimate: characterVirtualizationCostEstimate(style), category: "CHARACTER_VIRTUALIZATION" });
  } catch (error) {
    return handleApiError(error);
  }
}
