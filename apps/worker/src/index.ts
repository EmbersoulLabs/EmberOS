import dns from "node:dns";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startWorkers } from "./processors/index";
import { logSubtitleFontStatus } from "./ffmpeg/subtitle-fonts.js";
import { startRuntimeHeartbeat } from "./runtime-heartbeat.js";

// Prefer IPv4 — Windows often times out on IPv6 routes to Supabase/Cloudflare.
dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

// Monorepo: load worker .env first, then repo root .env.local (same as web app).
config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

logSubtitleFontStatus();
if (!process.env.OPENAI_API_KEY?.trim()) {
  console.warn("[worker] OPENAI_API_KEY is not set — TTS, agents, and marketing scores will fail");
}
console.log("[worker] pipeline=auto_clip_v1 + ai_story_execution (PD-055 target 5, quality-first)");

const stopHeartbeat = await startRuntimeHeartbeat();
startWorkers();

async function shutdown() {
  console.log("Shutting down workers...");
  await stopHeartbeat();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
