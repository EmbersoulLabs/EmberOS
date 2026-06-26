import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
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
} from "@ceo-agent/shared";
import { runCeoAgent, parseIntent } from "./ceo";
import { runStrategyAgent } from "./strategy";
import { runMarketingContentAgent, contentPackageToHookSet, contentPackageToCopyVariants, contentLocaleFromMetadata } from "./marketing-content";
import { enrichMarketingPackTranslations } from "./marketing-pack-translate";
import { runScoreAgent } from "./score";
import { runVisionAgent } from "./vision";
import { runCopyAgentMix } from "./copy";
import { runEditDirectorAgent } from "./edit";
import { runComplianceAgent } from "./compliance";
import { runPublishAgent } from "./publish";
import type { Platform, StrategyPlan, HookSet } from "@ceo-agent/shared";
import { runContentTypeAgent } from "./content-type";
import { resolveCopyMix, getPresetProfile } from "@ceo-agent/shared";
import { buildImageMontageEditPlan, buildMixedMontageEditPlan, attachVoiceover } from "./motion-compose";
import { runAutoClipPipeline } from "./auto-clip-pipeline";
import { applyVoicePreset } from "./voice-preset";
import type { VisionFrameInput } from "./vision";

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
  const assets = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.campaignId, campaign.id),
        eq(schema.assets.workspaceId, task.workspaceId)
      )
    );

  const sourceVideo = resolveAutoClipSourceAsset(assets);
  if (sourceVideo) {
    console.log(
      `[agent.pipeline] route=auto_clip task=${taskId} source=${sourceVideo.asset.id} dur=${sourceVideo.durationSec.toFixed(1)}s`
    );
    return runAutoClipPipeline(taskId, hooks);
  }
  console.log(`[agent.pipeline] route=agency task=${taskId} (no playable source video)`);

  const creativeBrief = parseCampaignCreativeBrief(campaign);
  const videoAnalysis = buildVideoAnalysisPrompt(creativeBrief);
  const goal = effectiveCampaignGoal(creativeBrief, campaign.goal);

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
    await updateStep(taskId, "parse_intent", { status: "completed", completedAt: new Date().toISOString(), output: intent });

    // strategy_plan
    await updateStep(taskId, "strategy_plan", { status: "running", startedAt: new Date().toISOString() });
    const { strategy, industry, knowledgeSnippets, usage: strategyUsage } = await runStrategyAgent({
      goal,
      campaignName: campaign.name,
      platforms: campaign.platforms,
      brandProfile,
      videoAnalysis,
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

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // ceo_plan
    await updateStep(taskId, "ceo_plan", { status: "running", startedAt: new Date().toISOString() });
    const assetSummary = assets.map((a) => `${a.type}:${a.id}`).join(", ");
    const { taskGraph, usage: ceoUsage } = await runCeoAgent({
      goal,
      platforms: campaign.platforms,
      assetSummary,
      brandProfile,
      costBudgetUsd: budget,
      strategyPlan: strategy,
      knowledgeSnippets,
      campaignName: campaign.name,
      videoAnalysis,
    });
    totalCost += ceoUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "ceo", ceoUsage, taskGraph);
    await db.update(schema.tasks).set({ ceoPlan: taskGraph }).where(eq(schema.tasks.id, taskId));
    await updateStep(taskId, "ceo_plan", { status: "completed", completedAt: new Date().toISOString(), output: taskGraph });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // vision
    await updateStep(taskId, "vision_analyze", { status: "running", startedAt: new Date().toISOString() });
    const videoAsset = assets.find((a) => a.type === "video");
    const imageAssets = assets.filter((a) => a.type === "image");
    const primaryAsset = videoAsset ?? imageAssets[0];
    if (!primaryAsset) throw new Error("No assets uploaded");

    let visionFrames: VisionFrameInput[] = [];
    let transcriptSummary: string | undefined;
    if (hooks?.prepareVisionMedia) {
      const visionSources = videoAsset ? [videoAsset, ...imageAssets] : imageAssets;
      for (const asset of visionSources.slice(0, 8)) {
        const prepared = await hooks.prepareVisionMedia.prepare({
          storagePath: asset.storagePath,
          mediaType: asset.type as "video" | "image",
          durationSec: asset.durationSec ? parseFloat(asset.durationSec) : undefined,
        });
        visionFrames.push(...prepared.frames);
        if (!transcriptSummary && prepared.transcriptSummary) {
          transcriptSummary = prepared.transcriptSummary;
        }
        if (visionFrames.length >= 8) break;
      }
      visionFrames = visionFrames.slice(0, 8);
    }

    const { analysis: vision, usage: visionUsage } = await runVisionAgent({
      assetId: primaryAsset.id,
      mediaType: primaryAsset.type as "video" | "image",
      durationSec: primaryAsset.durationSec ? parseFloat(primaryAsset.durationSec) : undefined,
      campaignName: campaign.name,
      goal,
      videoAnalysis,
      frames: visionFrames.length > 0 ? visionFrames : undefined,
      transcriptSummary,
    });
    totalCost += visionUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "vision", visionUsage, vision);
    await updateStep(taskId, "vision_analyze", { status: "completed", completedAt: new Date().toISOString(), output: vision });

    // content classify + preset
    await updateStep(taskId, "content_classify", { status: "running", startedAt: new Date().toISOString() });
    const { classification, usage: classifyUsage } = await runContentTypeAgent({
      goal,
      videoAnalysis,
      campaignName: campaign.name,
      vision,
      platforms: campaign.platforms,
    });
    totalCost += classifyUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "content_type", classifyUsage, classification);
    const preset = getPresetProfile(classification.presetId);
    const campaignMeta = (campaign.metadata ?? {}) as Record<string, unknown>;
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
      output: { ...classification, presetLabel: preset.labelZh },
    });

    // content_generate — unified marketing package from strategy + vision
    await updateStep(taskId, "content_generate", { status: "running", startedAt: new Date().toISOString() });
    const { contentPackage: rawContentPackage, usage: contentUsage } = await runMarketingContentAgent({
      strategy,
      vision,
      videoAnalysis,
      userNotes: creativeBrief.campaignBrief,
      goal,
      campaignName: campaign.name,
      platforms: campaign.platforms,
      contentLocale: contentLocaleFromMetadata(campaign.metadata as Record<string, unknown> | null),
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

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];
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

    const allVariants = contentPackageToCopyVariants(contentPackage, strategy, platforms);
    const recommendedVariantId = allVariants.find((v) => v.locale === "en")?.id ?? allVariants[0]?.id ?? "v-en-1";
    await logAgent(task.orgId, task.workspaceId, taskId, "copy", { input: 0, output: 0, costUsd: 0 }, allVariants);
    await updateStep(taskId, "copy_generate", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: allVariants,
    });

    // create creative
    const [creative] = await db
      .insert(schema.creatives)
      .values({
        orgId: task.orgId,
        workspaceId: task.workspaceId,
        campaignId: campaign.id,
        taskId: task.id,
        status: "processing",
        copyVariants: allVariants,
        selectedCopyId: recommendedVariantId,
        selectedHookId: hookSet.recommendedHookId ?? hookSet.hooks[0]?.id,
      })
      .returning();

    // edit director
    await updateStep(taskId, "edit_director_plan", { status: "running", startedAt: new Date().toISOString() });
    let editPlan;
    if (videoAsset && imageAssets.length > 0) {
      editPlan = buildMixedMontageEditPlan({
        vision,
        preset,
        copyVariants: allVariants,
        videoAssetId: videoAsset.id,
        imageAssetIds: imageAssets.map((a) => a.id),
        sourceDurationSec: videoAsset.durationSec ? parseFloat(videoAsset.durationSec) : 15,
      });
      await logAgent(task.orgId, task.workspaceId, taskId, "edit", { input: 0, output: 0, costUsd: 0 }, editPlan);
    } else if (videoAsset) {
      const { editPlan: videoPlan, usage: editUsage } = await runEditDirectorAgent({
        vision,
        copyVariants: allVariants,
        preset,
        assetId: videoAsset.id,
        durationSec: videoAsset.durationSec ? parseFloat(videoAsset.durationSec) : 15,
        goal,
        campaignName: campaign.name,
      });
      editPlan = videoPlan;
      totalCost += editUsage.costUsd;
      await logAgent(task.orgId, task.workspaceId, taskId, "edit", editUsage, editPlan);
    } else {
      editPlan = buildImageMontageEditPlan({
        vision,
        preset,
        copyVariants: allVariants,
        imageAssetIds: imageAssets.map((a) => a.id),
      });
      await logAgent(task.orgId, task.workspaceId, taskId, "edit", { input: 0, output: 0, costUsd: 0 }, editPlan);
    }
    editPlan = attachVoiceover(editPlan, allVariants, platforms, goal, contentPackage.subtitleTimeline);
    editPlan = applyVoicePreset(editPlan, creativeBrief.voicePreset);
    await db
      .update(schema.creatives)
      .set({ editPlan })
      .where(eq(schema.creatives.id, creative!.id));
    await updateStep(taskId, "edit_director_plan", { status: "completed", completedAt: new Date().toISOString(), output: editPlan });

    // enqueue ffmpeg render
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

