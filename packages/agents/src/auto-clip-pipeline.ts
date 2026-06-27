import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
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
  getBgmTrackById,
  resolveBgmStartOffsetSec,
  type BgmRecommendation,
  resolveAutoClipSourceAsset,
  strategyObjectives,
  resolvePipelineContentLocale,
  alignStrategyWithVision,
  type ContentLocale,
} from "@ceo-agent/shared";
import { parseIntent } from "./ceo";
import { runStrategyAgent } from "./strategy";
import {
  runMarketingContentAgent,
  contentPackageToHookSet,
  buildAutoClipCopyVariants,
} from "./marketing-content";
import { enrichMarketingPackTranslations } from "./marketing-pack-translate";
import { runVisionAgent } from "./vision";
import { buildStandaloneClipEditPlan, attachAutoClipVoiceover } from "./auto-clip";
import { buildHighlightIndex, pickSegmentsFromHighlightIndex, type TranscriptSegment } from "./highlight-index";
import { AUTO_CLIP_VARIANTS } from "./auto-clip-variants";
import { applyVoicePreset } from "./voice-preset";
import { runAutoClipScoreAgent } from "./score";
import type { PipelineHooks } from "./orchestrator";
import type { VisionFrameInput } from "./vision";
import type { CopyLocale, CopyVariant, EditPlan, VisionAnalysis } from "@ceo-agent/shared";

