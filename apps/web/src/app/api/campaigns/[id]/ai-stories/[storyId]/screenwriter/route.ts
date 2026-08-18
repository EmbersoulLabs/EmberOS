import { eq } from "drizzle-orm";
import {
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  generateStoryCharacters,
  generateStoryDialogue,
  generateStoryNarrative,
  mergeCharactersIntoCreativeContext,
  mergeDialogueIntoCreativeContext,
  mergeNarrativeIntoCreativeContext,
} from "@ceo-agent/agents";
import {
  AiStoryStructuredDraftSchema,
  CreativeContextSchema,
  isUuid,
  normalizeBusinessProfileRecord,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { campaignPlanningFields } from "@/lib/ai-story-production-compat";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  loadLatestCreativeContextForStory,
  saveCreativeContext,
} from "@/lib/ai-story-planning-service";

const BodySchema = z.object({
  action: z.enum(["characters", "dialogue", "narrative"]),
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
      return apiError(
        "action must be characters | dialogue | narrative",
        "VALIDATION_ERROR",
        400
      );
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
      return apiError("Story Draft required", "VALIDATION_ERROR", 409);
    }

    const status = loaded.story.status as AiStoryStatus;
    if (
      ![
        "ready_for_animation",
        "planning",
        "planning_review",
        "ready_for_execution",
      ].includes(status)
    ) {
      return apiError(
        "Approve Story before Screenwriter Creative Context enrichment",
        "VALIDATION_ERROR",
        409
      );
    }

    const story = AiStoryStructuredDraftSchema.parse(
      loaded.currentVersion.structuredContent
    );
    const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const profile = profileRow
      ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
      : null;
    const brand = profile
      ? {
          brandName: profile.companyName,
          brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
          targetAudience: profile.targetAudience,
          industry:
            profile.industryDisplayName || profile.industryCustomValue || null,
          description: profile.businessDescription,
        }
      : null;
    const campaignCtx = campaignPlanningFields(campaign);

    const existing = await loadLatestCreativeContextForStory(db, {
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });
    let creativeContext = existing
      ? CreativeContextSchema.parse(existing.payload)
      : CreativeContextSchema.parse({
          storyContext: {
            title: story.title,
            summary: story.summary,
            objective: story.objective,
            targetAudience: story.targetAudience,
            tone: story.tone,
            estimatedDuration: story.estimatedDuration,
            keyMessages: story.keyMessages,
            cta: story.cta,
          },
          characterContext: { characters: [], relationships: [] },
          worldContext: {
            locations: [],
            visualStyle: "",
            lighting: "",
            environment: "",
            objects: [],
            timeline: "",
            worldRules: [],
          },
          narrativeContext: {
            arc: "",
            pacing: "",
            emotionalJourney: "",
            themes: [],
            dialogue: [],
          },
          directorContext: {},
        });

    if (body.data.action === "characters") {
      const generated = await generateStoryCharacters({
        story,
        creativeContext,
        campaign: campaignCtx,
        brand,
      });
      creativeContext = mergeCharactersIntoCreativeContext(
        creativeContext,
        generated.characters,
        generated.relationships
      );
    } else if (body.data.action === "dialogue") {
      if (creativeContext.characterContext.characters.length === 0) {
        return apiError(
          "Generate characters before dialogue",
          "VALIDATION_ERROR",
          409
        );
      }
      const generated = await generateStoryDialogue({
        story,
        creativeContext,
        campaign: campaignCtx,
      });
      creativeContext = mergeDialogueIntoCreativeContext(
        creativeContext,
        generated.dialogue
      );
    } else {
      const generated = await generateStoryNarrative({
        story,
        creativeContext,
        campaign: campaignCtx,
      });
      creativeContext = mergeNarrativeIntoCreativeContext(
        creativeContext,
        generated.narrative
      );
    }

    const saved = await saveCreativeContext(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      payload: creativeContext,
    });

    return apiSuccess({
      storyId,
      action: body.data.action,
      creativeContext: saved,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
