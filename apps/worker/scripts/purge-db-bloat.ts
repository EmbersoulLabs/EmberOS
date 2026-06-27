/**
 * Shrink Postgres: purge agent_logs and trim bulky step_progress outputs.
 * Keeps content_generate (marketing pack), task/campaign strategy, edit plans.
 *
 * Usage:
 *   pnpm --filter @ceo-agent/worker purge:db-bloat [--dry-run]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import type { StepProgress } from "@ceo-agent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const dryRun = process.argv.includes("--dry-run");

/** Steps whose full `output` can be dropped — status/timestamps stay for pipeline UI. */
const STRIP_OUTPUT_STEPS = new Set([
  "parse_intent",
  "ceo_plan",
  "hook_generate",
  "copy_generate",
  "compliance_check",
  "marketing_score",
  "highlight_index",
  "clip_segment",
  "content_classify",
  "ffmpeg_render",
  "export_pack",
  "export_packs",
  "platform_adapt",
]);

function trimVisionOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const v = output as Record<string, unknown>;
  const scenes = Array.isArray(v.scenes) ? v.scenes.slice(0, 4) : [];
  return {
    subjects: v.subjects ?? [],
    products: v.products ?? [],
    scenes,
    hooks: Array.isArray(v.hooks) ? v.hooks.slice(0, 6) : [],
    transcriptSummary: v.transcriptSummary ?? "",
    durationSec: v.durationSec,
    confidence: v.confidence,
    _trimmed: true,
  };
}

function trimStepProgress(
  progress: StepProgress,
  hasStrategyJson: boolean
): { next: StepProgress; stripped: number } {
  let stripped = 0;
  const next: StepProgress = { ...progress };

  for (const [stepId, step] of Object.entries(progress)) {
    if (!step || typeof step !== "object") continue;
    const hasOutput = step.output !== undefined && step.output !== null;

    if (stepId === "strategy_plan" && hasStrategyJson && hasOutput) {
      next[stepId] = { ...step, output: undefined };
      stripped++;
      continue;
    }

    if (stepId === "vision_analyze" && hasOutput) {
      next[stepId] = { ...step, output: trimVisionOutput(step.output) };
      stripped++;
      continue;
    }

    if (STRIP_OUTPUT_STEPS.has(stepId) && hasOutput) {
      next[stepId] = { ...step, output: undefined };
      stripped++;
    }
  }

  return { next, stripped };
}

async function tableStats() {
  const db = getDb();
  const [row] = await db.execute<{
    agent_logs: string;
    agent_log_count: number;
    tasks: string;
    task_count: number;
  }>(sql`
    SELECT
      pg_size_pretty(pg_total_relation_size('agent_logs')) AS agent_logs,
      (SELECT COUNT(*)::int FROM agent_logs) AS agent_log_count,
      pg_size_pretty(pg_total_relation_size('tasks')) AS tasks,
      (SELECT COUNT(*)::int FROM tasks) AS task_count
  `);
  return row;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const db = getDb();
  console.log(dryRun ? "DRY RUN — no changes\n" : "Purging DB bloat…\n");
  console.log("Before:", await tableStats());

  const logCount = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM agent_logs`);
  const logs = Number((logCount as unknown as { c: number }[])[0]?.c ?? 0);
  console.log(`\nagent_logs rows to delete: ${logs}`);

  const tasks = await db.select().from(schema.tasks);
  let tasksUpdated = 0;
  let stepsStripped = 0;

  for (const task of tasks) {
    const progress = (task.stepProgress ?? {}) as StepProgress;
    const { next, stripped } = trimStepProgress(progress, Boolean(task.strategyJson));
    if (stripped === 0) continue;
    tasksUpdated++;
    stepsStripped += stripped;
    if (!dryRun) {
      await db.update(schema.tasks).set({ stepProgress: next }).where(eq(schema.tasks.id, task.id));
    }
  }

  console.log(
    `${dryRun ? "Would update" : "Updated"} ${tasksUpdated} task(s), stripping output from ${stepsStripped} step(s)`
  );

  if (!dryRun && logs > 0) {
    await db.execute(sql`DELETE FROM agent_logs`);
    console.log(`Deleted ${logs} agent_logs row(s)`);
  } else if (dryRun) {
    console.log(`Would delete ${logs} agent_logs row(s)`);
  }

  console.log("\nAfter:", await tableStats());
  console.log("\nKept: content_generate output, trimmed vision summary, campaigns, edit plans.");
}

main()
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closeDb());