function resolveClipVoiceLocale(
  defaultLocale: CopyLocale,
  platforms: Platform[],
  contentLocale: ContentLocale
): CopyLocale {
  if (contentLocale === "zh") return "zh";
  if (platforms.some((p) => p === "xiaohongshu" || p === "douyin")) return "zh";
  return defaultLocale === "zh" && contentLocale === "en" ? "en" : defaultLocale;
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
  const assets = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.campaignId, campaign.id),
        eq(schema.assets.workspaceId, task.workspaceId)
      )
    );

  const source = resolveAutoClipSourceAsset(assets);
  if (!source) throw new Error("Auto Clip requires a source video");

  const { asset: videoAsset, durationSec: sourceDurationSec } = source;
  const imageAssets = assets.filter((a) => a.type === "image");

  const creativeBrief = parseCampaignCreativeBrief(campaign);
  const campaignMeta = (campaign.metadata ?? {}) as Record<string, unknown>;
  const contentLocale = resolvePipelineContentLocale(campaignMeta, campaign.goal);
  const videoAnalysis = buildVideoAnalysisPrompt(creativeBrief);
  const goal = effectiveCampaignGoal(creativeBrief, campaign.goal, contentLocale);
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
    await updateStep(taskId, "parse_intent", { status: "running", startedAt: new Date().toISOString() });
    const intent = parseIntent(goal, campaign.platforms);
    await updateStep(taskId, "parse_intent", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: intent,
    });

    // vision_analyze runs FIRST so the marketing plan is grounded in the real assets.
    await updateStep(taskId, "vision_analyze", { status: "running", startedAt: new Date().toISOString() });
    let visionFrames: VisionFrameInput[] = [];
    let transcriptSummary: string | undefined;
    let transcriptSegments: TranscriptSegment[] = [];
    if (hooks?.prepareVisionMedia) {
      const visionSources = [videoAsset, ...imageAssets];
      for (const asset of visionSources.slice(0, 8)) {
        const prepared = await hooks.prepareVisionMedia.prepare({
          storagePath: asset.storagePath,
          mediaType: asset.type as "video" | "image",
          durationSec: asset.durationSec ? parseFloat(asset.durationSec) : undefined,
        });
        visionFrames.push(...prepared.frames);
        if (asset.type === "video") {
          transcriptSummary = prepared.transcriptSummary ?? transcriptSummary;
          if (prepared.transcriptSegments?.length) {
            transcriptSegments = prepared.transcriptSegments;
          }
        }
      }
    }

    const { analysis: vision, usage: visionUsage } = await runVisionAgent({
      assetId: videoAsset.id,
      mediaType: "video",
      durationSec: sourceDurationSec,
      campaignName: campaign.name,
      goal,
      campaignBrief: creativeBrief.campaignBrief,
      videoAnalysis,
      frames: visionFrames.length > 0 ? visionFrames : undefined,
      transcriptSummary,
      contentLocale,
    });
    totalCost += visionUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "vision", visionUsage, vision);
    await updateStep(taskId, "vision_analyze", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: vision,
    });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // strategy_plan is built from the asset analysis (primary), then brief, then name.
    await updateStep(taskId, "strategy_plan", { status: "running", startedAt: new Date().toISOString() });
    const { strategy: rawStrategy, industry, usage: strategyUsage } = await runStrategyAgent({
      goal,
      campaignName: campaign.name,
      platforms: campaign.platforms,
      brandProfile,
      vision,
      videoAnalysis,
      contentLocale,
    });
    let strategy = alignStrategyWithVision(rawStrategy, vision, {
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
    await updateStep(taskId, "strategy_plan", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: strategy,
    });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    await updateStep(taskId, "highlight_index", { status: "running", startedAt: new Date().toISOString() });
    const highlightIndex = buildHighlightIndex({
      vision,
      sourceDurationSec,
      transcriptSegments,
      transcriptSummary,
      keywords: strategy.keywords,
    });
    await updateStep(taskId, "highlight_index", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: highlightIndex,
    });

    await updateStep(taskId, "content_generate", { status: "running", startedAt: new Date().toISOString() });
    const { contentPackage: rawContentPackage, usage: contentUsage } = await runMarketingContentAgent({
      strategy,
      vision,
      videoAnalysis,
      userNotes: creativeBrief.campaignBrief,
      goal,
      campaignName: campaign.name,
      platforms: campaign.platforms,
      contentLocale,
    });
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

    const hookSet = contentPackageToHookSet(contentPackage);
    await logAgent(task.orgId, task.workspaceId, taskId, "hook", { input: 0, output: 0, costUsd: 0 }, hookSet);
    await db
      .update(schema.tasks)
      .set({ hooksJson: hookSet })
      .where(eq(schema.tasks.id, taskId));
    await updateStep(taskId, "hook_generate", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: hookSet,
    });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    await updateStep(taskId, "clip_segment", { status: "running", startedAt: new Date().toISOString() });
    const segments = pickSegmentsFromHighlightIndex(highlightIndex, sourceDurationSec, AUTO_CLIP.CLIP_COUNT);
    await updateStep(taskId, "clip_segment", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: segments,
    });

    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];
    const clipPlatforms = resolveAutoClipPlatforms(platforms);

    await updateStep(taskId, "copy_generate", { status: "running", startedAt: new Date().toISOString() });
    const clipCopies: CopyVariant[][] = [];
    for (let i = 0; i < segments.length; i++) {
      const clipPlatform = clipPlatforms[i] ?? clipPlatforms[0]!;
      clipCopies.push(buildAutoClipCopyVariants(contentPackage, strategy, i, clipPlatform));
    }
    await logAgent(task.orgId, task.workspaceId, taskId, "copy", { input: 0, output: 0, costUsd: 0 }, clipCopies);
    await updateStep(taskId, "copy_generate", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: clipCopies,
    });

    await updateStep(taskId, "edit_director_plan", { status: "running", startedAt: new Date().toISOString() });
    const creativeIds: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const clipVariant = AUTO_CLIP_VARIANTS[i] ?? AUTO_CLIP_VARIANTS[0]!;
      const clipPlatform = clipPlatforms[i] ?? clipPlatforms[0]!;
      const variants = clipCopies[i] ?? [];
      if (variants.length === 0) throw new Error("Copy generation failed");

      const bgmRec = recommendBgm({
        ...bgmBaseCtx,
        visionHooks: vision.hooks,
        platform: clipPlatform,
        videoArchetype: clipVariant.videoArchetype,
        clipVariant: clipVariant.variant,
        excludeTrackIds: usedBgmTrackIds,
      });
      usedBgmTrackIds.push(bgmRec.trackId);

      let editPlan = buildStandaloneClipEditPlan({
        assetId: videoAsset.id,
        segment,
        copyVariants: variants,
        clipVariant,
        platform: clipPlatform,
        bgmKey: bgmRec.trackId,
        bgmRecommendation: bgmRec,
        vision,
        subtitleTimeline: contentPackage.subtitleTimeline,
      });
      editPlan = attachAutoClipVoiceover(
        editPlan,
        variants,
        resolveClipVoiceLocale(clipVariant.voiceLocale, clipPlatforms, contentLocale),
        contentPackage.subtitleTimeline
      );
      editPlan = applyVoicePreset(editPlan, creativeBrief.voicePreset);

      const bgmTrack = getBgmTrackById(bgmRec.trackId);
      editPlan = {
        ...editPlan,
        audio: {
          ...editPlan.audio,
          bgmStartOffsetSec: resolveBgmStartOffsetSec(
            bgmTrack?.durationSec ?? 120,
            editPlan.targetDurationSec,
            creativeBrief.bgmStartPreference ?? "auto"
          ),
        },
      };

      const primaryLocale = contentLocale === "zh" ? "zh" : "en";
      const primaryCopy = variants.find((v) => v.locale === primaryLocale) ?? variants[0]!;

      const [creative] = await db
        .insert(schema.creatives)
        .values({
          orgId: task.orgId,
          workspaceId: task.workspaceId,
          campaignId: campaign.id,
          taskId: task.id,
          status: "processing",
          copyVariants: variants,
          selectedCopyId: primaryCopy.id,
          editPlan,
          renderStatus: "preview_rendering",
        })
        .returning();

      creativeIds.push(creative!.id);
    }

    await updateStep(taskId, "edit_director_plan", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: { creativeIds, clipCount: segments.length },
    });

    await updateStep(taskId, "ffmpeg_render", {
      status: "running",
      startedAt: new Date().toISOString(),
      output: { clipCount: creativeIds.length, queued: creativeIds.length },
    });

    for (const creativeId of creativeIds) {
      await enqueueRender({
        taskId: task.id,
        creativeId,
        workspaceId: task.workspaceId,
        orgId: task.orgId,
        campaignId: campaign.id,
        mode: "preview",
      });
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
    await db
      .update(schema.tasks)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(schema.tasks.id, taskId));
    await db
      .update(schema.campaigns)
      .set({ status: "failed" })
      .where(eq(schema.campaigns.id, campaign.id));
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

  for (const creative of creatives) {
    await db
      .update(schema.creatives)
      .set({ status: "pending_internal_review", updatedAt: new Date() })
      .where(eq(schema.creatives.id, creative.id));

    const [existing] = await db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.creativeId, creative.id),
          eq(schema.reviews.reviewerType, "internal"),
          eq(schema.reviews.decision, "pending")
        )
      )
      .limit(1);

    if (!existing) {
      await db.insert(schema.reviews).values({
        orgId: task.orgId,
        workspaceId: task.workspaceId,
        creativeId: creative.id,
        reviewerType: "internal",
        decision: "pending",
      });
    }
  }

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);
  const progress = (task.stepProgress as StepProgress) ?? {};
  const vision = progress.vision_analyze?.output as VisionAnalysis | undefined;
  const platforms = (campaign?.platforms ?? ["tiktok"]) as Platform[];

  if (vision && campaign) {
    await updateStep(taskId, "marketing_score", { status: "running", startedAt: new Date().toISOString() });
    try {
      const primary = creatives[0]!;
      const variants = (primary.copyVariants ?? []) as CopyVariant[];
      const editPlan = primary.editPlan as EditPlan | null;
      const { score, usage } = await runAutoClipScoreAgent({
        vision,
        copyVariants: variants,
        editPlan,
        platforms,
      });
      await logAgent(task.orgId, task.workspaceId, taskId, "score", usage, score);
      await db
        .update(schema.tasks)
        .set({ marketingScoreJson: score })
        .where(eq(schema.tasks.id, taskId));
      for (const creative of creatives) {
        await db
          .update(schema.creatives)
          .set({ marketingScoreJson: score })
          .where(eq(schema.creatives.id, creative.id));
      }
      await updateStep(taskId, "marketing_score", {
        status: "completed",
        completedAt: new Date().toISOString(),
        output: score,
      });
    } catch (err) {
      console.warn("[auto-clip] marketing score failed:", err);
      await updateStep(taskId, "marketing_score", {
        status: "skipped",
        completedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "score failed",
      });
    }
  } else {
    await updateStep(taskId, "marketing_score", {
      status: "skipped",
      completedAt: new Date().toISOString(),
    });
  }

  await db
    .update(schema.tasks)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(schema.tasks.id, taskId));
  await db
    .update(schema.campaigns)
    .set({ status: "pending_internal_review" })
    .where(eq(schema.campaigns.id, task.campaignId));

  const [freshTask] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  const finalProgress = (freshTask?.stepProgress as StepProgress) ?? {};
  finalProgress.ffmpeg_render = {
    ...finalProgress.ffmpeg_render,
    status: "completed",
    completedAt: new Date().toISOString(),
    output: { clipCount: creatives.length, allReady: true },
  };
  finalProgress.compliance_check = { status: "skipped", completedAt: new Date().toISOString() };
  if (!finalProgress.marketing_score) {
    finalProgress.marketing_score = { status: "skipped", completedAt: new Date().toISOString() };
  }
  finalProgress.human_review = {
    status: "pending",
    startedAt: new Date().toISOString(),
    output: { creativeIds: creatives.map((c) => c.id) },
  };
  finalProgress.export_ready = { status: "pending" };

  await db
    .update(schema.tasks)
    .set({ stepProgress: finalProgress, currentStep: "human_review" })
    .where(eq(schema.tasks.id, taskId));

  return true;
}
