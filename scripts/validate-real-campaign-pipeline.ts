/**
 * Real Campaign AI pipeline validation (local queue prefix).
 *
 * Creates an isolated E2E campaign + image asset, enqueues via the same
 * path as POST /api/campaigns/:id/run (enqueuePipeline), polls until done,
 * and writes a sanitized report to tmp-e2e-report.json.
 *
 * Usage:
 *   npx tsx scripts/validate-real-campaign-pipeline.ts
 *
 * Prerequisites: local worker running with LOCAL_DEV / BULLMQ_PREFIX=local
 * Do not commit generated media or report files.
 */
import { config } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { getDb, schema, closeDb, getCampaignAssets } from "@ceo-agent/db";
import { enqueuePipeline, logQueueConfig } from "@ceo-agent/queue";
import {
  LLM_BUDGET_PER_TASK_USD,
  STORAGE_PATHS,
  CAMPAIGN_OBJECTIVE_LABELS,
} from "@ceo-agent/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, "apps/worker/.env") });

const WORKSPACE_SLUG = process.env.E2E_WORKSPACE_SLUG ?? "florist2";
const POLL_MS = 5000;
const TIMEOUT_MS = 25 * 60 * 1000;
const ASSET_DIR = resolve(root, "tmp-e2e-assets");
const ASSET_FILE = join(ASSET_DIR, "e2e-florist-still.jpg");
const REPORT_FILE = resolve(root, "tmp-e2e-report.json");

const AGENCY_STAGES = [
  "parse_intent",
  "vision_analyze",
  "strategy_plan",
  "ceo_plan",
  "content_classify",
  "content_generate",
  "hook_generate",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "marketing_score",
  "human_review",
] as const;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureTestAsset(): { path: string; bytes: number; type: "image" } {
  mkdirSync(ASSET_DIR, { recursive: true });
  if (!existsSync(ASSET_FILE)) {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0xE8A0BF:s=1080x1350:d=1",
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "3",
        ASSET_FILE,
      ],
      { stdio: "pipe" }
    );
  }
  const st = statSync(ASSET_FILE);
  return { path: ASSET_FILE, bytes: st.size, type: "image" };
}

