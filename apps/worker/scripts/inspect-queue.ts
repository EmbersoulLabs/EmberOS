/**
 * Inspect BullMQ queue depth (waiting / active / failed).
 * Usage: pnpm --filter @ceo-agent/worker inspect:queue
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnection, getBullmqPrefix } from "@ceo-agent/queue";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

async function inspect(name: string) {
  const prefix = getBullmqPrefix();
  const queue = new Queue(name, { connection: getRedisConnection(), prefix });
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused"
    );
    const active = await queue.getJobs(["active"], 0, 10);
    const waiting = await queue.getJobs(["waiting"], 0, 10);
    console.log(`\n=== ${prefix ? `${prefix}:` : ""}${name} ===`);
    console.log(JSON.stringify(counts, null, 2));
    if (active.length) {
      console.log("Active jobs:");
      for (const j of active) {
        const d = j.data as { taskId?: string; creativeId?: string };
        console.log(`  ${j.id} name=${j.name} task=${d.taskId} creative=${d.creativeId}`);
      }
    }
    if (waiting.length) {
      console.log("Waiting (first 10):");
      for (const j of waiting) {
        const d = j.data as { taskId?: string; creativeId?: string };
        console.log(`  ${j.id} name=${j.name} task=${d.taskId} creative=${d.creativeId}`);
      }
    }
  } finally {
    await queue.close();
  }
}

async function main() {
  console.log(`Redis prefix: ${getBullmqPrefix() ?? "(production)"}`);
  for (const name of Object.values(QUEUE_NAMES)) {
    await inspect(name);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
