import { eq } from "drizzle-orm";
import {
  ApprovedAnimationPackageAuthorityError,
  ensureCurrentEpisodeDispatchAuthorityProjection,
  getDb,
  PlatformAdminRepositoryImpl,
  prepareEpisodePlanningExecutionReadiness,
  requireActivePlatformAdminAssignment,
  resolveCurrentFrozenCanonicalSceneSet,
  schema,
} from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  assessExecutionUnitDurations,
  AuthoritativeAnimationPackagePayloadSchema,
  EpisodeProjectedAuthorityError,
  isUuid,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { NextResponse } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  approveAnimationPackage,
  getLatestCompleteAnimationPackageForStory,
} from "@/lib/ai-story-planning-service";
import { AiStoryExecutionCapabilityError, fetchLocalGpuPlanningCapabilityAuthority } from "@/lib/ai-story-execution-capability";
import { revalidatePlanningProductMaterialAuthority } from "@/lib/ai-story-product-material-runtime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const body = await request.json().catch(() => null) as { executionEnvironment?: unknown } | null;
    if (body?.executionEnvironment !== "LOCAL_GPU") {
      return apiError(
        "Select and verify an execution environment before approving Planning",
        "PLANNING_EXECUTION_ENVIRONMENT_REQUIRED",
        422
      );
    }
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (status !== "planning_review") {
      return apiError("Story must be in planning review before approval", "VALIDATION_ERROR", 409);
    }

    const animationPackage = await getLatestCompleteAnimationPackageForStory(db, {
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });
    if (!animationPackage) {
      return apiError(
        "Complete Animation Package not found — finish planning stages first",
        "NOT_FOUND",
        404
      );
    }
    const executionUnitDurations = assessExecutionUnitDurations(
      AnimationPackagePayloadSchema.parse(animationPackage.payload),
    );
    if (executionUnitDurations.status !== "COMPLIANT") {
      return NextResponse.json({
        error: "Planning contains Scenes outside the certified whole-second generation range.",
        code: "PLANNING_EXECUTION_UNIT_DURATION_UNSUPPORTED",
        executionUnitDurations,
      }, { status: 409 });
    }
    const scope = {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
    };
    const readiness = await prepareEpisodePlanningExecutionReadiness(scope, animationPackage.id, db);
    if (readiness.status !== "PASS") {
      return NextResponse.json({
        error: "Planning is not execution-ready. Resolve the consolidated creative decisions before approval.",
        code: "PLANNING_EXECUTION_READINESS_BLOCKED",
        readiness,
      }, { status: 409 });
    }
    const canonicalScenes = await resolveCurrentFrozenCanonicalSceneSet(db, scope);
    if (!canonicalScenes) {
      throw new EpisodeProjectedAuthorityError(
        "EPISODE_DISPATCH_SOURCE_MISSING",
        "Planning approval lost the current FROZEN Canonical Scene set",
      );
    }
    const productMaterial = await revalidatePlanningProductMaterialAuthority({
      ...scope,
      canonicalScenes,
    });
    const assignment = await requireActivePlatformAdminAssignment({
      userId: user.id,
      email: user.email,
      repository: new PlatformAdminRepositoryImpl(),
    });
    const parsedPackage = AuthoritativeAnimationPackagePayloadSchema.parse(animationPackage.payload);
    const executionCapabilityAuthority = await fetchLocalGpuPlanningCapabilityAuthority({
      userId: user.id,
      workspaceId: campaign.workspaceId,
      assignment,
      scenePlan: parsedPackage.scenePlan,
    });
    const approvedPackage = await approveAnimationPackage(db, {
      packageId: animationPackage.id,
      orgId: campaign.orgId,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
      approvedBy: user.id,
      executionCapabilityAuthority,
      expectedProductMaterialFingerprint: productMaterial.fingerprint,
    });
    const frozen = await ensureCurrentEpisodeDispatchAuthorityProjection(scope, db);
    if (
      frozen.directorFingerprint !== readiness.directorFingerprint
      || frozen.motionFingerprint !== readiness.motionFingerprint
    ) {
      return apiError(
        "Validated execution authority changed during approval; reload and review the current plan",
        "PLANNING_EXECUTION_AUTHORITY_STALE",
        409
      );
    }
    await setAiStoryStatus(db, storyId, "planning_review", "ready_for_execution");

    return apiSuccess({
      storyId,
      status: "ready_for_execution",
      animationPackage: approvedPackage,
      readiness,
    });
  } catch (error) {
    if (error instanceof AiStoryExecutionCapabilityError) return apiError(error.message, error.code, 409);
    if (error instanceof EpisodeProjectedAuthorityError) return apiError(error.message, error.code, 409);
    if (error instanceof ApprovedAnimationPackageAuthorityError) return apiError(error.message, error.code, error.status);
    return handleApiError(error);
  }
}
