import { eq, and } from "drizzle-orm";
import { getDb, schema, getCampaignAssets } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";
import {
  CEO_MAX_RETRIES,
  normalizeStrategyPlan,
  strategyObjectives,
  type BrandProfile,
  type StepProgress,
  parseCampaignCreativeBrief,
  buildVideoAnalysisPrompt,
  effectiveCampaignGoal,
  resolveAutoClipSourceAsset,
  resolvePipelineContentLocale,
  alignStrategyWithVision,
  isPipelineStageComplete,
  getPipelineStageOutput,
  type ContentLocale,
  type ContentClassification,
  type SubtitleTimelineSegment,
} from "@ceo-agent/shared";
import {
  provideCampaignAIContext,
  enrichCampaignAIContext,
  provideCampaignAIContextFromCampaign,
} from "./campaign-context-provider";
import { failPipelineExecution } from "./pipeline-lifecycle";
import { isVisionAnalysisTimeoutError } from "./vision-timeout";
import { runCeoAgent, parseIntent } from "./ceo";
import {
  contentPackageToHookSet,
  contentPackageToCopyVariants,
} from "./marketing-content";
import { enrichMarketingPackTranslations } from "./marketing-pack-translate";
import { runScoreAgent } from "./score";
import { runVisionAgent } from "./vision";
import { runCopyAgentMix } from "./copy";
import { runComplianceAgent } from "./compliance";
import { runPublishAgent } from "./publish";
import type { Platform, StrategyPlan, HookSet, CopyVariant } from "@ceo-agent/shared";
import { runContentTypeAgent } from "./content-type";
import { resolveCopyMix, getPresetProfile } from "@ceo-agent/shared";
import {
  maybeFinalizeAutoClipTask,
  runAutoClipPipeline,
} from "./auto-clip-pipeline";
import type { VisionFrameInput } from "./vision";
import { copyCacheKey, getCopyCache, setCopyCache } from "@ceo-agent/queue/copy-cache";
import { buildPipelineExecutionPlan } from "./pipeline-router";
import { mergePipelineContext } from "./merge-context";
import {
  runMarketingContentPipeline,
  runStrategyPipeline,
} from "./marketing-pipeline";
import {
  runCompositionPipeline,
  type CompositionResult,
} from "./composition-pipeline";
import { assertMandatoryGatesComplete } from "./mandatory-gates";
import {
  adaptImageUnderstandingResult,
  adaptMarketingPipelineResult,
  adaptVideoPipelineResult,
  preRenderVideoWarning,
} from "./pipeline-adapters";
import { executeCampaignPipelinePlan } from "./pipeline-executor";
import { readCompletedPipelineResults } from "./pipeline-checkpoints";
import { finalizeReviewAfterGates } from "./review-finalization";
import type {
  PipelineDependency,
} from "./workflow-contracts";

export interface VisionMediaPreparer {
  prepare(input: {
    storagePath: string;
    mediaType: "video" | "image";
    durationSec?: number;
  }): Promise<{ frames: VisionFrameInput[]; transcriptSummary?: string; transcriptSegments?: Array<{ startSec: number; endSec: number; text: string }> }>;
}

export interface PipelineHooks {
  prepareVisionMedia?: VisionMediaPreparer;
}

async function updateStep(
  taskId: string,
  stepId: string,
  update: Partial<StepProgress[string]>
) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return;

  const progress = (task.stepProgress as StepProgress) ?? {};
  progress[stepId] = { ...progress[stepId], ...update };
  await db
    .update(schema.tasks)
    .set({ stepProgress: progress, currentStep: stepId })
    .where(eq(schema.tasks.id, taskId));
}

async function logAgent(
  orgId: string,
  workspaceId: string,
  taskId: string,
  agent: string,
  usage: { input: number; output: number; costUsd: number },
  output?: unknown
) {
  const db = getDb();
  await db.insert(schema.agentLogs).values({
    orgId,
    workspaceId,
    taskId,
    agent,
    inputTokens: usage.input,
    outputTokens: usage.output,
    costUsd: String(usage.costUsd),
    outputJson: output as Record<string, unknown>,
    durationMs: 0,
  });

  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (task) {
    const current = parseFloat(task.costUsd ?? "0");
    await db
      .update(schema.tasks)
      .set({ costUsd: String(current + usage.costUsd) })
      .where(eq(schema.tasks.id, taskId));
  }
}

