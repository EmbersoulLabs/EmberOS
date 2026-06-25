/**
 * Remove stale BullMQ jobs (e.g. stuck "queued" BGM rerenders).
 *
 * Usage: pnpm queue:clean
 *        pnpm queue:clean -- --all   (also production prefix — use with care)
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

const cleanAll = process.argv.includes("--all");

async function obliterateQueue(name: string, prefix?: string) {
  const label = prefix ? `${prefix}:${name}` : name;
  const queue = new Queue(name, { connection: getRedisConnection(), prefix });
  try {
    await queue.obliterate({ force: true });
    console.log(`[clean-queue] cleared ${label}`);
  } finally {
    await queue.close();
  }
}

async function main() {
  const localPrefix = getBullmqPrefix() ?? "local";
  const prefixes = cleanAll ? [localPrefix, undefined] : [localPrefix];
  const redisUrl = process.env.REDIS_URL ?? "";

  console.log(`Redis host: ${redisUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`Cleaning: ${prefixes.map((p) => p ?? "(production)").join(", ")}`);

  for (const prefix of prefixes) {
    for (const name of Object.values(QUEUE_NAMES)) {
      await obliterateQueue(name, prefix);
    }
  }

  console.log("\nDone. Run pnpm dev and create a new campaign.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
