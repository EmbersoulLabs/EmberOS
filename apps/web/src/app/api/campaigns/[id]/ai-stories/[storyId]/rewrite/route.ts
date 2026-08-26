import { and, eq, inArray } from "drizzle-orm";
import {
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import { rewriteAiStoryDraft } from "@ceo-agent/agents";
import {
  assessBusinessProfileCompletion,
  isUuid,
  normalizeBusinessProfileRecord,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import {
  assetLabelFromProductionRow,
  campaignPlanningFields,
} from "@/lib/ai-story-production-compat";
import {
  createAiStoryVersion,
  loadCampaignAiStory,
  setAiStoryStatus,
} from "@/lib/ai-story-service";
import { AiStoryStructuredDraftSchema } from "@ceo-agent/shared";

const BodySchema = z.object({
  rewriteBrief: z.string().trim().max(4000).optional(),
  previewOnly: z.boolean().optional().default(false),
  structuredContent: AiStoryStructuredDraftSchema.optional(),
});

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

    const raw = await request.json().catch(() => ({}));
    const body = BodySchema.safeParse(raw);
    if (!body.success) {
      return apiError("Invalid rewrite body", "VALIDATION_ERROR", 400);
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
    if (!loaded.currentVersion) {
      return apiError("Generate or polish a Story Draft before rewrite", "VALIDATION_ERROR", 409);
    }

    const status = loaded.story.status as AiStoryStatus;
    if (!["draft", "review", "failed"].includes(status)) {
      return apiError("Story cannot be rewritten in its current state", "VALIDATION_ERROR", 409);
    }

    if (!body.data.previewOnly) {
      await setAiStoryStatus(db, storyId, status, "generating");
    }

    const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const profile = profileRow
      ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
      : null;
    const completion = profile ? assessBusinessProfileCompletion(profile) : null;
    const draft = body.data.structuredContent ?? AiStoryStructuredDraftSchema.parse(
      loaded.currentVersion.structuredContent
    );
    const assetIds = loaded.assetLinks.map((link) => link.assetId);
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
          ).map((asset) => assetLabelFromProductionRow(asset));

    const rewritten = await rewriteAiStoryDraft({
      draft,
      originalIdea: loaded.story.originalIdea,
      rewriteBrief: body.data.rewriteBrief,
      campaign: campaignPlanningFields(campaign),
      brand: profile
        ? {
            brandName: profile.companyName,
            brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
            targetAudience: profile.targetAudience,
            industry:
              profile.industryDisplayName || profile.industryCustomValue || null,
            description: profile.businessDescription,
          }
        : null,
      assetLabels,
    });

    if (!rewritten.ok) {
      if (!body.data.previewOnly) {
        await setAiStoryStatus(db, storyId, "generating", "failed");
      }
      return apiError(rewritten.error, "AI_GENERATION_FAILED", 502);
    }

    const nextDraft = {
      ...rewritten.draft,
      assetReferences: assetIds,
      warnings: [
        ...(completion?.complete === false
          ? ["Business Profile is incomplete — rewrite may be less on-brand."]
          : []),
        ...rewritten.draft.warnings,
      ],
    };

    if (body.data.previewOnly) {
      return apiSuccess({
        storyId,
        status,
        previewOnly: true,
        draft: nextDraft,
      });
    }

    const version = await createAiStoryVersion(db, {
      storyId,
      structuredContent: nextDraft,
      sourceContextSnapshot: {
        campaignId,
        workspaceId: campaign.workspaceId,
        assetIds,
        action: "rewrite",
        rewriteBrief: body.data.rewriteBrief ?? null,
      },
      aiMetadata: {
        provider: "json-generation",
        action: "rewrite",
        costUsd: rewritten.usage.costUsd,
        inputTokens: rewritten.usage.input,
        outputTokens: rewritten.usage.output,
      },
      createdBy: user.id,
    });

    await setAiStoryStatus(db, storyId, "generating", "review");
    return apiSuccess({
      storyId,
      status: "review",
      version,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
