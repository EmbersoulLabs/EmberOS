import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  aiStoryEpisodeRevisionCapability,
  isUuid,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { apiError, apiSuccess } from "@/lib/api";
import {
  AiStoryEpisodeRevisionError,
  planAiStoryEpisodeRevision,
} from "@ceo-agent/shared/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
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
    await authorizeAiStoryAccess({
      user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "reviewer",
    });
    return apiSuccess({
      capability: aiStoryEpisodeRevisionCapability(),
      persistDurableScript: false,
      providerCalls: 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
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
    await authorizeAiStoryAccess({
      user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "operator",
    });
    const body = (await request.json()) as {
      snapshot?: Parameters<typeof planAiStoryEpisodeRevision>[0];
    };
    if (!body.snapshot) {
      return apiError(
        "Episode revision requires the frozen Script, Generation Unit, Editorial, and Assembly snapshot",
        "REVISION_SNAPSHOT_REQUIRED",
        409
      );
    }
    const planned = planAiStoryEpisodeRevision({
      ...body.snapshot,
      createdBy: body.snapshot.createdBy || user.id,
    });
    return apiSuccess({
      userStatus: planned.userStatus,
      historyEntry: planned.historyEntry,
      impact: {
        impactedGenerationUnitIds: planned.impact.impactedGenerationUnitIds,
        preservedGenerationUnitIds: planned.impact.preservedGenerationUnitIds,
        requiresProviderExecution: planned.impact.requiresProviderExecution,
      },
      executionPlan: planned.executionPlan,
      revisionCostEstimate: planned.revisionCostEstimate,
      liveEpisodeCostEstimate: planned.liveEpisodeCostEstimate,
      nextScript: planned.nextScript,
      nextEditorialPlan: {
        editorialPlanId: planned.nextEditorialPlan.editorialPlanId,
        version: planned.nextEditorialPlan.version,
        editorialFingerprint: planned.nextEditorialPlan.editorialFingerprint,
      },
      assemblyFingerprint: planned.assemblyPlan.assemblyFingerprint,
      costEstimateAuthorizesSpend: false,
      providerCalls: 0,
      persistDurableScript: false,
    });
  } catch (error) {
    if (error instanceof AiStoryEpisodeRevisionError) {
      const status =
        error.code === "REGENERATE_APPROVED_MOMENT_DENIED" ||
        error.code === "ENDING_REVISION_SCOPE_GATE" ||
        error.code === "REFERENCE_REVISION_IMPACT_GATE" ||
        error.code === "COMMERCIAL_AUTHORIZATION_REQUIRED"
          ? 409
          : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return handleApiError(error);
  }
}
