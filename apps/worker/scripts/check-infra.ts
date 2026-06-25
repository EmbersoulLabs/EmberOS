/**
 * Verify DATABASE_URL and REDIS_URL connectivity.
 * Usage: pnpm check:infra
 */
import { config } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getDb } from "@ceo-agent/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

function hostFromUrl(url: string): string {
  try {
    return new URL(url.replace(/^redis:\/\//, "http://")).hostname;
  } catch {
    return url;
  }
}

async function checkDb(): Promise<void> {
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  console.log(`DB host: ${hostFromUrl(dbUrl)}`);
  const db = getDb();
  await db.execute(sql`SELECT 1`);
  console.log("DB: OK");
}

async function checkRedis(): Promise<void> {
  if (!redisUrl) {
    console.warn("REDIS_URL not set — skip");
    return;
  }
  console.log(`Redis host: ${hostFromUrl(redisUrl)}`);
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(redisUrl, { connectTimeout: 10_000, maxRetriesPerRequest: 1 });
  try {
    const pong = await redis.ping();
    console.log("Redis: OK", pong);
  } finally {
    redis.disconnect();
  }
}

async function main() {
  await checkDb();
  await checkRedis();

  const fontPath = join(root, "apps", "worker", "assets", "fonts", "NotoSansCJKsc-Regular.otf");
  const { existsSync } = await import("node:fs");
  if (existsSync(fontPath)) {
    console.log("Subtitle font: OK");
  } else {
    console.warn("Subtitle font MISSING — Chinese subtitles may show as boxes");
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn("OPENAI_API_KEY not set — voiceover and AI scoring will fail");
  } else {
    console.log("OpenAI API key: set");
  }

  const redisUrl = process.env.REDIS_URL ?? "";
  const prefix = process.env.BULLMQ_PREFIX?.trim() || (process.env.LOCAL_DEV === "true" ? "local" : "");
  if (/upstash\.io/i.test(redisUrl) && !prefix) {
    console.warn(
      "\n*** CRITICAL: Upstash Redis without BULLMQ_PREFIX=local ***\n" +
        "    Remote Railway worker will steal jobs → old single-video pipeline.\n" +
        "    Run: pnpm dev:sync   then restart pnpm dev\n"
    );
  } else if (prefix) {
    console.log(`Queue prefix: ${prefix} (local jobs isolated from production)`);
  }

  console.log("\nInfrastructure check passed.");
  console.log("Start local dev: pnpm dev (Web + Worker). Worker should log pipeline=auto_clip_v1");
}

main().catch((err) => {
  console.error("\nInfrastructure check FAILED:");
  console.error(err instanceof Error ? err.message : err);
  console.error("\nIf ENOTFOUND: check VPN/DNS, or switch DATABASE_URL to direct connection:");
  console.error("  Supabase → Project Settings → Database → Connection string → URI (port 5432)");
  process.exit(1);
});
