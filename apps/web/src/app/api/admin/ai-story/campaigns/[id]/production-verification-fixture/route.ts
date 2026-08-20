import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";
import { createProductionVerificationFixture } from "@/lib/ai-story-production-verification-fixture";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requirePlatformAdmin();
    const raw = await request.text();
    if (raw.trim() && raw.trim() !== "{}") {
      return apiError("Verification fixture accepts an empty object body only", "VALIDATION_ERROR", 422);
    }
    const { id: campaignId } = await params;
    const result = await createProductionVerificationFixture({ campaignId, user });
    return apiSuccess(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
