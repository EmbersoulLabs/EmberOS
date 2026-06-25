import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";
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
} from "@ceo-agent/shared";
import { parseIntent } from "./ceo";
import { runVisionAgent } from "./vision";
import { runCopyAgent } from "./copy";
import { pickAutoClipSegments, buildStandaloneClipEditPlan, attachAutoClipVoiceover } from "./auto-clip";
import { AUTO_CLIP_VARIANTS } from "./auto-clip-variants";
import { applyVoicePreset } from "./voice-preset";
import { runAutoClipScoreAgent } from "./score";
import type { PipelineHooks } from "./orchestrator";
import type { VisionFrameInput } from "./vision";
import type { CopyLocale, CopyVariant, EditPlan, VisionAnalysis } from "@ceo-agent/shared";

function resolveClipVoiceLocale(
  defaultLocale: CopyLocale,
  platforms: Platform[],
  goal: string
): CopyLocale {
  if (/[\u4e00-\u9fff]/.test(goal)) return "zh";
  if (platforms.some((p) => p === "xiaohongshu" || p === "douyin")) return "zh";
  return defaultLocale;
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

/** V1 Auto Clip: long video → 3 standalone 9:16 clips + per-clip copy. */
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
  const videoAnalysis = buildVideoAnalysisPrompt(creativeBrief);
  const goal = effectiveCampaignGoal(creativeBrief, campaign.goal);
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

    await updateStep(taskId, "vision_analyze", { status: "running", startedAt: new Date().toISOString() });
    let visionFrames: VisionFrameInput[] = [];
    let transcriptSummary: string | undefined;
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
          transcriptSummary = prepared.transcriptSummary;
        }
      }
    }

    const { analysis: vision, usage: visionUsage } = await runVisionAgent({
      assetId: videoAsset.id,
      mediaType: "video",
      durationSec: sourceDurationSec,
      campaignName: campaign.name,
      goal,
      videoAnalysis,
      frames: visionFrames.length > 0 ? visionFrames : undefined,
      transcriptSummary,
    });
    totalCost += visionUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "vision", visionUsage, vision);
    await updateStep(taskId, "vision_analyze", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: vision,
    });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    await updateStep(taskId, "clip_segment", { status: "running", startedAt: new Date().toISOString() });
    const segments = pickAutoClipSegments(vision, sourceDurationSec, AUTO_CLIP.CLIP_COUNT);
    await updateStep(taskId, "clip_segment", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: segments,
    });

    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];
    const clipPlatforms = resolveAutoClipPlatforms(platforms);

    await updateStep(taskId, "copy_generate", { status: "running", startedAt: new Date().toISOString() });
    const clipCopies: Awaited<ReturnType<typeof runCopyAgent>>["variants"][] = [];
    let copyUsageTotal = { input: 0, output: 0, costUsd: 0 };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const clipVariant = AUTO_CLIP_VARIANTS[i] ?? AUTO_CLIP_VARIANTS[0]!;
      const clipPlatform = clipPlatforms[i] ?? clipPlatforms[0]!;
      const clipGoal = `${goal}. Clip focus (${clipVariant.title}): ${clipVariant.focus}. Target platform: ${clipPlatform}.`;
      const visionForClip = {
        ...vision,
        hooks: [...vision.hooks, segment.reason],
        suggestedMoments: [segment],
      };

      const [zhResult, enResult] = await Promise.all([
        runCopyAgent({
          vision: visionForClip,
          brandProfile,
          platform: clipPlatform,
          goal: clipGoal,
          campaignName: `${campaign.name} — Clip ${i + 1}`,
          slotIds: [`clip-${i + 1}-zh`],
          templates: ["story"],
          locale: "zh",
          videoAnalysis,
        }),
        runCopyAgent({
          vision: visionForClip,
          brandProfile,
          platform: clipPlatform,
          goal: clipGoal,
          campaignName: `${campaign.name} — Clip ${i + 1}`,
          slotIds: [`clip-${i + 1}-en`],
          templates: ["story"],
          locale: "en",
          videoAnalysis,
        }),
      ]);

      const variants = [zhResult.variants[0], enResult.variants[0]].filter(
        (v): v is NonNullable<typeof v> => Boolean(v)
      );
      clipCopies.push(variants);

      copyUsageTotal.input += zhResult.usage.input + enResult.usage.input;
      copyUsageTotal.output += zhResult.usage.output + enResult.usage.output;
      copyUsageTotal.costUsd += zhResult.usage.costUsd + enResult.usage.costUsd;
    }

    totalCost += copyUsageTotal.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "copy", copyUsageTotal, clipCopies);
    await updateStep(taskId, "copy_generate", {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: clipCopies,
    });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

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
      });
      editPlan = attachAutoClipVoiceover(
        editPlan,
        variants,
        resolveClipVoiceLocale(clipVariant.voiceLocale, clipPlatforms, goal)
      );
      editPlan = applyVoicePreset(editPlan, creativeBrief.voicePreset);

      const primaryCopy = variants.find((v) => v.locale === "zh") ?? variants[0]!;

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

  for (const creative of creatives) {
    await db
      .update(schema.creatives)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.creatives.id, creative.id));
  }

  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return true;

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);
  const vision = ((task.stepProgress as StepProgress) ?? {}).vision_analyze?.output as
    | VisionAnalysis
    | undefined;
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
    .set({ status: "export_ready" })
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
  finalProgress.human_review = { status: "skipped", completedAt: new Date().toISOString() };
  finalProgress.export_ready = {
    status: "completed",
    completedAt: new Date().toISOString(),
    output: { creativeIds: creatives.map((c) => c.id) },
  };

  await db
    .update(schema.tasks)
    .set({ stepProgress: finalProgress, currentStep: "export_ready" })
    .where(eq(schema.tasks.id, taskId));

  return true;
}
