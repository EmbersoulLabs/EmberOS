import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  getDb,
  persistAiStoryEpisodeRevision,
  schema,
  AiStoryEpisodeRevisionPersistenceError,
  AiStoryEpisodeRevisionPersistenceService,
} from "@ceo-agent/db";
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
    const current = await new AiStoryEpisodeRevisionPersistenceService().readCurrent({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      actorUserId: user.id,
    });
    const history = current
      ? await new AiStoryEpisodeRevisionPersistenceService().history({
          orgId: campaign.orgId,
          workspaceId: campaign.workspaceId,
          campaignId,
          storyId,
          actorUserId: user.id,
        })
      : [];
    return apiSuccess({
      capability: aiStoryEpisodeRevisionCapability(),
      persistDurableScript: true,
      providerCalls: 0,
      current: current
        ? {
            version: current.current.revisionVersion,
            scriptVersionId: current.current.scriptVersionId,
            storyVersionId: current.current.storyVersionId,
            editorialPlanId: current.current.editorialPlanId,
          }
        : null,
      history: history.map((row) => ({
        version: row.revisionVersion,
        summary: row.impactSummary,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
      })),
    });
  } catch (error) {
    if (error instanceof AiStoryEpisodeRevisionPersistenceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "REVISION_SCOPE_DENIED" ? 403 : 409 }
      );
    }
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
      persist?: boolean;
      snapshot?: Parameters<typeof planAiStoryEpisodeRevision>[0];
      expectedScriptVersionId?: string;
      expectedStoryVersionId?: string;
      expectedEditorialPlanId?: string;
      expectedReferenceFingerprint?: string;
      idempotencyKey?: string;
    };
    if (!body.snapshot) {
      return apiError(
        "Episode revision requires the frozen Script, Generation Unit, Editorial, and Assembly snapshot",
        "REVISION_SNAPSHOT_REQUIRED",
        409
      );
    }
    if (body.persist === true) {
      const persisted = await persistAiStoryEpisodeRevision({
        scope: {
          orgId: campaign.orgId,
          workspaceId: campaign.workspaceId,
          campaignId,
          storyId,
          actorUserId: user.id,
        },
        snapshot: {
          ...body.snapshot,
          createdBy: body.snapshot.createdBy || user.id,
        },
        expectedScriptVersionId: body.expectedScriptVersionId,
        expectedStoryVersionId: body.expectedStoryVersionId,
        expectedEditorialPlanId: body.expectedEditorialPlanId,
        expectedReferenceFingerprint: body.expectedReferenceFingerprint,
        idempotencyKey: body.idempotencyKey,
      });
      return apiSuccess({
        userStatus: persisted.userStatus,
        historyEntry: persisted.historyEntry,
        revisionId: persisted.revisionId,
        status: persisted.status,
        current: persisted.current,
        lineage: persisted.lineage,
        impact: {
          impactedGenerationUnitIds: persisted.impact.impactedGenerationUnitIds,
          preservedGenerationUnitIds: persisted.impact.preservedGenerationUnitIds,
          requiresProviderExecution: persisted.impact.requiresProviderExecution,
          requiresAssemblyRebuild: persisted.impact.requiresAssemblyRebuild,
        },
        executionPlan: persisted.executionPlan,
        revisionCostEstimate: persisted.revisionCostEstimate,
        liveEpisodeCostEstimate: persisted.liveEpisodeCostEstimate,
        nextScript: persisted.nextScript
          ? {
              scriptVersionId: persisted.nextScript.scriptVersionId,
              version: persisted.nextScript.version,
              sourceHash: persisted.nextScript.sourceHash,
            }
          : null,
        nextEditorialPlan: {
          editorialPlanId: persisted.nextEditorialPlan.editorialPlanId,
          version: persisted.nextEditorialPlan.version,
          editorialFingerprint: persisted.nextEditorialPlan.editorialFingerprint,
        },
        commercialAuthorizationStatus: persisted.commercialAuthorizationStatus,
        costEstimateAuthorizesSpend: false,
        spendAuthorizationCreated: false,
        providerCalls: 0,
        persistDurableScript: true,
        persisted: true,
      });
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
      persistDurableScript: true,
      persisted: false,
    });
  } catch (error) {
    if (error instanceof AiStoryEpisodeRevisionPersistenceError) {
      const status =
        error.code === "REVISION_SCOPE_DENIED"
          ? 403
          : error.code === "REVISION_SOURCE_VERSION_CONFLICT"
            ? 409
            : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof AiStoryEpisodeRevisionError) {
      const status =
        error.code === "REGENERATE_APPROVED_MOMENT_DENIED" ||
        error.code === "ENDING_REVISION_SCOPE_GATE" ||
        error.code === "REFERENCE_REVISION_IMPACT_GATE" ||
        error.code === "COMMERCIAL_AUTHORIZATION_REQUIRED" ||
        error.code === "REVISION_SOURCE_VERSION_CONFLICT"
          ? 409
          : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return handleApiError(error);
  }
}
