/**
 * Stage-by-stage AI Story planning runner (persists Creative Context + drafts).
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  AiStoryCharacterAuthorityService,
  AiStoryAssetMatchingRepository,
  BillingAccountRepositoryImpl,
  ControlledSelfUseAuthorityService,
  PlatformAdminRepositoryImpl,
  PgEpisodeContinuityRuntimeIntegration,
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  assertPlanningCharacterAuthorityCurrent,
  assertPlanningProductAuthorityCurrent,
  buildAnimationPackage,
  generateCharacterContinuity,
  generateCreativeContext,
  generateDirectorThinking,
  generateScenePlan,
  generateShotPlan,
  generateStoryBeats,
  generateWorldContinuity,
  withControlledSelfUseProviderContext,
  projectAcceptedCharactersToPlanning,
  projectStoryProductSourcesToPlanning,
  selectStoryBoundCharacterAuthorities,
} from "@ceo-agent/agents";
import {
  AiStoryEpisodeIntentAuthoritySchema,
  AiStoryStructuredDraftSchema,
  assertScenePlanningGroundingScope,
  STORY_PLANNING_STAGE_ORDER,
  assessBusinessProfileCompletion,
  normalizeBusinessProfileRecord,
  prunePlanningDraftAfterStage,
  type AiStoryStructuredDraft,
  type AiStoryOutlineProfileReference,
  type PlanningUsage,
  type StoryPlanningDraft,
  type StoryPlanningStage,
} from "@ceo-agent/shared";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import { withConfiguredCertificationPlanningContext } from "@/lib/ai-story-certification-planning-context";
import { resolveStoryProductSources } from "@/lib/ai-story-product-sources";
import { ensureCurrentFrozenCanonicalOutline } from "@/lib/ai-story-canonical-outline-producer";
import { ensureCurrentFrozenCanonicalScript, produceAuthorizedCommercialStoryScriptProposal } from "@/lib/ai-story-canonical-script-producer";
import { ensureCurrentFrozenCanonicalSceneSet } from "@/lib/ai-story-canonical-scene-producer";
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

/**
 * Legacy predicate. Scene and Shot planning use requiresCanonicalStoryAuthority,
 * which includes COMMERCIAL_STORY. This function stays PRODUCT_STORY-only so
 * existing routing tests keep their original contract.
 */
export function requiresProductStoryCanonicalOutline(
  profile: AiStoryOutlineProfileReference | null | undefined
): boolean {
  if (!profile) throw new Error("AI Story Outline profile authority is required");
  return profile.profileId === "PRODUCT_STORY";
}

/** PRODUCT_STORY and COMMERCIAL_STORY share one canonical Outline/Script lifecycle. CORE does not. */
export function requiresCanonicalStoryAuthority(
  profile: AiStoryOutlineProfileReference | null | undefined
): boolean {
  if (!profile) throw new Error("AI Story Outline profile authority is required");
  return profile.profileId === "PRODUCT_STORY" || profile.profileId === "COMMERCIAL_STORY";
}

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

export async function loadAiStoryPlanningContext(
  db: Db,
  campaignId: string,
  storyId: string,
  actorUserId: string
) {
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

  const characters = await new AiStoryCharacterAuthorityService(db).list({
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId,
    actorUserId,
  });
  const characterAuthorities = projectAcceptedCharactersToPlanning({
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId,
    characters,
  });
  const productAuthorities = projectStoryProductSourcesToPlanning(
    await resolveStoryProductSources(db, {
      storyId,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
    })
  );
  const assetGrounding = await new AiStoryAssetMatchingRepository(
    db
  ).loadScenePlanningGroundingContext({
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    storyId,
    storyVersionId: loaded.currentVersion.id,
  });
  assertScenePlanningGroundingScope(assetGrounding, {
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    storyId,
    storyVersionId: loaded.currentVersion.id,
  });
  const episodeContinuity = await new PgEpisodeContinuityRuntimeIntegration(
    db
  ).loadForPlanning({
    organizationId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId,
    storyId,
    storyVersionId: loaded.currentVersion.id,
  });

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
    characterAuthorities,
    productAuthorities,
    assetGrounding,
    episodeContinuity,
  };
}

