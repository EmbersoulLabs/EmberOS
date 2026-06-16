import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";
import { CEO_MAX_RETRIES, type BrandProfile, type StepProgress } from "@ceo-agent/shared";
import { runCeoAgent, parseIntent } from "./ceo";
import { runVisionAgent } from "./vision";
import { runCopyAgent } from "./copy";
import { runEditDirectorAgent } from "./edit";
import { runComplianceAgent } from "./compliance";
import { runPublishAgent } from "./publish";
import type { Platform } from "@ceo-agent/shared";

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

export async function runPipeline(taskId: string) {
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
    // parse_intent + ceo_plan
    await updateStep(taskId, "parse_intent", { status: "running", startedAt: new Date().toISOString() });
    const intent = parseIntent(campaign.goal ?? "", campaign.platforms);
    await updateStep(taskId, "parse_intent", { status: "completed", completedAt: new Date().toISOString(), output: intent });

    await updateStep(taskId, "ceo_plan", { status: "running", startedAt: new Date().toISOString() });
    const assetSummary = assets.map((a) => `${a.type}:${a.id}`).join(", ");
    const { taskGraph, usage: ceoUsage } = await runCeoAgent({
      goal: campaign.goal ?? "",
      platforms: campaign.platforms,
      assetSummary,
      brandProfile,
      costBudgetUsd: budget,
    });
    totalCost += ceoUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "ceo", ceoUsage, taskGraph);
    await db.update(schema.tasks).set({ ceoPlan: taskGraph }).where(eq(schema.tasks.id, taskId));
    await updateStep(taskId, "ceo_plan", { status: "completed", completedAt: new Date().toISOString(), output: taskGraph });

    if (totalCost > budget) throw new Error("Cost budget exceeded");

    // vision
    await updateStep(taskId, "vision_analyze", { status: "running", startedAt: new Date().toISOString() });
    const primaryAsset = assets.find((a) => a.type === "video") ?? assets[0];
    if (!primaryAsset) throw new Error("No assets uploaded");

    const { analysis: vision, usage: visionUsage } = await runVisionAgent({
      assetId: primaryAsset.id,
      mediaType: primaryAsset.type as "video" | "image",
      durationSec: primaryAsset.durationSec ? parseFloat(primaryAsset.durationSec) : undefined,
    });
    totalCost += visionUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "vision", visionUsage, vision);
    await updateStep(taskId, "vision_analyze", { status: "completed", completedAt: new Date().toISOString(), output: vision });

    // copy (per platform)
    await updateStep(taskId, "copy_generate", { status: "running", startedAt: new Date().toISOString() });
    const allVariants = [];
    let copyUsageTotal = { input: 0, output: 0, costUsd: 0 };
    const platforms = (campaign.platforms.length ? campaign.platforms : ["tiktok"]) as Platform[];

    for (const platform of platforms) {
      const { variants, usage } = await runCopyAgent({
        vision,
        brandProfile,
        platform,
        goal: campaign.goal ?? "",
      });
      allVariants.push(...variants);
      copyUsageTotal.input += usage.input;
      copyUsageTotal.output += usage.output;
      copyUsageTotal.costUsd += usage.costUsd;
    }
    totalCost += copyUsageTotal.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "copy", copyUsageTotal, allVariants);
    await updateStep(taskId, "copy_generate", { status: "completed", completedAt: new Date().toISOString(), output: allVariants });

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
        selectedCopyId: allVariants[0]?.id,
      })
      .returning();

    // edit director
    await updateStep(taskId, "edit_director_plan", { status: "running", startedAt: new Date().toISOString() });
    const { editPlan, usage: editUsage } = await runEditDirectorAgent({
      vision,
      copyVariant: allVariants[0]!,
      assetId: primaryAsset.id,
      durationSec: primaryAsset.durationSec ? parseFloat(primaryAsset.durationSec) : 30,
    });
    totalCost += editUsage.costUsd;
    await logAgent(task.orgId, task.workspaceId, taskId, "edit", editUsage, editPlan);
    await db
      .update(schema.creatives)
      .set({ editPlan })
      .where(eq(schema.creatives.id, creative!.id));
    await updateStep(taskId, "edit_director_plan", { status: "completed", completedAt: new Date().toISOString(), output: editPlan });

    // enqueue ffmpeg render
    await updateStep(taskId, "ffmpeg_render", { status: "running", startedAt: new Date().toISOString() });
    await enqueueRender({
      taskId: task.id,
      creativeId: creative!.id,
      workspaceId: task.workspaceId,
      orgId: task.orgId,
      campaignId: campaign.id,
      resolution: "preview",
    });

    // Note: compliance runs after render completes in worker callback
    // For sync path without worker, mark pending
    await updateStep(taskId, "ffmpeg_render", { status: "running" });

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

  if (result.passed) {
    await db
      .update(schema.tasks)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(schema.tasks.id, taskId));
    await db
      .update(schema.campaigns)
      .set({ status: "pending_internal_review" })
      .where(eq(schema.campaigns.id, task.campaignId));
    await updateStep(taskId, "human_review", { status: "pending" });
  } else if (task.retryCount < CEO_MAX_RETRIES) {
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
    const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
    const platforms = (campaign?.platforms ?? ["tiktok"]) as Platform[];

    const allVariants = [];
    for (const platform of platforms) {
      const { variants } = await runCopyAgent({
        vision,
        brandProfile,
        platform,
        goal: campaign?.goal ?? "",
      });
      allVariants.push(...variants);
    }

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
      resolution: "preview",
    });
  }
}

export { runPublishAgent };
