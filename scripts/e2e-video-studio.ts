/**
 * E2E validation for Video Studio / Auto Clip pipeline.
 *
 * Local (uses .env.local — set LOCAL_DEV=true + BULLMQ_PREFIX=local if sharing Upstash with Railway):
 *   pnpm e2e:video-studio -- --list
 *   pnpm e2e:video-studio -- --run <campaignId>
 *   pnpm e2e:video-studio -- <campaignId>
 *
 * Railway Worker (same Redis/DB as production worker — no LOCAL_DEV prefix):
 *   npx @railway/cli run --service worker pnpm e2e:video-studio -- --list
 *   npx @railway/cli run --service worker pnpm e2e:video-studio -- --run <campaignId>
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema, closeDb } from "@ceo-agent/db";
import { enqueuePipeline, logQueueConfig } from "@ceo-agent/queue";
import { LLM_BUDGET_PER_TASK_USD } from "@ceo-agent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

config({ path: resolve(ROOT, ".env.local") });
config({ path: resolve(ROOT, "apps/worker/.env") });

const POLL_MS = 5000;
const TIMEOUT_MS = 35 * 60 * 1000;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function usage() {
  console.log(`
Video Studio E2E

  pnpm e2e:video-studio -- --list
      List recent campaigns that have a video asset (candidates for Auto Clip).

  pnpm e2e:video-studio -- --run <campaignId>
      Create a new task, enqueue agent.pipeline, then poll until done.

  pnpm e2e:video-studio -- <campaignId>
      Poll the latest task for this campaign (must already be running or queued).

Railway (worker service, production Redis):
  npx @railway/cli login
  npx @railway/cli link
  npx @railway/cli run --service worker pnpm e2e:video-studio -- --list
  npx @railway/cli run --service worker pnpm e2e:video-studio -- --run <campaignId>
`);
}

async function listCampaigns() {
  const db = getDb();
  const campaigns = await db
    .select()
    .from(schema.campaigns)
    .orderBy(desc(schema.campaigns.createdAt))
    .limit(30);

  const withVideo: Array<{
    id: string;
    name: string;
    status: string;
    videoCount: number;
    latestTaskStatus: string | null;
    latestTaskCost: string | null;
  }> = [];

  for (const c of campaigns) {
    const videos = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.campaignId, c.id), eq(schema.assets.type, "video")));
    if (videos.length === 0) continue;

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.campaignId, c.id))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    withVideo.push({
      id: c.id,
      name: c.name,
      status: c.status,
      videoCount: videos.length,
      latestTaskStatus: task?.status ?? null,
      latestTaskCost: task?.costUsd ?? null,
    });
    if (withVideo.length >= 15) break;
  }

  if (withVideo.length === 0) {
    console.log("No campaigns with video assets. Upload a video in the Campaign wizard first.");
    return;
  }

  console.log("\nCampaigns with video (newest first):\n");
  for (const r of withVideo) {
    console.log(`  ${r.id}`);
    console.log(`    name:   ${r.name}`);
    console.log(`    status: ${r.status}  videos: ${r.videoCount}`);
    console.log(
      `    task:   ${r.latestTaskStatus ?? "—"}  costUsd: ${r.latestTaskCost ?? "—"}`
    );
    console.log("");
  }
  console.log("Run: pnpm e2e:video-studio --run <campaignId>\n");
}

async function triggerRun(campaignId: string) {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const videos = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.campaignId, campaignId), eq(schema.assets.type, "video")));

  if (videos.length === 0) {
    throw new Error(`Campaign ${campaignId} has no video asset — upload source video first.`);
  }

  if (campaign.status === "processing") {
    console.warn("[e2e] Campaign already processing — will enqueue another task (max 2 concurrent/org).");
  }

  const [task] = await db
    .insert(schema.tasks)
    .values({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      status: "queued",
      costBudgetUsd: String(LLM_BUDGET_PER_TASK_USD),
      stepProgress: {},
    })
    .returning();

  await db
    .update(schema.campaigns)
    .set({ status: "processing" })
    .where(eq(schema.campaigns.id, campaignId));

  if (process.env.E2E_PROD_QUEUE === "1") {
    delete process.env.LOCAL_DEV;
    delete process.env.BULLMQ_PREFIX;
    console.log("[e2e] E2E_PROD_QUEUE=1 — enqueueing to production Redis (Railway worker)");
  } else if (process.env.LOCAL_DEV === "true" || process.env.BULLMQ_PREFIX) {
    console.warn(
      "[e2e] LOCAL_DEV/BULLMQ_PREFIX active — only a LOCAL worker will process this job."
    );
    console.warn("[e2e] For Railway worker: E2E_PROD_QUEUE=1 pnpm e2e:video-studio --run <id>");
    console.warn("[e2e] Or: npx @railway/cli run pnpm e2e:video-studio --run <id>");
  }
  logQueueConfig();

  await enqueuePipeline(task!.id, campaignId, campaign.workspaceId, campaign.orgId);

  console.log(`[e2e] Enqueued agent.pipeline task=${task!.id} campaign=${campaign.name}`);
  return task!.id;
}

async function resolveTaskId(campaignId: string, explicitTaskId?: string): Promise<string> {
  if (explicitTaskId) return explicitTaskId;

  const db = getDb();
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.campaignId, campaignId))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1);

  if (!task) {
    throw new Error(`No task for campaign ${campaignId}. Use --run <campaignId> to start one.`);
  }
  return task.id;
}

async function pollUntilDone(campaignId: string, taskId: string) {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  const started = Date.now();
  console.log(`[e2e] Polling campaign=${campaignId} task=${taskId}`);

  while (Date.now() - started < TIMEOUT_MS) {
    const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    if (!fresh) break;

    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const costUsd = fresh.costUsd ?? "0";
    const step = fresh.currentStep ?? "—";
    console.log(`[e2e] ${elapsedSec}s status=${fresh.status} step=${step} costUsd=${costUsd}`);

    if (fresh.status === "completed" || fresh.status === "failed") {
      const creatives = await db
        .select()
        .from(schema.creatives)
        .where(eq(schema.creatives.taskId, taskId));

      const previewReady = creatives.filter((c) => c.renderStatus === "preview_ready").length;
      const progress = (fresh.stepProgress ?? {}) as Record<string, { status?: string }>;
      const checks = {
        strategy: progress.strategy_plan?.status === "completed",
        contentPack: progress.content_generate?.status === "completed",
        highlight: progress.highlight_index?.status === "completed",
        clips: progress.clip_segment?.status === "completed",
        render: progress.ffmpeg_render?.status === "completed",
      };

      console.log("\n=== E2E Summary ===");
      console.log(`Campaign:     ${campaign?.name ?? campaignId}`);
      console.log(`Task:         ${fresh.id}`);
      console.log(`Final status: ${fresh.status}`);
      console.log(`Wall time:    ${elapsedSec}s`);
      console.log(`Cost USD:     ${costUsd}`);
      console.log(`Clips ready:  ${previewReady}/${creatives.length}`);
      console.log(`Steps:        strategy=${checks.strategy} highlight=${checks.highlight} content=${checks.contentPack} clips=${checks.clips} render=${checks.render}`);
      if (fresh.errorMessage) console.log(`Error:        ${fresh.errorMessage}`);
      if (fresh.startedAt && fresh.completedAt) {
        const runMs = new Date(fresh.completedAt).getTime() - new Date(fresh.startedAt).getTime();
        console.log(`Task runtime: ${Math.round(runMs / 1000)}s (startedAt → completedAt)`);
      }
      console.log("===================\n");

      process.exitCode = fresh.status === "completed" ? 0 : 1;
      return;
    }

    await sleep(POLL_MS);
  }

  throw new Error("Timed out waiting for pipeline completion (35 min)");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  try {
    if (args[0] === "--list") {
      await listCampaigns();
      return;
    }

    if (args[0] === "--run") {
      const campaignId = args[1];
      if (!campaignId) {
        console.error("Missing campaignId. Usage: --run <campaignId>");
        process.exit(1);
      }
      const taskId = await triggerRun(campaignId);
      await pollUntilDone(campaignId, taskId);
      return;
    }

    const campaignId = args[0]!;
    const taskId = await resolveTaskId(campaignId, args[1]);
    await pollUntilDone(campaignId, taskId);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