function isStalePlanningAuthority(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return (
    code === "CHARACTER_AUTHORITY_STALE" ||
    code === "CHARACTER_AUTHORITY_IDENTITY_REQUIRED" ||
    code === "PRODUCT_AUTHORITY_STALE"
  );
}

/**
 * A stage is durable only when the current Story version's latest draft
 * already contains that stage and every stage before it. Animation Package
 * stays non-durable here so the package builder remains the completion gate.
 */
export function planningStageIsDurable(
  draft: StoryPlanningDraft,
  stage: StoryPlanningStage
): boolean {
  const index = STORY_PLANNING_STAGE_ORDER.indexOf(stage);
  if (index < 0) return false;
  const required = STORY_PLANNING_STAGE_ORDER.slice(0, index + 1);
  if (!required.every((item) => draft.completedStages.includes(item))) return false;
  if (stage === "creative_context") return Boolean(draft.creativeContext);
  if (stage === "director_thinking") return Boolean(draft.directorThinking && draft.creativeContext);
  if (stage === "story_beats") return Boolean(draft.storyBeats?.length);
  if (stage === "scene_plan") return Boolean(draft.scenePlan?.length);
  if (stage === "shot_plan") return Boolean(draft.shotPlan?.length);
  if (stage === "character_continuity") return Boolean(draft.characterContinuity?.length);
  if (stage === "world_continuity") return Boolean(draft.worldContinuity);
  return false;
}

function baseDraft(
  storyDraft: AiStoryStructuredDraft,
  episodeContinuity: Awaited<ReturnType<PgEpisodeContinuityRuntimeIntegration["loadForPlanning"]>>
): StoryPlanningDraft {
  return {
    kind: "planning_draft",
    completedStages: [],
    story: storyDraft,
    ...(episodeContinuity ? { episodeContinuity } : {}),
    usage: emptyUsage(),
  };
}

async function reuseDurablePlanningStage(input: {
  db: Db;
  ctx: Awaited<ReturnType<typeof loadAiStoryPlanningContext>>;
  campaignId: string;
  storyId: string;
  stage: StoryPlanningStage;
}): Promise<{
  status: string;
  stage: StoryPlanningStage;
  completedStages: StoryPlanningStage[];
  creativeContext: null;
  animationPackage: Awaited<ReturnType<typeof saveAnimationPackage>>;
  planningDraft: StoryPlanningDraft;
  reusedDurableResult: true;
} | null> {
  const latestPackage = await getLatestAnimationPackageForStory(input.db, {
    campaignId: input.campaignId,
    storyId: input.storyId,
    workspaceId: input.ctx.campaign.workspaceId,
  });
  if (!latestPackage || latestPackage.storyVersionId !== input.ctx.loaded.currentVersion!.id) {
    return null;
  }
  const draft = readPlanningDraftFromPackage(latestPackage);
  if (!draft || !planningStageIsDurable(draft, input.stage)) return null;
  if (draft.creativeContext) {
    try {
      assertPlanningCharacterAuthorityCurrent({
        creativeContext: draft.creativeContext,
        characterAuthorities: input.ctx.characterAuthorities,
      });
      assertPlanningProductAuthorityCurrent({
        creativeContext: draft.creativeContext,
        productAuthorities: input.ctx.productAuthorities,
      });
    } catch (error) {
      if (!isStalePlanningAuthority(error)) throw error;
      return null;
    }
  }
  return {
    status: "planning",
    stage: input.stage,
    completedStages: draft.completedStages,
    creativeContext: null,
    animationPackage: latestPackage as Awaited<ReturnType<typeof saveAnimationPackage>>,
    planningDraft: draft,
    reusedDurableResult: true,
  };
}

