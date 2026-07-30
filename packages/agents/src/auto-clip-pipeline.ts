import { eq } from "drizzle-orm";
import { getDb, schema, getCampaignAssets } from "@ceo-agent/db";
import { enqueueRender, getRenderQueueCounts } from "@ceo-agent/queue";
import {
  AUTO_CLIP,
  type BrandProfile,
  type Platform,
  type StepProgress,
  parseCampaignCreativeBrief,
  buildVideoAnalysisPrompt,
  effectiveCampaignGoal,
  resolveAutoClipPlatforms,
  recommendBgm,
  type BgmRecommendation,
  resolveAutoClipSourceAsset,
  strategyObjectives,
  resolvePipelineContentLocale,
  alignStrategyWithVision,
  getPipelineStageOutput,
  isPipelineStageComplete,
  normalizeStrategyPlan,
  type ContentLocale,
  type MarketingContentPackage,
} from "@ceo-agent/shared";
import {
  provideCampaignAIContext,
  enrichCampaignAIContext,
} from "./campaign-context-provider";
import { failPipelineExecution } from "./pipeline-lifecycle";
import { parseIntent } from "./ceo";
import {
  contentPackageToHookSet,
  buildAutoClipCopyVariants,
} from "./marketing-content";
import { enrichMarketingPackTranslations } from "./marketing-pack-translate";
import { pickSegmentsFromHighlightIndex } from "./highlight-index";
import { AUTO_CLIP_VARIANTS } from "./auto-clip-variants";
import type { PipelineHooks } from "./orchestrator";
import type { CopyLocale, CopyVariant, EditPlan, VisionAnalysis } from "@ceo-agent/shared";
import { mergePipelineContext } from "./merge-context";
import {
  runMarketingContentPipeline,
  runStrategyPipeline,
} from "./marketing-pipeline";
import {
  adaptImageUnderstandingResult,
  adaptMarketingPipelineResult,
  adaptVideoPipelineResult,
} from "./pipeline-adapters";
import { finalizeReviewAfterGates } from "./review-finalization";
import {
  runVideoUnderstandingPipeline,
  videoUnderstandingAsPipelineResult,
} from "./video-understanding-pipeline";
import {
  runCompositionPipeline,
  type CompositionResult,
} from "./composition-pipeline";

function resolveClipVoiceLocale(
  defaultLocale: CopyLocale,
  platforms: Platform[],
  contentLocale: ContentLocale
): CopyLocale {
  if (contentLocale === "zh") return "zh";
  if (platforms.some((p) => p === "xiaohongshu" || p === "douyin")) return "zh";
  return defaultLocale === "zh" && contentLocale === "en" ? "en" : defaultLocale;
}

function campaignHighlightKeywords(...values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values.flatMap((value) =>
        (value ?? "")
          .split(/[^a-zA-Z0-9\u4e00-\u9fff]+/)
          .map((token) => token.trim().toLowerCase())
          .filter((token) => token.length >= 2)
      )
    ),
  ].slice(0, 30);
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