function stageSnapshot(progress: Record<string, { status?: string; startedAt?: string; completedAt?: string; error?: string; output?: unknown }>) {
  return AGENCY_STAGES.map((id) => {
    const step = progress[id];
    let durationMs: number | null = null;
    if (step?.startedAt && step?.completedAt) {
      durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
    }
    const hasOutput = step?.output != null;
    return {
      stage: id,
      status: step?.status ?? "pending",
      durationMs,
      hasPersistedOutput: hasOutput,
      error: step?.error ? String(step.error).slice(0, 200) : null,
    };
  });
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const campaignName = `E2E Validation — ${ts}`;
  const assetMeta = ensureTestAsset();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase storage credentials missing");
  }
  if (process.env.LOCAL_DEV !== "true" && !process.env.BULLMQ_PREFIX) {
    throw new Error("Refuse to enqueue without LOCAL_DEV or BULLMQ_PREFIX (protect prod worker)");
  }

  const db = getDb();
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, WORKSPACE_SLUG))
    .limit(1);
  if (!workspace) throw new Error(`Workspace not found: ${WORKSPACE_SLUG}`);

  const objective = "brand_awareness" as const;
  const objectiveLabel = CAMPAIGN_OBJECTIVE_LABELS[objective] ?? "Brand Awareness";

  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      orgId: workspace.orgId,
      workspaceId: workspace.id,
      name: campaignName,
      goal: objectiveLabel,
      objective,
      targetAudienceOverride: "Working adults in Singapore looking for gifts",
      platforms: ["tiktok", "instagram"],
      campaignBrief:
        "Create concise promotional content focused on convenience, visual appeal, and a clear enquiry CTA.",
      outputLanguage: "en",
      subtitleLanguage: "en",
      ctaLanguage: "en",
      hashtagLanguage: "en",
      generateStatus: "idle",
      voicePreset: "auto",
      metadata: {
        contentLocale: "en",
        e2eValidation: true,
        e2eCreatedAt: new Date().toISOString(),
      },
      status: "draft",
    })
    .returning();

  if (!campaign) throw new Error("Failed to create campaign");

  const assetId = randomUUID();
  const storagePath = STORAGE_PATHS.library(workspace.id, assetId, "jpg");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fileBuf = await import("node:fs/promises").then((fs) => fs.readFile(assetMeta.path));
  const { error: uploadErr } = await supabase.storage.from(bucket).upload(storagePath, fileBuf, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const [asset] = await db
    .insert(schema.assets)
    .values({
      id: assetId,
      orgId: workspace.orgId,
      workspaceId: workspace.id,
      type: "image",
      displayName: "e2e-florist-still",
      originalFilename: "e2e-florist-still.jpg",
      storagePath,
      mimeType: "image/jpeg",
      width: 1080,
      height: 1350,
      fileSizeBytes: assetMeta.bytes,
      status: "ready",
      source: "campaign_upload",
      metadata: {
        e2eValidation: true,
        originalFilename: "e2e-florist-still.jpg",
      },
    })
    .returning();

  await db.insert(schema.campaignAssetRefs).values({
    campaignId: campaign.id,
    assetId: asset!.id,
    sortOrder: 0,
  });

  const linked = await getCampaignAssets(db, campaign.id, workspace.id);
  if (linked.length === 0) throw new Error("Asset not linked to campaign");

  // Mirror POST /api/campaigns/:id/run after auth + asset validation
  const [task] = await db
    .insert(schema.tasks)
    .values({
      orgId: workspace.orgId,
      workspaceId: workspace.id,
      campaignId: campaign.id,
      status: "queued",
      costBudgetUsd: String(LLM_BUDGET_PER_TASK_USD),
      stepProgress: {},
    })
    .returning();

  await db
    .update(schema.campaigns)
    .set({ status: "processing" })
    .where(eq(schema.campaigns.id, campaign.id));

  logQueueConfig();
  await enqueuePipeline(task!.id, campaign.id, workspace.id, workspace.orgId);

  console.log(`[e2e] campaign=${campaign.id}`);
  console.log(`[e2e] task=${task!.id}`);
  console.log(`[e2e] asset=${assetId} type=image bytes=${assetMeta.bytes}`);
  console.log(`[e2e] enqueue=agent.pipeline (same as /run)`);

  const started = Date.now();
  let lastStatus = "queued";
  let finalTask = task!;

  while (Date.now() - started < TIMEOUT_MS) {
    const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, task!.id)).limit(1);
    if (!fresh) break;
    finalTask = fresh;
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (fresh.status !== lastStatus || fresh.currentStep) {
      console.log(
        `[e2e] ${elapsed}s status=${fresh.status} step=${fresh.currentStep ?? "—"} cost=${fresh.costUsd ?? "0"}`
      );
      lastStatus = fresh.status;
    }
    if (fresh.status === "completed" || fresh.status === "failed") break;
    await sleep(POLL_MS);
  }

  const [campaignFinal] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaign.id))
    .limit(1);
  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, task!.id));
  const reviewRows = [];
  for (const c of creatives) {
    const rows = await db
      .select({
        id: schema.reviews.id,
        decision: schema.reviews.decision,
        reviewerType: schema.reviews.reviewerType,
      })
      .from(schema.reviews)
      .where(eq(schema.reviews.creativeId, c.id));
    reviewRows.push(...rows);
  }
  const logs = await db
    .select({
      agent: schema.agentLogs.agent,
      inputTokens: schema.agentLogs.inputTokens,
      outputTokens: schema.agentLogs.outputTokens,
      costUsd: schema.agentLogs.costUsd,
      createdAt: schema.agentLogs.createdAt,
    })
    .from(schema.agentLogs)
    .where(eq(schema.agentLogs.taskId, task!.id))
    .orderBy(schema.agentLogs.createdAt);

  const progress = (finalTask.stepProgress ?? {}) as Record<
    string,
    { status?: string; startedAt?: string; completedAt?: string; error?: string; output?: unknown }
  >;
  const stages = stageSnapshot(progress);

  const runningStuck = Object.entries(progress).filter(([, s]) => s?.status === "running");
  const contentPack = progress.content_generate?.output;
  const hasMarketingPack =
    contentPack != null &&
    typeof contentPack === "object" &&
    !("cached" in (contentPack as object) && Object.keys(contentPack as object).length <= 1);

  const copyOnCreative = creatives[0]?.copyVariants;
  const reviewReady =
    finalTask.status === "completed" &&
    (progress.human_review?.status === "pending" || campaignFinal?.status === "pending_internal_review") &&
    reviewRows.some((r) => r.decision === "pending" && r.reviewerType === "internal");

  const providers = logs.map((l) => ({
    agent: l.agent,
    inputTokens: l.inputTokens,
    outputTokens: l.outputTokens,
    costUsd: l.costUsd,
  }));

  const result = {
    environment: {
      mode: "local",
      workspaceSlug: WORKSPACE_SLUG,
      queuePrefix: process.env.BULLMQ_PREFIX || (process.env.LOCAL_DEV === "true" ? "local" : null),
      asset: { type: assetMeta.type, file: "tmp-e2e-assets/e2e-florist-still.jpg", bytes: assetMeta.bytes },
      entryPoint: "enqueuePipeline (identical to POST /api/campaigns/:id/run after auth)",
      generateIsPlaceholder: true,
    },
    identifiers: {
      campaignId: campaign.id,
      campaignName,
      taskId: task!.id,
      assetId,
      creativeIds: creatives.map((c) => c.id),
    },
    final: {
      taskStatus: finalTask.status,
      campaignStatus: campaignFinal?.status ?? null,
      currentStep: finalTask.currentStep,
      errorMessage: finalTask.errorMessage ? String(finalTask.errorMessage).slice(0, 300) : null,
      costUsd: finalTask.costUsd,
      elapsedMs: Date.now() - started,
      reviewReady,
      hasMarketingPack,
      creativeCount: creatives.length,
      pendingInternalReviews: reviewRows.filter((r) => r.decision === "pending").length,
      creativeStatuses: creatives.map((c) => ({
        id: c.id,
        status: c.status,
        renderStatus: c.renderStatus,
        hasCopyVariants: Array.isArray(c.copyVariants) && (c.copyVariants as unknown[]).length > 0,
        hasEditPlan: Boolean(c.editPlan),
        hasCompliance: Boolean(c.complianceResult),
        hasScore: Boolean(c.marketingScoreJson),
      })),
      runningStepsStuck: runningStuck.map(([id]) => id),
      hooksPersisted: Boolean(finalTask.hooksJson),
      strategyPersisted: Boolean(finalTask.strategyJson || campaignFinal?.strategyJson),
      scorePersisted: Boolean(finalTask.marketingScoreJson),
    },
    stages,
    agentUsage: providers,
    contextChecks: {
      campaignBriefSoleFreeText: Boolean(campaign.campaignBrief) && !(campaign as { description?: unknown }).description,
      platforms: campaign.platforms,
      targetAudienceSet: Boolean(campaign.targetAudienceOverride),
      visionOutputPresent: progress.vision_analyze?.status === "completed" && progress.vision_analyze?.output != null,
      strategyAfterVision:
        progress.vision_analyze?.status === "completed" && progress.strategy_plan?.status === "completed",
      transcriptApplicable: "image asset — transcript optional/absent",
    },
    verdict:
      finalTask.status === "completed" && reviewReady && runningStuck.length === 0
        ? "PASS"
        : finalTask.status === "failed"
          ? "FAIL"
          : Date.now() - started >= TIMEOUT_MS
            ? "BLOCKED"
            : "PARTIAL",
  };

  writeFileSync(REPORT_FILE, JSON.stringify(result, null, 2));
  console.log(`\n[e2e] verdict=${result.verdict}`);
  console.log(`[e2e] report=${REPORT_FILE}`);
  await closeDb();

  if (result.verdict !== "PASS") process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("[e2e] FATAL:", err instanceof Error ? err.message : err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