export async function runSinglePlanningStage(input: {
  db: Db;
  campaignId: string;
  storyId: string;
  actorUserId: string;
  stage: StoryPlanningStage;
  storyStatus: string;
  regenerationIdentity?: string | null;
}): Promise<{
  status: string;
  stage: StoryPlanningStage;
  completedStages: StoryPlanningStage[];
  creativeContext: Awaited<ReturnType<typeof saveCreativeContext>> | null;
  animationPackage: Awaited<ReturnType<typeof saveAnimationPackage>>;
  planningDraft: StoryPlanningDraft | null;
  reusedDurableResult?: boolean;
}> {
  const { db, campaignId, storyId, stage } = input;
  if (!(STORY_PLANNING_STAGE_ORDER as readonly string[]).includes(stage)) {
    throw new Error(`Unknown planning stage: ${stage}`);
  }

  const ctx = await loadAiStoryPlanningContext(db, campaignId, storyId, input.actorUserId);
  const reused = await reuseDurablePlanningStage({ db, ctx, campaignId, storyId, stage });
  if (reused) return reused;
  let stageCostUsd = 0;
  const runStage = () => withConfiguredCertificationPlanningContext({
    orgId: ctx.campaign.orgId,
    workspaceId: ctx.campaign.workspaceId,
    campaignId,
    storyId,
    actorUserId: input.actorUserId,
    regenerationIdentity: input.regenerationIdentity,
  }, async () => {
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
    readPlanningDraftFromPackage(
      latestPackage?.storyVersionId === ctx.loaded.currentVersion!.id ? latestPackage : null
    ) ??
    baseDraft(ctx.storyDraft, ctx.episodeContinuity);
  draft = {
    ...prunePlanningDraftAfterStage(draft, stage),
    story: ctx.storyDraft,
    ...(ctx.episodeContinuity ? { episodeContinuity: ctx.episodeContinuity } : {}),
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
  if (stage !== "creative_context" && draft.creativeContext) {
    assertPlanningCharacterAuthorityCurrent({
      creativeContext: draft.creativeContext,
      characterAuthorities: ctx.characterAuthorities,
    });
    assertPlanningProductAuthorityCurrent({
      creativeContext: draft.creativeContext,
      productAuthorities: ctx.productAuthorities,
    });
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
        ctx.assetLabels,
        ctx.characterAuthorities,
        ctx.productAuthorities,
        ctx.episodeContinuity
      );
      usage = addUsage(usage, generated.usage);
      stageCostUsd += generated.usage.costUsd;
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
      stageCostUsd += generated.usage.costUsd;
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
      stageCostUsd += generated.usage.costUsd;
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
      if (requiresCanonicalStoryAuthority(ctx.loaded.story.outlineProfile)) {
        await ensureCurrentFrozenCanonicalOutline({
          db,
          campaignId,
          storyId,
          storyVersionId: ctx.loaded.currentVersion!.id,
          actorUserId: input.actorUserId,
          proposedStoryBeats: draft.storyBeats!,
        });
      }
      const generated = await generateScenePlan({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        assetGrounding: ctx.assetGrounding,
      });
      usage = addUsage(usage, generated.usage);
      stageCostUsd += generated.usage.costUsd;
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
      let canonicalScript;
      if (requiresCanonicalStoryAuthority(ctx.loaded.story.outlineProfile)) {
        // A durable Scene Plan may predate Outline materialization. Converge
        // the exact current Story authority before producing Script;
        // this is deterministic and does not re-run Scene Planning.
        await ensureCurrentFrozenCanonicalOutline({
          db,
          campaignId,
          storyId,
          storyVersionId: ctx.loaded.currentVersion!.id,
          actorUserId: input.actorUserId,
          proposedStoryBeats: draft.storyBeats!,
        });
        const storyCharacterAuthorities = selectStoryBoundCharacterAuthorities({
          characterAuthorities: ctx.characterAuthorities,
          creativeContext: draft.creativeContext,
        });
        const episodeIntent = ctx.loaded.story.outlineProfile?.profileId === "COMMERCIAL_STORY"
          ? AiStoryEpisodeIntentAuthoritySchema.safeParse(ctx.loaded.story.episodeIntent)
          : null;
        if (ctx.loaded.story.outlineProfile?.profileId === "COMMERCIAL_STORY") {
          const authored = await produceAuthorizedCommercialStoryScriptProposal({
            db,
            orgId: ctx.campaign.orgId,
            workspaceId: ctx.campaign.workspaceId,
            campaignId,
            storyId,
            storyVersionId: ctx.loaded.currentVersion!.id,
            actorUserId: input.actorUserId,
            story: ctx.storyDraft,
            storyBeats: draft.storyBeats!,
            scenePlan: draft.scenePlan!,
            creativeContext: draft.creativeContext!,
            directorThinking: draft.directorThinking!,
            characterAuthorities: storyCharacterAuthorities,
            ...(episodeIntent?.success ? { episodeIntent: episodeIntent.data } : {}),
          });
          usage = addUsage(usage, authored.usage);
          stageCostUsd += authored.usage.costUsd;
        }
        const canonical = await ensureCurrentFrozenCanonicalScript({
          db,
          orgId: ctx.campaign.orgId,
          workspaceId: ctx.campaign.workspaceId,
          campaignId,
          storyId,
          storyVersionId: ctx.loaded.currentVersion!.id,
          actorUserId: input.actorUserId,
          story: ctx.storyDraft,
          storyBeats: draft.storyBeats!,
          scenePlan: draft.scenePlan!,
          creativeContext: draft.creativeContext!,
          directorThinking: draft.directorThinking!,
          characterAuthorities: storyCharacterAuthorities,
          ...(episodeIntent?.success ? { episodeIntent: episodeIntent.data } : {}),
        });
        canonicalScript = canonical.script;
        usage = addUsage(usage, canonical.usage);
        stageCostUsd += canonical.usage.costUsd;
      }
      const generated = await generateShotPlan({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        planningPackageId: latestPackage?.id,
        ...(canonicalScript ? { canonicalScript } : {}),
      });
      usage = addUsage(usage, generated.usage);
      stageCostUsd += generated.usage.costUsd;
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
      stageCostUsd += generated.usage.costUsd;
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
      stageCostUsd += generated.usage.costUsd;
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
        if (process.env.AI_STORY_CERTIFICATION_ENVIRONMENT) {
          throw new Error("PLANNING_CHARACTER_CONTINUITY_REQUIRED_BEFORE_PACKAGE");
        }
        const generated = await generateCharacterContinuity({
          creativeContext: draft.creativeContext!,
          directorThinking: draft.directorThinking!,
          storyBeats: draft.storyBeats!,
          scenePlan: draft.scenePlan!,
          shotPlan: draft.shotPlan!,
        });
        usage = addUsage(usage, generated.usage);
        stageCostUsd += generated.usage.costUsd;
        draft = { ...draft, characterContinuity: generated.characterContinuity, usage };
      }
      const canonicalScenes = await ensureCurrentFrozenCanonicalSceneSet({
        db,
        orgId: ctx.campaign.orgId,
        workspaceId: ctx.campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: ctx.loaded.currentVersion!.id,
        actorUserId: input.actorUserId,
        story: ctx.storyDraft,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        worldContinuity: draft.worldContinuity!,
        characterAuthorities: selectStoryBoundCharacterAuthorities({
          characterAuthorities: ctx.characterAuthorities,
          creativeContext: draft.creativeContext,
        }),
        ...(ctx.loaded.story.outlineProfile?.profileId === "COMMERCIAL_STORY"
          && AiStoryEpisodeIntentAuthoritySchema.safeParse(ctx.loaded.story.episodeIntent).success
          ? { episodeIntent: AiStoryEpisodeIntentAuthoritySchema.parse(ctx.loaded.story.episodeIntent) }
          : {}),
      });
      const animationPackagePayload = buildAnimationPackage({
        story: ctx.storyDraft,
        creativeContext: draft.creativeContext!,
        directorThinking: draft.directorThinking!,
        storyBeats: draft.storyBeats!,
        scenePlan: draft.scenePlan!,
        shotPlan: draft.shotPlan!,
        characterContinuity: draft.characterContinuity!,
        worldContinuity: draft.worldContinuity!,
        canonicalScenes,
        storyId,
        storyVersionId: ctx.loaded.currentVersion!.id,
        usage,
        episodeContinuity: ctx.episodeContinuity ?? undefined,
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
  });

  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "allowlisted_self_use") {
    return runStage();
  }
  const grant = await new PlatformAdminRepositoryImpl(db).getActiveGrantForUser(
    input.actorUserId
  );
  const billing = await new BillingAccountRepositoryImpl(db).getByOrgId(
    ctx.campaign.orgId
  );
  if (!grant || !billing) {
    throw new Error("CONTROLLED_SELF_USE_PLANNING_BILLING_AUTHORITY_DENIED");
  }
  const authority = new ControlledSelfUseAuthorityService(db);
  const executionIdentity = [
    "ai-story-plan-stage",
    ctx.loaded.currentVersion!.id,
    stage,
    input.regenerationIdentity ?? "initial",
  ].join(":");
  const reservation = (await authority.reserve({
    environment: "PRODUCTION",
    organizationId: ctx.campaign.orgId,
    workspaceId: ctx.campaign.workspaceId,
    capabilityKey: "ai_story.plan",
    executionIdentity,
    providerKey: "openai",
    maximumCostUsd: "0.50",
    retryOrdinal: 0,
    actorUserId: input.actorUserId,
    reservedAt: new Date().toISOString(),
  })).reservation;
  try {
    const result = await withControlledSelfUseProviderContext({
      reservationId: reservation.reservationId,
      organizationId: ctx.campaign.orgId,
      workspaceId: ctx.campaign.workspaceId,
      executionIdentity,
      providerKey: "openai",
    }, runStage);
    if (stageCostUsd > 0) {
      await authority.settle(
        reservation.reservationId,
        stageCostUsd.toFixed(2),
        new Date().toISOString()
      );
    } else {
      await authority.release(reservation.reservationId, new Date().toISOString());
    }
    return result;
  } catch (error) {
    try {
      await authority.reconcileUnusedTerminalPreProviderReservations({
        occurredAt: new Date().toISOString(),
        reservationId: reservation.reservationId,
        executionTerminal: true,
      });
    } catch {
      /* The terminal-story scan retries this unused hold. */
    }
    throw error;
  }
}

/**
 * Worker entry for one planning stage. The HTTP request only enqueues this
 * work; model execution and the durable write happen here, after the request
 * may already have returned.
 */
export async function executeQueuedPlanningStage(input: {
  campaignId: string;
  storyId: string;
  workspaceId: string;
  orgId: string;
  actorUserId: string;
  storyVersionId: string;
  stage: StoryPlanningStage;
  regenerationIdentity?: string | null;
}) {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign || campaign.workspaceId !== input.workspaceId || campaign.orgId !== input.orgId) {
    throw new Error("PLANNING_STAGE_AUTHORITY_MISMATCH");
  }
  const loaded = await loadCampaignAiStory(db, input.campaignId, input.storyId, input.workspaceId);
  if (!loaded?.currentVersion) throw new Error("AI Story not found");
  if (loaded.currentVersion.id !== input.storyVersionId) {
    throw new Error("PLANNING_STORY_VERSION_MISMATCH");
  }
  const status = loaded.story.status;
  try {
    return await runSinglePlanningStage({
      db,
      campaignId: input.campaignId,
      storyId: input.storyId,
      actorUserId: input.actorUserId,
      stage: input.stage,
      storyStatus: status,
      regenerationIdentity: input.regenerationIdentity,
    });
  } catch (error) {
    if (status === "planning" || status === "ready_for_animation" || status === "planning_review") {
      try {
        await setAiStoryStatus(db, input.storyId, "planning", "failed");
        await new ControlledSelfUseAuthorityService(db).reconcileUnusedTerminalPreProviderReservations({
          occurredAt: new Date().toISOString(),
        });
      } catch {
        /* best-effort terminal accounting */
      }
    }
    throw error;
  }
}
