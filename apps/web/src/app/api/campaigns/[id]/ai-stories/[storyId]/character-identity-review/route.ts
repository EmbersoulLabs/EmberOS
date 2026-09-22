import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@ceo-agent/db";
import { isUuid, rejectIdentityDriftUnit, reviewVisualIdentity } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

const ReviewSchema = z.object({
  generationUnitId: z.string().uuid(),
  reusableCharacterId: z.string().uuid(),
  canonicalAssetId: z.string().uuid(),
  generatedAssetId: z.string().uuid().nullable().optional(),
  siblingGenerationUnitIds: z.array(z.string().uuid()).default([]),
  decision: z.enum(["PASS", "FAIL"]),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const { id, storyId } = await params;
    if (!isUuid(id) || !isUuid(storyId)) return apiError("Invalid Episode", "VALIDATION_ERROR", 400);
    const parsed = ReviewSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Identity review is invalid", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const review = reviewVisualIdentity({
      generationUnitId: parsed.data.generationUnitId,
      reusableCharacterId: parsed.data.reusableCharacterId,
      technicalIdentityLineage: "PASS",
      canonicalAssetId: parsed.data.canonicalAssetId,
      generatedAssetId: parsed.data.generatedAssetId ?? null,
      decision: parsed.data.decision,
    });
    const drift = parsed.data.decision === "FAIL"
      ? rejectIdentityDriftUnit({
          generationUnitId: parsed.data.generationUnitId,
          siblingGenerationUnitIds: parsed.data.siblingGenerationUnitIds,
        })
      : null;
    return apiSuccess({
      review,
      drift,
      retryScope: drift?.retryScope ?? "GENERATION_UNIT",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