export async function runPipeline(taskId: string, hooks?: PipelineHooks) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found");

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, task.workspaceId))
    .limit(1);

  const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
  const assets = await getCampaignAssets(db, campaign.id, task.workspaceId);
  const persistedProgress = (task.stepProgress as StepProgress) ?? {};
  const completedResults = readCompletedPipelineResults(persistedProgress);

  const dependencies: PipelineDependency[] = [
    { id: "campaign", kind: "campaign", required: true, state: "READY" },
    {
      id: "business_profile",
      kind: "business_profile",
      required: true,
      state: workspace ? "READY" : "WAITING",
      ...(workspace ? {} : { reason: "Workspace Business Profile is unavailable" }),
    },
    ...assets.flatMap((asset) => [{
      id: `asset-upload:${asset.id}`,
      kind: "asset_upload" as const,
      required: true,
      state: asset.status === "ready" ? ("READY" as const) : ("WAITING" as const),
      ...(asset.status === "ready" ? {} : { reason: `Asset status is ${asset.status}` }),
      assetId: asset.id,
    }, {
      id: `asset-registration:${asset.id}`,
      kind: "asset_registration" as const,
      required: true,
      state: asset.id ? ("READY" as const) : ("WAITING" as const),
      assetId: asset.id,
    }]),
  ];
  const routePlan = buildPipelineExecutionPlan({
    campaignId: campaign.id,
    workspaceId: task.workspaceId,
    campaignObjective: campaign.goal ?? "",
    selectedAssets: assets,
    dependencies,
    requestedOutputs: [],
    enabledCapabilities: ["VIDEO", "IMAGE_UNDERSTANDING", "MARKETING"],
    completedResults,
    retryPipelineTypes:
      task.status === "retrying"
        ? (["VIDEO", "IMAGE_UNDERSTANDING"] as const).filter(
            (pipelineType) => !completedResults[pipelineType]
          )
        : [],
  });
  const waitingRoutes = routePlan.routes.filter(
    (route) =>
      route.pipelineType !== "MARKETING" &&
      route.state === "WAITING_FOR_DEPENDENCY"
  );
  const failedRoutes = routePlan.routes.filter(
    (route) =>
      route.pipelineType !== "MARKETING" &&
      route.state === "FAILED_TERMINAL"
  );
  if (failedRoutes.length > 0) {
    const message =
      `Pipeline dependencies failed: ${failedRoutes
        .map((route) => route.pipelineType)
        .join(", ")}`;
    await failPipelineExecution({ taskId, campaignId: campaign.id, message });
    throw new Error(message);
  }
  if (
    routePlan.routes.every(
      (route) =>
        route.pipelineType === "MARKETING" || route.state === "NOT_REQUIRED"
    )
  ) {
    const message = "No supported Campaign assets are ready for routing";
    await failPipelineExecution({ taskId, campaignId: campaign.id, message });
    throw new Error(message);
  }
  if (waitingRoutes.length > 0) {
    await updateStep(taskId, "dependency_check", {
      status: "pending",
      output: {
        pipelineState: "WAITING_FOR_DEPENDENCY",
        routeKey: routePlan.deterministicKey,
        pipelines: waitingRoutes.map((route) => route.pipelineType),
      },
    });
    return {
      taskId,
      status: "waiting_for_dependency",
      routeKey: routePlan.deterministicKey,
    };
  }
  await updateStep(taskId, "pipeline_router", {
    status: "completed",
    completedAt: new Date().toISOString(),
    output: routePlan,
  });

  type RoutedExecution =
    | Awaited<ReturnType<typeof runAutoClipPipeline>>
    | { taskId: string; creativeIds: string[]; status: "review_ready" }
    | { taskId: string; status: "continue_general_agency" };
  const execution = await executeCampaignPipelinePlan<RoutedExecution>(routePlan, {
    VIDEO: async () => {
      if (completedResults.VIDEO?.state === "COMPLETED") {
        const finalized = await maybeFinalizeAutoClipTask(taskId);
        return {
          taskId,
          creativeIds: completedResults.VIDEO.creativeIds,
          status: finalized ? "review_ready" as const : "render_queued" as const,
        };
      }
      const sourceVideo = resolveAutoClipSourceAsset(assets);
      if (!sourceVideo) {
        throw new Error("Router selected VIDEO without a playable source");
      }
      console.log(
        `[agent.pipeline] router=${routePlan.deterministicKey.slice(0, 12)} route=auto_clip task=${taskId} source=${sourceVideo.asset.id} dur=${sourceVideo.durationSec.toFixed(1)}s`
      );
      return runAutoClipPipeline(taskId, hooks);
    },
    IMAGE_UNDERSTANDING: async () => {
      console.log(
        `[agent.pipeline] router=${routePlan.deterministicKey.slice(0, 12)} route=agency task=${taskId}`
      );
      return { taskId, status: "continue_general_agency" as const };
    },
  });
  if (execution.status !== "continue_general_agency") return execution;

  const creativeBrief = parseCampaignCreativeBrief(campaign);
  const campaignMeta = (campaign.metadata ?? {}) as Record<string, unknown>;
  const contentLocale = resolvePipelineContentLocale(campaignMeta, campaign.goal);
  const videoAnalysis = buildVideoAnalysisPrompt(creativeBrief);
  const goal = effectiveCampaignGoal(creativeBrief, campaign.goal, contentLocale);
  const campaignContext = provideCampaignAIContext({
    businessProfile: brandProfile,
    campaignObjective: goal,
    publishingPlatforms: campaign.platforms ?? [],
    targetAudience: campaign.targetAudienceOverride,
    campaignBrief: creativeBrief.campaignBrief,
    workspaceLanguage: contentLocale,
    assets: assets.map((a) => ({ id: a.id, type: a.type })),
    workflowMetadata: {
      marketingExecution: {
        campaignName: campaign.name,
        creativeBrief,
        videoAnalysis,
        assetsUploaded: assets.length,
      },
    },
  });

  await db
    .update(schema.tasks)
    .set({
      status: "running",
      startedAt: task.startedAt ?? new Date(),
      errorMessage: null,
      completedAt: null,
    })
    .where(eq(schema.tasks.id, taskId));
  await db
    .update(schema.campaigns)
    .set({ status: "processing" })
    .where(eq(schema.campaigns.id, campaign.id));

  let totalCost = parseFloat(task.costUsd ?? "0");
  const budget = parseFloat(task.costBudgetUsd ?? "0.5");
  const progressSnapshot = (task.stepProgress as StepProgress) ?? {};
  const stageDone = (id: string) => isPipelineStageComplete(progressSnapshot, id);

  try {
    let intent = getPipelineStageOutput<{ intent?: string }>(progressSnapshot, "parse_intent");
    if (!stageDone("parse_intent")) {
      await updateStep(taskId, "parse_intent", { status: "running", startedAt: new Date().toISOString() });
      intent = parseIntent(goal, campaign.platforms);
      await updateStep(taskId, "parse_intent", { status: "completed", completedAt: new Date().toISOString(), output: intent });
    } else {
      console.log(`[agent.pipeline] resume skip=parse_intent task=${taskId}`);
    }

    // vision — runs FIRST so strategy/CEO are grounded in the actual assets.
    const videoAsset = assets.find((a) => a.type === "video");
    const imageAssets = assets.filter((a) => a.type === "image");
    const primaryAsset = imageAssets[0];
    if (!primaryAsset) {
      throw new Error("Image Understanding requires a supported image Asset");
    }

    let vision = getPipelineStageOutput<import("@ceo-agent/shared").VisionAnalysis>(
      progressSnapshot,
      "vision_analyze"
    );
    let transcriptSummary: string | undefined = vision?.transcriptSummary;

    if (!stageDone("vision_analyze") || !vision) {
      await updateStep(taskId, "vision_analyze", { status: "running", startedAt: new Date().toISOString() });
      let visionFrames: VisionFrameInput[] = [];
      transcriptSummary = undefined;
      if (hooks?.prepareVisionMedia) {
        for (const asset of imageAssets.slice(0, 8)) {
          const prepared = await hooks.prepareVisionMedia.prepare({
            storagePath: asset.storagePath,
            mediaType: "image",
            durationSec: asset.durationSec ? parseFloat(asset.durationSec) : undefined,
          });
          visionFrames.push(...prepared.frames);
          if (visionFrames.length >= 8) break;
        }
        visionFrames = visionFrames.slice(0, 8);
      }

      const visionContext = enrichCampaignAIContext(campaignContext, {
        transcript: transcriptSummary ?? null,
      });
      const { analysis, usage: visionUsage } = await runVisionAgent({
        assetId: primaryAsset.id,
        mediaType: "image",
        durationSec: primaryAsset.durationSec ? parseFloat(primaryAsset.durationSec) : undefined,
        campaignName: campaign.name,
        videoAnalysis,
        frames: visionFrames.length > 0 ? visionFrames : undefined,
        transcriptSummary,
        campaignContext: visionContext,
      });
      vision = analysis;
      totalCost += visionUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "vision", visionUsage, vision);
      await updateStep(taskId, "vision_analyze", { status: "completed", completedAt: new Date().toISOString(), output: vision });
    } else {
      console.log(`[agent.pipeline] resume skip=vision_analyze task=${taskId}`);
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // strategy_plan — built from the asset analysis (primary), then Campaign Brief + Target Audience.
    const mediaOutputs = [
      adaptImageUnderstandingResult({
        assetIds: imageAssets.map((asset) => asset.id),
        classification: vision.mediaType,
        productDetection: vision.products,
        subjectDetection: vision.subjects,
        sceneDetection: vision.scenes,
        confidence:
          vision.confidence === undefined ? {} : { overall: vision.confidence },
      }),
    ];
    await updateStep(taskId, "image_understanding_output", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: mediaOutputs[0],
    });
    const preStrategyMergedContext = mergePipelineContext(
      enrichCampaignAIContext(campaignContext, {
        vision,
        transcript: transcriptSummary ?? vision.transcriptSummary ?? null,
      }),
      mediaOutputs
    );

    let strategy = stageDone("strategy_plan")
      ? normalizeStrategyPlan(
          task.strategyJson ??
            campaign.strategyJson ??
            getPipelineStageOutput(progressSnapshot, "strategy_plan")
        )
      : undefined;
    let knowledgeSnippets: Awaited<
      ReturnType<typeof runStrategyPipeline>
    >["output"]["knowledgeSnippets"] = [];

    if (!stageDone("strategy_plan") || !strategy) {
      await updateStep(taskId, "strategy_plan", { status: "running", startedAt: new Date().toISOString() });
      const strategyExecution = await runStrategyPipeline(
        preStrategyMergedContext
      );
      const {
        strategy: rawStrategy,
        industry,
        knowledgeSnippets: snippets,
        usage: strategyUsage,
      } = strategyExecution.output;
      knowledgeSnippets = snippets;
      strategy = alignStrategyWithVision(rawStrategy, vision, {
        goal,
        campaignBrief: creativeBrief.campaignBrief,
        userNotes: creativeBrief.campaignBrief,
        videoAnalysis: videoAnalysis ?? undefined,
        campaignName: campaign.name,
        locale: contentLocale === "zh" ? "zh" : "en",
      });
      totalCost += strategyUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "strategy", strategyUsage, strategy);
      await db
        .update(schema.tasks)
        .set({ strategyJson: strategy })
        .where(eq(schema.tasks.id, taskId));
      await db
        .update(schema.campaigns)
        .set({
          strategyJson: strategy,
          industry: industry === "general" ? null : industry,
          objectives: strategyObjectives(strategy),
        })
        .where(eq(schema.campaigns.id, campaign.id));
      await updateStep(taskId, "strategy_plan", { status: "completed", completedAt: new Date().toISOString(), output: strategy });
    } else {
      console.log(`[agent.pipeline] resume skip=strategy_plan task=${taskId}`);
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    const mergedMarketingContext = mergePipelineContext(
      enrichCampaignAIContext(campaignContext, {
        vision,
        strategy,
        transcript: transcriptSummary ?? vision.transcriptSummary ?? null,
      }),
      mediaOutputs
    );
    const pipelineContext = mergedMarketingContext.campaignContext;
    await updateStep(taskId, "merge_context", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: mergedMarketingContext,
    });

    // ceo_plan
    if (!stageDone("ceo_plan")) {
      await updateStep(taskId, "ceo_plan", { status: "running", startedAt: new Date().toISOString() });
      const assetSummary = assets.map((a) => `${a.type}:${a.id}`).join(", ");
      const { taskGraph, usage: ceoUsage } = await runCeoAgent({
        campaignContext: pipelineContext,
        assetSummary,
        costBudgetUsd: budget,
        knowledgeSnippets,
        campaignName: campaign.name,
        videoAnalysis,
      });
      totalCost += ceoUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "ceo", ceoUsage, taskGraph);
      await db.update(schema.tasks).set({ ceoPlan: taskGraph }).where(eq(schema.tasks.id, taskId));
      await updateStep(taskId, "ceo_plan", { status: "completed", completedAt: new Date().toISOString(), output: taskGraph });
    } else {
      console.log(`[agent.pipeline] resume skip=ceo_plan task=${taskId}`);
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // content classify + preset
    let classification = getPipelineStageOutput<ContentClassification>(
      progressSnapshot,
      "content_classify"
    );
    if (!stageDone("content_classify") || !classification) {
      await updateStep(taskId, "content_classify", { status: "running", startedAt: new Date().toISOString() });
      const { classification: classified, usage: classifyUsage } = await runContentTypeAgent({
        campaignContext: pipelineContext,
        vision,
        videoAnalysis,
        campaignName: campaign.name,
      });
      classification = classified;
      totalCost += classifyUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "content_type", classifyUsage, classification);
      const presetEarly = getPresetProfile(classification.presetId);
      await db
        .update(schema.campaigns)
        .set({
          industry: classification.industry === "general" ? null : classification.industry,
          metadata: {
            ...campaignMeta,
            contentType: classification.contentType,
            presetId: classification.presetId,
          },
        })
        .where(eq(schema.campaigns.id, campaign.id));
      await updateStep(taskId, "content_classify", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: { ...classification, presetLabel: presetEarly.labelZh },
      });
    } else {
      console.log(`[agent.pipeline] resume skip=content_classify task=${taskId}`);
    }
    const preset = getPresetProfile(classification!.presetId);

    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];

    // content_generate — check copy variant cache first to avoid repeat LLM cost
    const cacheKey = copyCacheKey({
      campaignId: campaign.id,
      platforms: campaign.platforms,
      brief: [goal, creativeBrief.campaignBrief ?? ""].join("|"),
    });
    const cachedVariants = await getCopyCache(cacheKey);

    let allVariants: CopyVariant[];
    let hookSet: HookSet;
    let subtitleTimeline: SubtitleTimelineSegment[] | undefined;

    if (stageDone("content_generate") && stageDone("copy_generate") && stageDone("hook_generate")) {
      console.log(`[agent.pipeline] resume skip=content_generate/hooks/copy task=${taskId}`);
      allVariants =
        (getPipelineStageOutput<CopyVariant[]>(progressSnapshot, "copy_generate") as CopyVariant[]) ??
        cachedVariants ??
        [];
      hookSet =
        ((task.hooksJson as HookSet | null) ??
          getPipelineStageOutput<HookSet>(progressSnapshot, "hook_generate")) as HookSet;
      const pack = getPipelineStageOutput<{ subtitleTimeline?: typeof subtitleTimeline }>(
        progressSnapshot,
        "content_generate"
      );
      subtitleTimeline = pack?.subtitleTimeline;
      if (!allVariants.length || !hookSet) {
        throw new Error("Resume missing marketing outputs — cannot continue safely");
      }
    } else {
      // Always generate the marketing pack for Review. Copy-variant cache only
      // skips re-deriving platform variants when a prior run already produced them.
      await updateStep(taskId, "content_generate", { status: "running", startedAt: new Date().toISOString() });
      const marketingExecution = await runMarketingContentPipeline(
        mergedMarketingContext
      );
      const {
        contentPackage: rawContentPackage,
        usage: contentUsage,
      } = marketingExecution.output;
      totalCost += contentUsage.costUsd;
      const { contentPackage, usage: translateUsage } =
        await enrichMarketingPackTranslations(rawContentPackage);
      totalCost += translateUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "marketing_content", contentUsage, rawContentPackage);
      if (translateUsage.costUsd > 0) {
        await logAgent(task.orgId, task.workspaceId, taskId, "marketing_translate", translateUsage, contentPackage);
      }
      await updateStep(taskId, "content_generate", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: contentPackage,
      });
      await updateStep(taskId, "marketing_pipeline_output", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: adaptMarketingPipelineResult(
          contentPackage as unknown as Record<string, unknown>
        ),
      });

      if (totalCost > budget) throw new Error("Cost budget exceeded");

      hookSet = contentPackageToHookSet(contentPackage);
      await logAgent(task.orgId, task.workspaceId, taskId, "hook", { input: 0, output: 0, costUsd: 0 }, hookSet);
      await db.update(schema.tasks).set({ hooksJson: hookSet }).where(eq(schema.tasks.id, taskId));
      await updateStep(taskId, "hook_generate", { status: "completed", completedAt: new Date().toISOString(), output: hookSet });

      if (cachedVariants) {
        console.log(`[orchestrator] copy cache hit campaignId=${campaign.id}`);
        allVariants = cachedVariants;
      } else {
        allVariants = contentPackageToCopyVariants(contentPackage, strategy!, platforms);
        await setCopyCache(cacheKey, allVariants);
      }
      subtitleTimeline = contentPackage.subtitleTimeline;
      await logAgent(task.orgId, task.workspaceId, taskId, "copy", { input: 0, output: 0, costUsd: 0 }, allVariants);
      await updateStep(taskId, "copy_generate", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: allVariants,
      });
    }
    const marketingPipelineResult = adaptMarketingPipelineResult(
      {
        copyVariants: allVariants,
        hookSet,
        subtitleTimeline: subtitleTimeline ?? [],
      },
      mergedMarketingContext.provenance
    );

    const recommendedVariantId = allVariants.find((v) => v.locale === "en")?.id ?? allVariants[0]?.id ?? "v-en-1";

    const existingDraft = (
      await db
        .select()
        .from(schema.creatives)
        .where(eq(schema.creatives.taskId, task.id))
        .limit(1)
    )[0];
    const compositionResult = await runCompositionPipeline({
      mode: "GENERAL",
      mergedContext: mergedMarketingContext,
      marketingResult: marketingPipelineResult,
      campaignContext: pipelineContext,
      vision: vision!,
      preset,
      copyVariants: allVariants,
      platforms,
      campaignGoal: goal,
      campaignName: campaign.name,
      videoAsset: videoAsset
        ? {
            id: videoAsset.id,
            durationSec: videoAsset.durationSec
              ? parseFloat(videoAsset.durationSec)
              : 15,
          }
        : undefined,
      imageAssetIds: imageAssets.map((asset) => asset.id),
      subtitleTimeline,
      voicePreset: creativeBrief.voicePreset,
      selectedCopyId: recommendedVariantId,
      selectedHookId: hookSet.recommendedHookId ?? hookSet.hooks[0]?.id,
      resumeResult: getPipelineStageOutput<CompositionResult>(
        progressSnapshot,
        "VIDEO_COMPOSITION_COMPLETE"
      ),
      registry: {
        registerDraft: async (draft) => {
          if (existingDraft) {
            await db
              .update(schema.creatives)
              .set({
                copyVariants: draft.copyVariants,
                selectedCopyId: draft.selectedCopyId,
                selectedHookId: draft.selectedHookId,
                editPlan: draft.editPlan,
              })
              .where(eq(schema.creatives.id, existingDraft.id));
            return { creativeId: existingDraft.id };
          }
          const [created] = await db
            .insert(schema.creatives)
            .values({
              orgId: task.orgId,
              workspaceId: task.workspaceId,
              campaignId: campaign.id,
              taskId: task.id,
              status: "processing",
              copyVariants: draft.copyVariants,
              selectedCopyId: draft.selectedCopyId,
              selectedHookId: draft.selectedHookId,
              editPlan: draft.editPlan,
            })
            .returning();
          if (!created) throw new Error("Creative Draft registration failed");
          return { creativeId: created.id };
        },
      },
      persistCheckpoint: async (checkpoint, output) => {
        await updateStep(taskId, checkpoint, {
          status: "completed",
          completedAt: new Date().toISOString(),
          output,
        });
      },
    });
    const creativeId = compositionResult.creativeDrafts[0]?.creativeId;
    if (!creativeId) throw new Error("Composition produced no Creative Draft");
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, creativeId))
      .limit(1);
    if (!creative) throw new Error("Creative Draft registration was not persisted");
    await logAgent(
      task.orgId,
      task.workspaceId,
      taskId,
      "edit",
      { input: 0, output: 0, costUsd: 0 },
      compositionResult
    );
    await updateStep(taskId, "edit_director_plan", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: creative.editPlan,
    });

    // enqueue ffmpeg render — skip if preview already ready
    if (
      stageDone("ffmpeg_render") &&
      creative.renderStatus === "preview_ready" &&
      Boolean(creative.videoUrl)
    ) {
      console.log(`[agent.pipeline] resume skip=ffmpeg_render task=${taskId}`);
      await runComplianceAfterRender(taskId, creative.id);
      return { taskId, creativeId: creative.id, status: "render_skipped_resume" };
    }

    await updateStep(taskId, "ffmpeg_render", {
      status: "running",
      startedAt: new Date().toISOString(),
      output: { percent: 0, phase: "queued", renderStatus: "preview_rendering" },
    });
    await db
      .update(schema.creatives)
      .set({ renderStatus: "preview_rendering" })
      .where(eq(schema.creatives.id, creative!.id));
    await enqueueRender({
      taskId: task.id,
      creativeId: creative!.id,
      workspaceId: task.workspaceId,
      orgId: task.orgId,
      campaignId: campaign.id,
      mode: "preview",
    });

    console.log(
      `[agent.pipeline] queued preview render creative=${creative!.id} task=${taskId} — waiting for ffmpeg.render worker`
    );

    return { taskId, creativeId: creative!.id, status: "render_queued" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed";
    await failPipelineExecution({
      taskId,
      campaignId: campaign.id,
      message,
      forceTerminal: isVisionAnalysisTimeoutError(error),
    });
    throw error;
  }
}