export async function runComplianceAfterRender(taskId: string, creativeId: string) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);
  if (!task || !creative) return;

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, task.workspaceId))
    .limit(1);
  const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
  const variants = (creative.copyVariants ?? []) as import("@ceo-agent/shared").CopyVariant[];
  const editPlan = creative.editPlan as import("@ceo-agent/shared").EditPlan | null;
  const subtitles = editPlan?.subtitles?.map((s) => s.text) ?? [];

  await updateStep(taskId, "compliance_check", { status: "running", startedAt: new Date().toISOString() });
  const { result, usage } = await runComplianceAgent({ copyVariants: variants, subtitles, brandProfile });
  await logAgent(task.orgId, task.workspaceId, taskId, "compliance", usage, result);

  const newStatus = result.passed ? "pending_internal_review" : "compliance_failed";
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
      await db
        .update(schema.tasks)
        .set({ retryCount: task.retryCount + 1 })
        .where(eq(schema.tasks.id, taskId));
    } else {
      await db.update(schema.tasks).set({ status: "failed" }).where(eq(schema.tasks.id, taskId));
      await db
        .update(schema.campaigns)
        .set({ status: "failed" })
        .where(eq(schema.campaigns.id, task.campaignId));
    }
    return;
  }

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);
  const progress = (task.stepProgress as StepProgress) ?? {};
  const rawStrategy =
    task.strategyJson ?? campaign?.strategyJson ?? progress.strategy_plan?.output;
  const strategy = rawStrategy ? normalizeStrategyPlan(rawStrategy) : undefined;
  const hookSet =
    (task.hooksJson as HookSet | null) ??
    (progress.hook_generate?.output as HookSet);
  const vision = progress.vision_analyze?.output as import("@ceo-agent/shared").VisionAnalysis;
  const platforms = (campaign?.platforms ?? ["tiktok"]) as Platform[];
  const creativeBrief = campaign ? parseCampaignCreativeBrief(campaign) : null;
  const videoAnalysis = creativeBrief ? buildVideoAnalysisPrompt(creativeBrief) : null;

  if (strategy && hookSet && vision) {
    await updateStep(taskId, "marketing_score", { status: "running", startedAt: new Date().toISOString() });
    const { score, usage: scoreUsage } = await runScoreAgent({
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
    } catch {
      // Table may not be migrated yet; score still stored on task/creative JSON
    }

    await updateStep(taskId, "marketing_score", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: score,
    });
  } else {
    await updateStep(taskId, "marketing_score", { status: "skipped", completedAt: new Date().toISOString() });
  }

  await db
    .update(schema.tasks)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(schema.tasks.id, taskId));
  await db
    .update(schema.campaigns)
    .set({ status: "pending_internal_review" })
    .where(eq(schema.campaigns.id, task.campaignId));
  await updateStep(taskId, "human_review", { status: "pending" });
}

export async function retryPipelineStep(
  taskId: string,
  step: "copy" | "edit" | "full"
) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error("Task not found");
  if (task.retryCount >= CEO_MAX_RETRIES) throw new Error("Max retries exceeded");

  await db
    .update(schema.tasks)
    .set({ retryCount: task.retryCount + 1, status: "running" })
    .where(eq(schema.tasks.id, taskId));

  if (step === "full") {
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

    const copyMix = resolveCopyMix(platforms);
    const { variants: allVariants } = await runCopyAgentMix({
      vision,
      brandProfile,
      goal: campaign?.goal ?? "",
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