/** V1 Auto Clip: long video → 3 standalone 9:16 clips + unified marketing package. */
export async function runAutoClipPipeline(taskId: string, hooks?: PipelineHooks) {
  console.log(`[auto-clip] start task=${taskId}`);
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

  const source = resolveAutoClipSourceAsset(assets);
  if (!source) throw new Error("Auto Clip requires a source video");

  const { asset: videoAsset, durationSec: sourceDurationSec } = source;
  const imageAssets = assets.filter((a) => a.type === "image");

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
  const bgmBaseCtx = {
    userPreference: creativeBrief.bgmPreference,
    campaignGoal: creativeBrief.campaignGoal,
    contentStyle: creativeBrief.contentStyle,
    voicePreset: creativeBrief.voicePreset,
    campaignBrief: creativeBrief.campaignBrief,
    goal,
    industry: brandProfile.industry ?? null,
  };
  const usedBgmTrackIds: string[] = [];
  const progressSnapshot = (task.stepProgress as StepProgress) ?? {};
  const stageDone = (id: string) =>
    isPipelineStageComplete(progressSnapshot, id);

  await db
    .update(schema.tasks)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(schema.tasks.id, taskId));
  await db
    .update(schema.campaigns)
    .set({ status: "processing" })
    .where(eq(schema.campaigns.id, campaign.id));

  let totalCost = 0;
  const budget = parseFloat(task.costBudgetUsd ?? "0.5");

  try {
    if (!stageDone("parse_intent")) {
      await updateStep(taskId, "parse_intent", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      const intent = parseIntent(goal, campaign.platforms);
      await updateStep(taskId, "parse_intent", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: intent,
      });
    }

    const understandingExecution = await runVideoUnderstandingPipeline({
      source: {
        assetId: videoAsset.id,
        storagePath: videoAsset.storagePath,
        mimeType: videoAsset.mimeType,
        status: videoAsset.status,
        durationSec: sourceDurationSec,
      },
      campaignContext,
      campaignName: campaign.name,
      videoAnalysis,
      highlightKeywords: campaignHighlightKeywords(
        goal,
        creativeBrief.campaignBrief,
        campaign.targetAudienceOverride
      ),
      progress: progressSnapshot,
      dependencies: hooks?.prepareVisionMedia
        ? {
            prepareMedia: (sourceAsset) =>
              hooks.prepareVisionMedia!.prepare({
                storagePath: sourceAsset.storagePath,
                mediaType: "video",
                durationSec: sourceAsset.durationSec,
              }),
          }
        : undefined,
      persistCheckpoint: async ({ checkpoint, status, output }) => {
        const update =
          status === "running"
            ? {
                status,
                startedAt: new Date().toISOString(),
              }
            : {
                status,
                completedAt: new Date().toISOString(),
                output,
              };
        await updateStep(taskId, checkpoint, update);

        const legacyStep =
          checkpoint === "VIDEO_SCENE_ANALYSIS_COMPLETE"
            ? "vision_analyze"
            : checkpoint === "VIDEO_HIGHLIGHTS_COMPLETE"
              ? "highlight_index"
              : undefined;
        if (legacyStep) await updateStep(taskId, legacyStep, update);
      },
    });
    const {
      result: videoUnderstandingResult,
      vision,
      transcriptSummary,
      transcriptSegments,
      highlights: highlightIndex,
      usage: visionUsage,
    } = understandingExecution;
    const normalizedVideoUnderstanding =
      videoUnderstandingAsPipelineResult(videoUnderstandingResult);
    totalCost += visionUsage.costUsd;
    if (
      visionUsage.input > 0 ||
      visionUsage.output > 0 ||
      visionUsage.costUsd > 0
    ) {
      await logAgent(
        task.orgId,
        task.workspaceId,
        taskId,
        "vision",
        visionUsage,
        vision
      );
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // strategy_plan is built from the asset analysis (primary), then brief, then name.
    let strategy = stageDone("strategy_plan")
      ? normalizeStrategyPlan(
          task.strategyJson ??
            campaign.strategyJson ??
            getPipelineStageOutput(progressSnapshot, "strategy_plan")
        )
      : undefined;
    const preStrategyMediaResults = [normalizedVideoUnderstanding];
    if (imageAssets.length > 0) {
      preStrategyMediaResults.push(adaptImageUnderstandingResult({
        assetIds: imageAssets.map((asset) => asset.id),
        classification: vision.mediaType,
        productDetection: vision.products,
        subjectDetection: vision.subjects,
        sceneDetection: vision.scenes,
        confidence:
          vision.confidence === undefined ? {} : { overall: vision.confidence },
      }));
    }
    const preStrategyMergedContext = mergePipelineContext(
      enrichCampaignAIContext(campaignContext, {
        vision,
        transcript: transcriptSummary ?? vision.transcriptSummary ?? null,
      }),
      preStrategyMediaResults
    );
    if (!stageDone("strategy_plan") || !strategy) {
      await updateStep(taskId, "strategy_plan", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      const strategyExecution = await runStrategyPipeline(
        preStrategyMergedContext
      );
      const {
        strategy: rawStrategy,
        industry,
        usage: strategyUsage,
      } = strategyExecution.output;
      strategy = alignStrategyWithVision(rawStrategy, vision, {
        goal,
        campaignBrief: creativeBrief.campaignBrief,
        userNotes:
          campaign.targetAudienceOverride ?? creativeBrief.campaignBrief,
        videoAnalysis: videoAnalysis ?? undefined,
        campaignName: campaign.name,
        locale: contentLocale === "zh" ? "zh" : "en",
      });
      totalCost += strategyUsage.costUsd;
      await logAgent(
        task.orgId,
        task.workspaceId,
        taskId,
        "strategy",
        strategyUsage,
        strategy
      );
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
      await updateStep(taskId, "strategy_plan", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: strategy,
      });
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    const normalizedMediaResults = [normalizedVideoUnderstanding];
    if (imageAssets.length > 0) {
      const imageUnderstanding = adaptImageUnderstandingResult({
        assetIds: imageAssets.map((asset) => asset.id),
        classification: vision.mediaType,
        productDetection: vision.products,
        subjectDetection: vision.subjects,
        sceneDetection: vision.scenes,
        confidence:
          vision.confidence === undefined ? {} : { overall: vision.confidence },
      });
      normalizedMediaResults.push(imageUnderstanding);
      await updateStep(taskId, "image_understanding_output", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: imageUnderstanding,
      });
    }
    const mergedMarketingContext = mergePipelineContext(
      enrichCampaignAIContext(campaignContext, {
        vision,
        strategy,
        transcript: transcriptSummary ?? vision.transcriptSummary ?? null,
      }),
      normalizedMediaResults
    );
    await updateStep(taskId, "merge_context", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: mergedMarketingContext,
    });
    await updateStep(taskId, "video_pipeline_output", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: videoUnderstandingResult,
    });
    let contentPackage = getPipelineStageOutput<MarketingContentPackage>(
      progressSnapshot,
      "content_generate"
    );
    if (!stageDone("content_generate") || !contentPackage) {
      await updateStep(taskId, "content_generate", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      const marketingExecution = await runMarketingContentPipeline(
        mergedMarketingContext
      );
      const {
        contentPackage: rawContentPackage,
        usage: contentUsage,
      } = marketingExecution.output;
      totalCost += contentUsage.costUsd;
      const translated = await enrichMarketingPackTranslations(
        rawContentPackage
      );
      contentPackage = translated.contentPackage;
      totalCost += translated.usage.costUsd;
      await logAgent(
        task.orgId,
        task.workspaceId,
        taskId,
        "marketing_content",
        contentUsage,
        rawContentPackage
      );
      if (translated.usage.costUsd > 0) {
        await logAgent(
          task.orgId,
          task.workspaceId,
          taskId,
          "marketing_translate",
          translated.usage,
          contentPackage
        );
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
    }
    const marketingPipelineResult = adaptMarketingPipelineResult(
      contentPackage as unknown as Record<string, unknown>
    );

    const hookSet =
      (task.hooksJson as ReturnType<typeof contentPackageToHookSet> | null) ??
      getPipelineStageOutput<ReturnType<typeof contentPackageToHookSet>>(
        progressSnapshot,
        "hook_generate"
      ) ??
      contentPackageToHookSet(contentPackage);
    if (!stageDone("hook_generate")) {
      await logAgent(
        task.orgId,
        task.workspaceId,
        taskId,
        "hook",
        { input: 0, output: 0, costUsd: 0 },
        hookSet
      );
      await db
        .update(schema.tasks)
        .set({ hooksJson: hookSet })
        .where(eq(schema.tasks.id, taskId));
      await updateStep(taskId, "hook_generate", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: hookSet,
      });
    }

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    let segments = getPipelineStageOutput<
      ReturnType<typeof pickSegmentsFromHighlightIndex>
    >(progressSnapshot, "clip_segment");
    if (!stageDone("clip_segment") || !segments) {
      await updateStep(taskId, "clip_segment", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      segments = pickSegmentsFromHighlightIndex(
        highlightIndex,
        sourceDurationSec,
        AUTO_CLIP.CLIP_COUNT
      );
      await updateStep(taskId, "clip_segment", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: segments,
      });
    }

    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];
    const clipPlatforms = resolveAutoClipPlatforms(platforms);

    let clipCopies = getPipelineStageOutput<CopyVariant[][]>(
      progressSnapshot,
      "copy_generate"
    );
    if (!stageDone("copy_generate") || !clipCopies) {
      await updateStep(taskId, "copy_generate", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      clipCopies = [];
      for (let i = 0; i < segments.length; i++) {
        const clipPlatform = clipPlatforms[i] ?? clipPlatforms[0]!;
        clipCopies.push(
          buildAutoClipCopyVariants(
            contentPackage,
            strategy,
            i,
            clipPlatform
          )
        );
      }
      await logAgent(
        task.orgId,
        task.workspaceId,
        taskId,
        "copy",
        { input: 0, output: 0, costUsd: 0 },
        clipCopies
      );
      await updateStep(taskId, "copy_generate", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: clipCopies,
      });
    }

    const compositionEntries = segments.map((segment, index) => {
      const clipVariant =
        AUTO_CLIP_VARIANTS[index] ?? AUTO_CLIP_VARIANTS[0]!;
      const clipPlatform = clipPlatforms[index] ?? clipPlatforms[0]!;
      const variants = clipCopies[index] ?? [];
      if (variants.length === 0) throw new Error("Copy generation failed");
      const bgmRecommendation = recommendBgm({
        ...bgmBaseCtx,
        visionHooks: vision.hooks,
        platform: clipPlatform,
        videoArchetype: clipVariant.videoArchetype,
        clipVariant: clipVariant.variant,
        excludeTrackIds: usedBgmTrackIds,
      });
      usedBgmTrackIds.push(bgmRecommendation.trackId);
      return {
        segment,
        copyVariants: variants,
        clipVariant,
        platform: clipPlatform,
        bgmRecommendation,
        voiceLocale: resolveClipVoiceLocale(
          clipVariant.voiceLocale,
          clipPlatforms,
          contentLocale
        ),
        subtitleTimeline: contentPackage.subtitleTimeline,
      };
    });
    const existingDrafts = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.taskId, task.id))
      .orderBy(schema.creatives.createdAt);
    const compositionResult = await runCompositionPipeline({
      mode: "AUTO_CLIP",
      videoResult: videoUnderstandingResult,
      mergedContext: mergedMarketingContext,
      marketingResult: marketingPipelineResult,
      sourceAssetId: videoAsset.id,
      entries: compositionEntries,
      vision,
      voicePreset: creativeBrief.voicePreset,
      bgmStartPreference: creativeBrief.bgmStartPreference,
      resumeResult: getPipelineStageOutput<CompositionResult>(
        progressSnapshot,
        "VIDEO_COMPOSITION_COMPLETE"
      ),
      registry: {
        registerDraft: async (draft) => {
          const existing = existingDrafts[draft.index];
          if (existing) {
            await db
              .update(schema.creatives)
              .set({
                copyVariants: draft.copyVariants,
                selectedCopyId: draft.selectedCopyId,
                editPlan: draft.editPlan,
              })
              .where(eq(schema.creatives.id, existing.id));
            return { creativeId: existing.id };
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
              editPlan: draft.editPlan,
              renderStatus: "preview_rendering",
            })
            .returning();
          if (!created) throw new Error("Creative Draft registration failed");
          existingDrafts.push(created);
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
    const creativeIds = compositionResult.creativeDrafts.map(
      (draft) => draft.creativeId
    );
    await updateStep(taskId, "edit_director_plan", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: { creativeIds, clipCount: creativeIds.length },
    });

    await updateStep(taskId, "ffmpeg_render", {
      status: "running",
      startedAt: new Date().toISOString(),
      output: { clipCount: creativeIds.length, queued: creativeIds.length },
    });

    const existingCreatives = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.taskId, task.id));
    const readyIds = new Set(
      existingCreatives
        .filter(
          (creative) =>
            creative.renderStatus === "preview_ready" &&
            Boolean(creative.videoUrl)
        )
        .map((creative) => creative.id)
    );
    for (const creativeId of creativeIds.filter((id) => !readyIds.has(id))) {
      await enqueueRender({
        taskId: task.id,
        creativeId,
        workspaceId: task.workspaceId,
        orgId: task.orgId,
        campaignId: campaign.id,
        mode: "preview",
      });
    }

    if (readyIds.size === creativeIds.length) {
      const finalized = await maybeFinalizeAutoClipTask(taskId);
      return {
        taskId,
        creativeIds,
        status: finalized ? "review_ready" as const : "render_queued" as const,
      };
    }

    const queueCounts = await getRenderQueueCounts().catch(() => null);
    console.log(
      `[auto-clip] queued ${creativeIds.length} preview render jobs task=${taskId} — waiting for ffmpeg.render worker` +
        (queueCounts
          ? ` (queue: waiting=${queueCounts.waiting ?? 0} active=${queueCounts.active ?? 0})`
          : "")
    );

    return { taskId, creativeIds, status: "render_queued" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto Clip pipeline failed";
    await failPipelineExecution({
      taskId,
      campaignId: campaign.id,
      message,
    });
    throw error;
  }
}

