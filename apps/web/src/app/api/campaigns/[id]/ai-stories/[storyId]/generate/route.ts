import { and, eq, inArray } from "drizzle-orm";
import {
  getDb,
  schema,
  getBusinessProfileByWorkspace,
} from "@ceo-agent/db";
import {
  assessBusinessProfileCompletion,
  isUuid,
  normalizeBusinessProfileRecord,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { polishAiStoryDraft } from "@ceo-agent/agents";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import {
  beginAiStoryPlanningAccounting,
  buildAiStoryPlanningLedgerIdentity,
  persistAiStoryPlanningOutcome,
} from "@/lib/ai-story-planning-accounting";
import {
  assetLabelFromProductionRow,
  campaignPlanningFields,
} from "@/lib/ai-story-production-compat";
import { apiSuccess, apiError } from "@/lib/api";
import {
  createAiStoryVersion,
  loadCampaignAiStory,
  setAiStoryStatus,
} from "@/lib/ai-story-service";

export async function POST(
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
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (!["draft", "review", "failed"].includes(status)) {
      return apiError("Story cannot be polished in its current state", "VALIDATION_ERROR", 409);
    }

    const [claimedStory] = await db
      .update(schema.aiStories)
      .set({ status: "generating", updatedAt: new Date() })
      .where(
        and(
          eq(schema.aiStories.id, storyId),
          eq(schema.aiStories.status, status)
        )
      )
      .returning({ id: schema.aiStories.id });
    if (!claimedStory) {
      return apiError("Story planning is already in progress", "CONFLICT", 409);
    }

    const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const profile = profileRow
      ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
      : null;
    const completion = profile ? assessBusinessProfileCompletion(profile) : null;

    const assetIds = loaded.assetLinks.map((l) => l.assetId);
    const assetLabels =
      assetIds.length === 0
        ? []
        : (
            await db
              .select({
                id: schema.assets.id,
                storagePath: schema.assets.storagePath,
                metadata: schema.assets.metadata,
              })
              .from(schema.assets)
              .where(
                and(
                  eq(schema.assets.workspaceId, campaign.workspaceId),
                  inArray(schema.assets.id, assetIds)
                )
              )
          ).map((a) => assetLabelFromProductionRow(a));

    const accountingIdentity = buildAiStoryPlanningLedgerIdentity({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      runSeed: loaded.story.updatedAt.toISOString(),
      requestMaterial: {
        storyId,
        originalIdea: loaded.story.originalIdea,
        campaign: campaignPlanningFields(campaign),
        businessProfileId: profileRow?.id ?? null,
        assetIds,
      },
      startedAt: new Date().toISOString(),
    });
    try {
      await beginAiStoryPlanningAccounting(db, accountingIdentity);
    } catch {
      await db
        .update(schema.aiStories)
        .set({ status: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(schema.aiStories.id, storyId),
            eq(schema.aiStories.status, "generating")
          )
        );
      throw new Error("AI_STORY_PLANNING_ACCOUNTING_INITIALIZATION_FAILED");
    }

    const polish = await polishAiStoryDraft({
      originalIdea: loaded.story.originalIdea,
      campaign: {
        ...campaignPlanningFields(campaign),
      },
      businessProfile: profile
        ? {
            brandName: profile.companyName,
            brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
            targetAudience: profile.targetAudience,
            industry:
              profile.industryDisplayName ||
              profile.industryCustomValue ||
              null,
            description: profile.businessDescription,
          }
        : null,
      assetLabels,
      businessProfileComplete: completion?.complete,
    });

    if (!polish.ok) {
      const persistence = await persistAiStoryPlanningOutcome({
        db,
        storyId,
        identity: accountingIdentity,
        status: "TERMINAL_FAILURE",
        failureCode: polish.failureCode,
        errorStage: polish.errorStage,
        validationIssueCodes: polish.validationIssueCodes,
        accounting: polish.accounting,
        timings: polish.timings,
        completedAt: new Date().toISOString(),
      });
      console.info("[ai-story-planning] terminal", {
        storyId,
        executionId: accountingIdentity.executionId,
        errorStage: polish.errorStage,
        validationIssueCount: polish.validationIssueCodes.length,
        planningProviderMs: polish.timings.planningProviderMs,
        planningDecodeMs: polish.timings.planningDecodeMs,
        planningValidationMs: polish.timings.planningValidationMs,
        planningUsagePersistMs: persistence.usagePersistMs,
        planningCostPersistMs: persistence.costPersistMs,
        planningFailurePersistMs: persistence.failurePersistMs,
      });
      return apiError(polish.error, polish.failureCode, 502);
    }

    const persistence = await persistAiStoryPlanningOutcome({
      db,
      storyId,
      identity: accountingIdentity,
      status: "SUCCEEDED",
      accounting: polish.accounting,
      timings: polish.timings,
      completedAt: new Date().toISOString(),
    });

    const draft = {
      ...polish.draft,
      assetReferences: assetIds,
      warnings: [
        ...polish.warnings.map((w) => w.message),
        ...polish.draft.warnings,
      ],
    };

    let version;
    try {
      version = await createAiStoryVersion(db, {
        storyId,
        structuredContent: draft,
        sourceContextSnapshot: {
          campaignId,
          workspaceId: campaign.workspaceId,
          assetIds,
          warnings: polish.warnings,
        },
        aiMetadata: {
          provider: "json-generation",
          providerId: polish.accounting.provider,
          model: polish.accounting.model,
          providerRequestId: polish.accounting.providerRequestId,
          planningExecutionId: accountingIdentity.executionId,
          costUsd: polish.usage.costUsd,
          costSource: polish.accounting.cost.costSource,
          inputTokens: polish.usage.input,
          outputTokens: polish.usage.output,
        },
        createdBy: user.id,
      });

      await setAiStoryStatus(db, storyId, "generating", "review");
    } catch (error) {
      await db
        .update(schema.aiStories)
        .set({ status: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(schema.aiStories.id, storyId),
            eq(schema.aiStories.status, "generating")
          )
        );
      console.error("[ai-story-planning] application_persistence_failure", {
        storyId,
        executionId: accountingIdentity.executionId,
      });
      throw error;
    }
    console.info("[ai-story-planning] succeeded", {
      storyId,
      executionId: accountingIdentity.executionId,
      planningProviderMs: polish.timings.planningProviderMs,
      planningDecodeMs: polish.timings.planningDecodeMs,
      planningValidationMs: polish.timings.planningValidationMs,
      planningUsagePersistMs: persistence.usagePersistMs,
      planningCostPersistMs: persistence.costPersistMs,
    });

    return apiSuccess({
      storyId,
      status: "review",
      version,
      warnings: polish.warnings,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
