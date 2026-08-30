/**
 * Stage-by-stage AI Story planning runner (persists Creative Context + drafts).
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  buildAnimationPackage,
  generateCharacterContinuity,
  generateCreativeContext,
  generateDirectorThinking,
  generateScenePlan,
  generateShotPlan,
  generateStoryBeats,
  generateWorldContinuity,
} from "@ceo-agent/agents";
import {
  AiStoryStructuredDraftSchema,
  STORY_PLANNING_STAGE_ORDER,
  assessBusinessProfileCompletion,
  normalizeBusinessProfileRecord,
  prunePlanningDraftAfterStage,
  type AiStoryStructuredDraft,
  type PlanningUsage,
  type StoryPlanningDraft,
  type StoryPlanningStage,
} from "@ceo-agent/shared";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  assetLabelFromProductionRow,
  campaignPlanningFields,
} from "@/lib/ai-story-production-compat";
import {
  getLatestAnimationPackageForStory,
  loadLatestCreativeContextForStory,
  readPlanningDraftFromPackage,
  saveAnimationPackage,
  saveCreativeContext,
  savePlanningDraft,
} from "@/lib/ai-story-planning-service";

type Db = ReturnType<typeof getDb>;

function emptyUsage(): PlanningUsage {
  return { input: 0, output: 0, costUsd: 0 };
}

function addUsage(a: PlanningUsage, b: PlanningUsage): PlanningUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd + b.costUsd,
  };
}

function requireStage(
  draft: StoryPlanningDraft,
  stage: StoryPlanningStage,
  predicate: boolean,
  message: string
): void {
  if (!predicate) {
    throw new Error(message);
  }
  void draft;
  void stage;
}

async function loadPlanningContext(db: Db, campaignId: string, storyId: string) {
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found");

  const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
  if (!loaded) throw new Error("AI Story not found");
  if (!loaded.currentVersion) throw new Error("No frozen Story Draft found for planning");
  if (!loaded.currentVersion.frozenAt) {
    throw new Error("Story Version must be frozen before planning");
  }

  const storyDraft = AiStoryStructuredDraftSchema.parse(
    loaded.currentVersion.structuredContent
  );

  const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
  const profile = profileRow
    ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
    : null;
  const completion = profile ? assessBusinessProfileCompletion(profile) : null;

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

  return {
    campaign: {
      ...campaign,
      ...campaignPlanningFields(campaign),
    },
    loaded,
    storyDraft,
    brand: profile
      ? {
          brandName: profile.companyName,
          brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
          targetAudience: profile.targetAudience,
          industry:
            profile.industryDisplayName || profile.industryCustomValue || null,
          description: profile.businessDescription,
          values: profile.brandValues,
          style: profile.brandStyle,
        }
      : null,
    assetLabels: [
      ...assetLabels,
      ...(completion?.complete === false
        ? ["Business Profile incomplete; keep brand assumptions explicit."]
        : []),
    ],
  };
}

function baseDraft(storyDraft: AiStoryStructuredDraft): StoryPlanningDraft {
  return {
    kind: "planning_draft",
    completedStages: [],
    story: storyDraft,
    usage: emptyUsage(),
  };
}

export async function runSinglePlanningStage(input: {
  db: Db;
  campaignId: string;
  storyId: string;
  stage: StoryPlanningStage;
  storyStatus: string;
}): Promise<{
  status: string;
  stage: StoryPlanningStage;
  completedStages: StoryPlanningStage[];
  creativeContext: Awaited<ReturnType<typeof saveCreativeContext>> | null;
  animationPackage: Awaited<ReturnType<typeof saveAnimationPackage>>;
  planningDraft: StoryPlanningDraft | null;
}> {
  const { db, campaignId, storyId, stage } = input;
  if (!(STORY_PLANNING_STAGE_ORDER as readonly string[]).includes(stage)) {
    throw new Error(`Unknown planning stage: ${stage}`);
  }

  const ctx = await loadPlanningContext(db, campaignId, storyId);
  if (["ready_for_animation", "planning_review", "failed"].includes(input.storyStatus)) {
    await setAiStoryStatus(
      db,
      storyId,
      input.storyStatus as "ready_for_animation" | "planning_review" | "failed",
      "planning"
    );
  } else if (input.storyStatus !== "planning") {
    throw new Error("Story cannot enter planning in its current state");
  }

  const latestPackage = await getLatestAnimationPackageForStory(db, {
    campaignId,
    storyId,
    workspaceId: ctx.campaign.workspaceId,
  });
  const latestContext = await loadLatestCreativeContextForStory(db, {
    campaignId,
    storyId,
    workspaceId: ctx.campaign.workspaceId,
  });

  let draft =
    readPlanningDraftFromPackage(latestPackage) ??
    baseDraft(ctx.storyDraft);
  draft = {
    ...prunePlanningDraftAfterStage(draft, stage),
    story: ctx.storyDraft,
  };
  if (stage !== "creative_context" && !draft.creativeContext && latestContext?.payload) {
    draft = {
      ...draft,
      creativeContext: latestContext.payload,
      completedStages: draft.completedStages.includes("creative_context")
        ? draft.completedStages
        : (["creative_context", ...draft.completedStages] as StoryPlanningStage[]),
    };
  }

  let usage = draft.usage ?? emptyUsage();
  let savedContext: Awaited<ReturnType<typeof saveCreativeContext>> | null = null;

  switch (stage) {
    case "creative_context": {
      const generated = await generateCreativeContext(
        ctx.storyDraft,
        {
          id: ctx.campaign.id,
          name: ctx.campaign.name,
          objective: ctx.campaign.objective,
          objectiveCustom: ctx.campaign.objectiveCustom,
          targetAudienceOverride: ctx.campaign.targetAudienceOverride,
          campaignBrief: ctx.campaign.campaignBrief,
          goal: ctx.campaign.goal,
          platforms: ctx.campaign.platforms,
        },
        ctx.brand,
        ctx.assetLabels
      );
      usage = addUsage(usage, generated.usage);
      savedContext = await saveCreativeContext(db, {
        orgId: ctx.campaign.orgId,
        workspaceId: ctx.campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: ctx.loaded.currentVersion!.id,
        payload: generated.creativeContext,
      });
      draft = {
        ...draft,
        creativeContext: generated.creativeContext,
        completedStages: ["creative_context"],
        usage,
      };
      break;
    }
    case "director_thinking": {
      requireStage(
        draft,
        stage,
        Boolean(draft.creativeContext),
        "Generate Creative Context before Director Thinking"
      );
      const generated = await generateDirectorThinking(
        ctx.storyDraft,
        draft.creativeContext!
      );
      usage = addUsage(usage, generated.usage);
      const mergedContext = {
        ...draft.creativeContext!,
        directorContext: generated.directorThinking,
      };
      savedContext = await saveCreativeContext(db, {
        orgId: ctx.campaign.orgId,
        workspaceId: ctx.campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: ctx.loaded.currentVersion!.id,
        payload: mergedContext,
      });
      draft = {
        ...draft,
        creativeContext: mergedContext,
        directorThinking: generated.directorThinking,
        completedStages: ["creative_context", "director_thinking"],
        usage,
      };
      break;
    }
    case "story_beats": {
      requireStage(
        draft,
        stage,
        Boolean(draft.creativeContext && draft.directorThinking),
        "Generate Director Thinking before Story Beats"
      );
      const generated = await generateStoryBeats({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
      });
      usage = addUsage(usage, generated.usage);
      draft = {
        ...draft,
        storyBeats: generated.storyBeats,
        completedStages: ["creative_context", "director_thinking", "story_beats"],
        usage,
      };
      break;
    }
    case "scene_plan": {
      requireStage(
        draft,
        stage,
        Boolean(draft.storyBeats?.length),
        "Generate Story Beats before Scene Plan"
      );
      const generated = await generateScenePlan({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
      });
      usage = addUsage(usage, generated.usage);
      draft = {
        ...draft,
        scenePlan: generated.scenePlan,
        completedStages: [
          "creative_context",
          "director_thinking",
          "story_beats",
          "scene_plan",
        ],
        usage,
      };
      break;
    }
    case "shot_plan": {
      requireStage(
        draft,
        stage,
        Boolean(draft.scenePlan?.length),
        "Generate Scene Plan before Shot Plan"
      );
      const generated = await generateShotPlan({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
      });
      usage = addUsage(usage, generated.usage);
      draft = {
        ...draft,
        shotPlan: generated.shotPlan,
        completedStages: [
          "creative_context",
          "director_thinking",
          "story_beats",
          "scene_plan",
          "shot_plan",
        ],
        usage,
      };
      break;
    }
    case "character_continuity": {
      requireStage(
        draft,
        stage,
        Boolean(draft.shotPlan?.length),
        "Generate Shot Plan before Character Continuity"
      );
      const generated = await generateCharacterContinuity({
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        shotPlan: draft.shotPlan!,
      });
      usage = addUsage(usage, generated.usage);
      draft = {
        ...draft,
        characterContinuity: generated.characterContinuity,
        completedStages: [
          "creative_context",
          "director_thinking",
          "story_beats",
          "scene_plan",
          "shot_plan",
          "character_continuity",
        ],
        usage,
      };
      break;
    }
    case "world_continuity": {
      requireStage(
        draft,
        stage,
        draft.characterContinuity !== undefined,
        "Generate Character Continuity before World Continuity"
      );
      const generated = await generateWorldContinuity({
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        shotPlan: draft.shotPlan!,
      });
      usage = addUsage(usage, generated.usage);
      draft = {
        ...draft,
        worldContinuity: generated.worldContinuity,
        completedStages: [
          "creative_context",
          "director_thinking",
          "story_beats",
          "scene_plan",
          "shot_plan",
          "character_continuity",
          "world_continuity",
        ],
        usage,
      };
      break;
    }
    case "animation_package": {
      requireStage(
        draft,
        stage,
        Boolean(
          draft.creativeContext &&
            draft.directorThinking &&
            draft.storyBeats?.length &&
            draft.scenePlan?.length &&
            draft.shotPlan?.length &&
            draft.worldContinuity
        ),
        "Complete all planning stages before assembling Animation Package"
      );
      if (!draft.characterContinuity) {
        const generated = await generateCharacterContinuity({
          creativeContext: draft.creativeContext!,
          directorThinking: draft.directorThinking!,
          storyBeats: draft.storyBeats!,
          scenePlan: draft.scenePlan!,
          shotPlan: draft.shotPlan!,
        });
        usage = addUsage(usage, generated.usage);
        draft = { ...draft, characterContinuity: generated.characterContinuity, usage };
      }
      const animationPackagePayload = buildAnimationPackage({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        shotPlan: draft.shotPlan!,
        characterContinuity: draft.characterContinuity!,
        worldContinuity: draft.worldContinuity!,
        usage,
      });
      const savedPackage = await saveAnimationPackage(db, {
        orgId: ctx.campaign.orgId,
        workspaceId: ctx.campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: ctx.loaded.currentVersion!.id,
        payload: animationPackagePayload,
      });
      await setAiStoryStatus(db, storyId, "planning", "planning_review");
      return {
        status: "planning_review",
        stage,
        completedStages: [...STORY_PLANNING_STAGE_ORDER],
        creativeContext: savedContext,
        animationPackage: savedPackage,
        planningDraft: null,
      };
    }
    default: {
      const _exhaustive: never = stage;
      throw new Error(`Unhandled planning stage: ${_exhaustive}`);
    }
  }

  const savedDraft = await savePlanningDraft(db, {
    orgId: ctx.campaign.orgId,
    workspaceId: ctx.campaign.workspaceId,
    campaignId,
    storyId,
    storyVersionId: ctx.loaded.currentVersion!.id,
    payload: draft,
  });

  return {
    status: "planning",
    stage,
    completedStages: draft.completedStages,
    creativeContext: savedContext,
    animationPackage: savedDraft,
    planningDraft: draft,
  };
}
