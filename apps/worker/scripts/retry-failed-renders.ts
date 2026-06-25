/**
 * Re-enqueue preview render for auto-clip creatives that failed or never completed.
 * Usage: pnpm --filter @ceo-agent/worker retry:renders
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const taskArg = process.argv.find((a) => a.startsWith("--task="));
const taskIdFilter = taskArg?.split("=")[1];
const force = process.argv.includes("--force");

async function main() {
  const db = getDb();

  let tasks = await db
    .select()
    .from(schema.tasks)
    .orderBy(desc(schema.tasks.createdAt))
    .limit(20);

  if (taskIdFilter) {
    tasks = tasks.filter((t) => t.id === taskIdFilter);
  } else if (force) {
    tasks = tasks.filter((t) => t.status === "completed" || t.status === "running" || t.status === "failed");
  } else {
    tasks = tasks.filter((t) => {
      const progress = (t.stepProgress ?? {}) as Record<string, unknown>;
      return Boolean(progress.clip_segment) || t.status === "failed" || t.status === "running";
    });
  }

  if (tasks.length === 0) {
    console.log("No matching tasks found.");
    return;
  }

  let enqueued = 0;

  for (const task of tasks) {
    const creatives = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.taskId, task.id));

    if (creatives.length === 0) continue;

    const needsRender = creatives.filter(
      (c) => force || !c.videoUrl || c.renderStatus !== "preview_ready"
    );

    if (needsRender.length === 0) {
      console.log(`Task ${task.id}: all ${creatives.length} clips already have preview`);
      continue;
    }

    console.log(`Task ${task.id}: re-queue ${needsRender.length}/${creatives.length} clip(s)`);

    await db
      .update(schema.tasks)
      .set({
        status: "running",
        errorMessage: null,
        stepProgress: {
          ...((task.stepProgress as Record<string, unknown>) ?? {}),
          ffmpeg_render: { status: "running", output: { requeued: true } },
        },
      })
      .where(eq(schema.tasks.id, task.id));

    for (const creative of needsRender) {
      await db
        .update(schema.creatives)
        .set({
          renderStatus: "preview_rendering",
          renderProgress: { percent: 0, phase: "queued" },
          ...(force ? { renderCachePath: null, renderCacheFingerprint: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, creative.id));

      await enqueueRender({
        taskId: task.id,
        creativeId: creative.id,
        workspaceId: task.workspaceId,
        orgId: task.orgId,
        campaignId: task.campaignId,
        mode: "preview",
      });
      enqueued += 1;
      console.log(`  → render queued creative ${creative.id}`);
    }
  }

  console.log(`\nDone. ${enqueued} render job(s) enqueued.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