export async function runComplianceAfterRender(
  taskId: string,
  creativeId: string,
  options: { finalizeReview?: boolean } = {}
) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);
  if (!task || !creative) {
    throw new Error("Cannot finalize Review without Task and Creative");
  }

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, task.workspaceId))
    .limit(1);
  const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
  const variants = (creative.copyVariants ?? []) as import("@ceo-agent/shared").CopyVariant[];
  const editPlan = creative.editPlan as import("@ceo-agent/shared").EditPlan | null;
  const subtitles = editPlan?.subtitles?.map((s) => s.text) ?? [];

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);
  const creativeBrief = campaign ? parseCampaignCreativeBrief(campaign) : null;
  const campaignMeta = (campaign?.metadata ?? {}) as Record<string, unknown>;
  const contentLocale = resolvePipelineContentLocale(campaignMeta, campaign?.goal);
  const progress = (task.stepProgress as StepProgress) ?? {};
  const vision = progress.vision_analyze?.output as import("@ceo-agent/shared").VisionAnalysis | undefined;
  const rawStrategy =
    task.strategyJson ?? campaign?.strategyJson ?? progress.strategy_plan?.output;
  const strategy = rawStrategy ? normalizeStrategyPlan(rawStrategy) : undefined;
  const campaignAssets = campaign
    ? await getCampaignAssets(db, campaign.id, task.workspaceId)
    : [];
  const baseCampaignContext = campaign
    ? provideCampaignAIContextFromCampaign({
        brandProfile,
        campaign,
        vision: vision ?? null,
        strategy: strategy ?? null,
        assets: campaignAssets.map((a) => ({ id: a.id, type: a.type })),
        transcript: vision?.transcriptSummary ?? null,
      })
    : provideCampaignAIContext({
        businessProfile: brandProfile,
        campaignObjective: "",
        publishingPlatforms: [],
        workspaceLanguage: contentLocale,
      });
  const persistedMerged = progress.merge_context?.output as
    | ReturnType<typeof mergePipelineContext>
    | undefined;
  const gateMediaResults = [];
  const videoAssets = campaignAssets.filter((asset) => asset.type === "video");
  const imageAssets = campaignAssets.filter((asset) => asset.type === "image");
  if (videoAssets.length > 0) {
    gateMediaResults.push(
      adaptVideoPipelineResult({
        assetIds: videoAssets.map((asset) => asset.id),
        transcript: vision?.transcriptSummary ?? null,
        sceneAnalysis: vision?.scenes,
        suggestedMoments: vision?.suggestedMoments,
        warnings: [preRenderVideoWarning()],
        complete: false,
      })
    );
  }
  if (imageAssets.length > 0) {
    gateMediaResults.push(
      adaptImageUnderstandingResult({
        assetIds: imageAssets.map((asset) => asset.id),
        classification: vision?.mediaType,
        productDetection: vision?.products,
        subjectDetection: vision?.subjects,
        sceneDetection: vision?.scenes,
        confidence:
          vision?.confidence === undefined
            ? {}
            : { overall: vision.confidence },
      })
    );
  }
  const gateMergedContext =
    persistedMerged?.campaignContext && persistedMerged.deterministicKey
      ? persistedMerged
      : mergePipelineContext(
          enrichCampaignAIContext(baseCampaignContext, {
            vision: vision ?? null,
            strategy: strategy ?? null,
          }),
          gateMediaResults
        );
  const campaignContext = gateMergedContext.campaignContext;

  await updateStep(taskId, "compliance_check", { status: "running", startedAt: new Date().toISOString() });
  const { result, usage } = await runComplianceAgent({
    campaignContext,
    copyVariants: variants,
    subtitles,
  });
  await logAgent(task.orgId, task.workspaceId, taskId, "compliance", usage, result);

  const newStatus = result.passed ? "processing" : "compliance_failed";
  await db
    .update(schema.creatives)
    .set({ complianceResult: result, status: newStatus })
    .where(eq(schema.creatives.id, creativeId));

  await updateStep(taskId, "compliance_check", {
    status: result.passed ? "completed" : "failed",
    completedAt: new Date().toISOString(),
    output: result,
  });

  if (!result.passed) {
    if (task.retryCount < CEO_MAX_RETRIES) {
      try {
        // retryPipelineStep increments retryCount and re-runs copy + compliance
        await retryPipelineStep(taskId, "copy");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Copy retry after compliance failed";
        await failPipelineExecution({
          taskId,
          campaignId: task.campaignId,
          message,
        });
        throw err;
      }
    } else {
      await failPipelineExecution({
        taskId,
        campaignId: task.campaignId,
        message:
          result.flags?.[0]?.reason ??
          `Compliance check failed (score=${result.score})`,
      });
    }
    return;
  }

  // Agency path must enqueue Review the same way Auto Clip does — otherwise
  // /api/reviews stays empty while campaign/creative sit in pending_internal_review.
  const hookSet =
    (task.hooksJson as HookSet | null) ??
    (progress.hook_generate?.output as HookSet);
  const platforms = (campaign?.platforms ?? ["tiktok"]) as Platform[];
  const videoAnalysis = creativeBrief ? buildVideoAnalysisPrompt(creativeBrief) : null;
  const scoreContext = enrichCampaignAIContext(campaignContext, {
    vision: vision ?? null,
    strategy: strategy ?? null,
  });

  if (strategy && hookSet && vision) {
    await updateStep(taskId, "marketing_score", { status: "running", startedAt: new Date().toISOString() });
    const { score, usage: scoreUsage } = await runScoreAgent({
      campaignContext: scoreContext,
      strategy,
      hookSet,
      vision,
      copyVariants: variants,
      editPlan,
      platforms,
      selectedHookId: creative.selectedHookId ?? undefined,
      videoAnalysis,
    });
    await logAgent(task.orgId, task.workspaceId, taskId, "score", scoreUsage, score);

    await db
      .update(schema.tasks)
      .set({ marketingScoreJson: score })
      .where(eq(schema.tasks.id, taskId));
    await db
      .update(schema.creatives)
      .set({ marketingScoreJson: score })
      .where(eq(schema.creatives.id, creativeId));

    try {
      await db.insert(schema.marketingScores).values({
        orgId: task.orgId,
        workspaceId: task.workspaceId,
        campaignId: task.campaignId,
        creativeId,
        taskId,
        overallScore: String(score.overallScore),
        hookScore: String(score.hookScore),
        visualScore: String(score.visualScore),
        copyScore: String(score.copyScore),
        ctaScore: String(score.ctaScore),
        platformFitScore: String(score.platformFitScore),
        improvements: score.improvements,
      });
    } catch (scoreErr) {
      const message = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      console.error(
        JSON.stringify({
          event: "marketing_score_persist_failed",
          taskId,
          campaignId: task.campaignId,
          workspaceId: task.workspaceId,
          error: message,
        })
      );
      throw new Error(`Marketing score persistence failed: ${message}`);
    }

    await updateStep(taskId, "marketing_score", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: score,
    });
  } else {
    const message = "Marketing Score prerequisites are unavailable";
    await updateStep(taskId, "marketing_score", {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    await failPipelineExecution({
      taskId,
      campaignId: task.campaignId,
      message,
    });
    throw new Error(message);
  }

  const [gateTask] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  const [gateCreative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);
  if (options.finalizeReview === false) {
    assertMandatoryGatesComplete({
      progress: (gateTask?.stepProgress as StepProgress) ?? {},
      creativeRegistered: Boolean(gateCreative),
      outputReady:
        gateCreative?.renderStatus === "preview_ready" && Boolean(gateCreative.videoUrl),
    });
    return { compliance: result, reviewCreated: false };
  }

  const reviewProgress = {
    ...((gateTask?.stepProgress as StepProgress) ?? {}),
    human_review: {
      status: "pending" as const,
      startedAt: new Date().toISOString(),
    },
  };
  await finalizeReviewAfterGates(
    [{
      progress: (gateTask?.stepProgress as StepProgress) ?? {},
      creativeRegistered: Boolean(gateCreative),
      outputReady:
        gateCreative?.renderStatus === "preview_ready" &&
        Boolean(gateCreative.videoUrl),
    }],
    {
      taskId,
      campaignId: task.campaignId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      creativeIds: [creativeId],
      finalOutputReferences: gateCreative?.videoUrl
        ? [gateCreative.videoUrl]
        : [],
      progress: reviewProgress,
    }
  );
  return { compliance: result, reviewCreated: true };
}

export async function retryPipelineStep(
  taskId: string,
  step: "copy" | "edit" | "full"
) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error("Task not found");
  // OPS-002 Rule 3 — no further resume once retries are exhausted.
  if (task.status === "failed" || task.retryCount >= CEO_MAX_RETRIES) {
    throw new Error("Max retries exceeded");
  }

  // OPS-002 Rule 2 — Retry = Resume (continuation of same execution).
  await db
    .update(schema.tasks)
    .set({
      retryCount: task.retryCount + 1,
      status: "retrying",
      errorMessage: null,
      completedAt: null,
    })
    .where(eq(schema.tasks.id, taskId));

  if (step === "full") {
    // runPipeline skips completed stages via isPipelineStageComplete.
    return runPipeline(taskId);
  }

  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId))
    .limit(1);
  if (!creative) throw new Error("Creative not found");

  if (step === "copy") {
    // Re-run copy + compliance only
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, task.campaignId))
      .limit(1);
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, task.workspaceId))
      .limit(1);
    const progress = task.stepProgress as StepProgress;
    const vision = progress?.vision_analyze?.output as import("@ceo-agent/shared").VisionAnalysis;
    const rawStrategy = task.strategyJson ?? progress?.strategy_plan?.output;
    const strategy = rawStrategy ? normalizeStrategyPlan(rawStrategy) : undefined;
    const hookSet =
      (task.hooksJson as HookSet | null) ??
      (progress?.hook_generate?.output as HookSet);
    const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
    const platforms = (campaign?.platforms ?? ["tiktok"]) as Platform[];
    const campaignAssets = campaign
      ? await getCampaignAssets(db, campaign.id, task.workspaceId)
      : [];
    const campaignContext = campaign
      ? provideCampaignAIContextFromCampaign({
          brandProfile,
          campaign,
          vision: vision ?? null,
          strategy: strategy ?? null,
          assets: campaignAssets.map((a) => ({ id: a.id, type: a.type })),
          transcript: vision?.transcriptSummary ?? null,
        })
      : provideCampaignAIContext({
          businessProfile: brandProfile,
          campaignObjective: "",
          publishingPlatforms: platforms,
          workspaceLanguage: "en",
        });

    const copyMix = resolveCopyMix(platforms);
    const { variants: allVariants } = await runCopyAgentMix({
      campaignContext,
      vision,
      campaignName: campaign?.name,
      strategyPlan: strategy,
      hookSet,
      mix: copyMix,
    });

    await db
      .update(schema.creatives)
      .set({ copyVariants: allVariants, version: creative.version + 1 })
      .where(eq(schema.creatives.id, creative.id));

    await runComplianceAfterRender(taskId, creative.id);
  }

  if (step === "edit") {
    await enqueueRender({
      taskId: task.id,
      creativeId: creative.id,
      workspaceId: task.workspaceId,
      orgId: task.orgId,
      campaignId: task.campaignId,
      mode: "preview",
    });
  }
}

export { runPublishAgent };