/** Called after each clip render — completes task when all clips are preview-ready. */
export async function maybeFinalizeAutoClipTask(taskId: string) {
  const db = getDb();
  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId));

  if (creatives.length < AUTO_CLIP.CLIP_COUNT) return false;

  const anyFailed = creatives.some((c) => {
    const progress = c.renderProgress as { error?: string } | null;
    return c.status === "failed" || Boolean(progress?.error);
  });
  if (anyFailed) return false;

  const allPreviewReady = creatives.every(
    (c) => c.renderStatus === "preview_ready" && Boolean(c.videoUrl)
  );
  if (!allPreviewReady) return false;

  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return false;

  // Auto Clip uses the same mandatory gate boundary as the general path.
  // The dynamic import avoids a static orchestrator cycle while preserving one
  // gate implementation for Compliance and Marketing Score.
  const { runComplianceAfterRender } = await import("./orchestrator");
  for (const creative of creatives) {
    await runComplianceAfterRender(taskId, creative.id, { finalizeReview: false });
  }

  const [gatedTask] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  const progress = (gatedTask?.stepProgress as StepProgress) ?? {};
  const vision = progress.vision_analyze?.output as VisionAnalysis | undefined;
  const videoPipelineResult = adaptVideoPipelineResult({
    assetIds:
      ((progress.merge_context?.output as {
        assetIds?: string[];
      } | undefined)?.assetIds ?? []).filter(Boolean),
    creativeIds: creatives.map((creative) => creative.id),
    transcript: vision?.transcriptSummary ?? null,
    sceneAnalysis: vision?.scenes,
    suggestedMoments: vision?.suggestedMoments,
    selectedHighlights: progress.highlight_index?.output,
    editPlanReferences: creatives.map((creative) => ({
      creativeId: creative.id,
      editPlan: creative.editPlan,
    })),
    renderedCreativeReferences: creatives.map((creative) => ({
      creativeId: creative.id,
      videoUrl: creative.videoUrl,
      coverUrl: creative.coverUrl,
    })),
    subtitleReferences: creatives.map((creative) => ({
      creativeId: creative.id,
      subtitles: (creative.editPlan as EditPlan | null)?.subtitles ?? [],
    })),
    confidence:
      vision?.confidence === undefined ? {} : { overall: vision.confidence },
    complete: true,
  });
  await updateStep(taskId, "video_pipeline_output", {
    status: "completed",
    completedAt: new Date().toISOString(),
    output: videoPipelineResult,
  });

  const [freshTask] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  const finalProgress = (freshTask?.stepProgress as StepProgress) ?? {};
  finalProgress.ffmpeg_render = {
    ...finalProgress.ffmpeg_render,
    status: "completed",
    completedAt: new Date().toISOString(),
    output: { clipCount: creatives.length, allReady: true },
  };
  if (
    finalProgress.compliance_check?.status !== "completed" ||
    finalProgress.marketing_score?.status !== "completed"
  ) {
    throw new Error("Auto Clip mandatory gates did not complete");
  }
  finalProgress.human_review = {
    status: "pending",
    startedAt: new Date().toISOString(),
    output: { creativeIds: creatives.map((c) => c.id) },
  };
  finalProgress.export_ready = { status: "pending" };

  await finalizeReviewAfterGates(
    creatives.map((creative) => ({
      progress: finalProgress,
      creativeRegistered: Boolean(creative.id),
      outputReady:
        creative.renderStatus === "preview_ready" && Boolean(creative.videoUrl),
    })),
    {
      taskId,
      campaignId: task.campaignId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      creativeIds: creatives.map((creative) => creative.id),
      finalOutputReferences: creatives
        .map((creative) => creative.videoUrl)
        .filter((reference): reference is string => Boolean(reference)),
      progress: finalProgress,
    }
  );

  return true;
}
