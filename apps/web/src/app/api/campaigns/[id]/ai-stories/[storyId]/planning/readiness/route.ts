import { eq } from "drizzle-orm";
import { getDb, PlatformAdminRepositoryImpl, prepareEpisodePlanningExecutionReadiness, requireActivePlatformAdminAssignment, schema } from "@ceo-agent/db";
import { AuthoritativeAnimationPackagePayloadSchema, EpisodeProjectedAuthorityError, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import { getLatestCompleteAnimationPackageForStory } from "@/lib/ai-story-planning-service";
import { AiStoryExecutionCapabilityError, fetchLocalGpuPlanningCapabilityAuthority } from "@/lib/ai-story-execution-capability";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    if (new URL(request.url).searchParams.get("executionEnvironment") !== "LOCAL_GPU") {
      return apiError("Select an execution environment", "PLANNING_EXECUTION_ENVIRONMENT_REQUIRED", 422);
    }
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid id", "VALIDATION_ERROR", 400);
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    const animationPackage = await getLatestCompleteAnimationPackageForStory(db, { campaignId, storyId, workspaceId: campaign.workspaceId });
    if (!animationPackage) return apiError("Complete Animation Package not found — finish planning stages first", "NOT_FOUND", 404);
    const readiness = await prepareEpisodePlanningExecutionReadiness({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
    }, animationPackage.id, db);
    if (readiness.status === "PASS") {
      try {
        const assignment = await requireActivePlatformAdminAssignment({
          userId: user.id,
          email: user.email,
          repository: new PlatformAdminRepositoryImpl(),
        });
        const payload = AuthoritativeAnimationPackagePayloadSchema.parse(animationPackage.payload);
        await fetchLocalGpuPlanningCapabilityAuthority({
          userId: user.id,
          workspaceId: campaign.workspaceId,
          assignment,
          scenePlan: payload.scenePlan,
        });
      } catch (error) {
        const code = error instanceof AiStoryExecutionCapabilityError
          ? error.code
          : "PLANNING_EXECUTION_CAPABILITIES_UNAVAILABLE";
        const message = error instanceof Error ? error.message : "Execution capability evidence is unavailable";
        return apiSuccess({ readiness: {
          ...readiness,
          status: "BLOCK" as const,
          findings: [...readiness.findings, {
            code,
            classification: "MISSING_EVIDENCE" as const,
            owner: "DIRECTOR" as const,
            scope: "STORY" as const,
            scriptSceneIds: [],
            message,
          }],
        } });
      }
    }
    return apiSuccess({ readiness });
  } catch (error) {
    if (error instanceof EpisodeProjectedAuthorityError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
