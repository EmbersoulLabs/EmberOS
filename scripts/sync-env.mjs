import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, ".env.local");

if (!existsSync(src)) {
  console.warn("[sync-env] .env.local not found — copy .env.example and fill secrets");
  process.exit(0);
}

const targets = [
  join(root, "apps", "web", ".env.local"),
  join(root, "apps", "worker", ".env"),
];

/** When using Upstash/cloud Redis locally, isolate queue from Railway production worker. */
function ensureLocalQueueIsolation(content) {
  const hasUpstash = /upstash\.io/i.test(content);
  const hasLocalRedis = /redis:\/\/(localhost|127\.0\.0\.1)/i.test(content);
  let next = content;

  if (!/^LOCAL_DEV=/m.test(next)) {
    next += "\nLOCAL_DEV=true\n";
  }
  if (hasUpstash && !/^BULLMQ_PREFIX=/m.test(next)) {
    next += "BULLMQ_PREFIX=local\n";
    console.warn(
      "[sync-env] Upstash detected — added BULLMQ_PREFIX=local so local worker handles jobs (not Railway)"
    );
  }
  if (hasLocalRedis && /^BULLMQ_PREFIX=local/m.test(next)) {
    console.log("[sync-env] local Redis — BULLMQ_PREFIX=local is optional");
  }
  return next;
}

let sourceContent = readFileSync(src, "utf8");
const patchedRoot = ensureLocalQueueIsolation(sourceContent);
if (patchedRoot !== sourceContent) {
  writeFileSync(src, patchedRoot.endsWith("\n") ? patchedRoot : `${patchedRoot}\n`);
  sourceContent = patchedRoot;
  console.log("[sync-env] updated root .env.local");
}

for (const dest of targets) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[sync-env] ${src} → ${dest}`);
}
