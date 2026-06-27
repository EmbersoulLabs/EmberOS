/**
 * Delete rendered video files from storage and clear related DB fields.
 * Keeps campaigns, tasks, marketing copy, and source uploads intact.
 *
 * Usage:
 *   pnpm --filter @ceo-agent/worker purge:renders [--dry-run]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { eq, isNotNull, or, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import { STORAGE_PATHS } from "@ceo-agent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const dryRun = process.argv.includes("--dry-run");
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error("Supabase env is not set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function urlToStoragePath(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx >= 0) return decodeURIComponent(url.slice(idx + marker.length));
  if (!url.startsWith("http")) return url;
  return null;
}

async function listPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      console.warn(`  [storage] list ${prefix}: ${error.message}`);
      break;
    }
    if (!data?.length) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listPrefix(path)));
      else out.push(path);
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function removePaths(paths: (string | null | undefined)[]): Promise<number> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p?.trim())))];
  if (!unique.length) return 0;
  if (dryRun) return unique.length;

  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) console.warn(`  [storage] remove failed: ${error.message}`);
    else removed += batch.length;
  }
  return removed;
}

async function main() {
  const db = getDb();
  console.log(dryRun ? "DRY RUN — no changes\n" : "Purging rendered videos…\n");

  const [beforeSize] = await db.execute<{ creatives_size: string; tasks_size: string; with_video: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM creatives WHERE video_url IS NOT NULL OR video_export_url IS NOT NULL) AS with_video,
      pg_size_pretty(pg_total_relation_size('creatives')) AS creatives_size,
      pg_size_pretty(pg_total_relation_size('tasks')) AS tasks_size
  `);
  console.log("Before:", beforeSize);

  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(
      or(
        isNotNull(schema.creatives.videoUrl),
        isNotNull(schema.creatives.videoExportUrl),
        isNotNull(schema.creatives.coverUrl),
        isNotNull(schema.creatives.renderCachePath),
        sql`${schema.creatives.renderStatus} NOT IN ('none', 'pending')`
      )
    );

  console.log(`Found ${creatives.length} creative(s) with render artifacts\n`);

  const storagePaths: (string | null)[] = [];
  for (const c of creatives) {
    storagePaths.push(
      STORAGE_PATHS.preview(c.workspaceId, c.campaignId, c.id),
      STORAGE_PATHS.export(c.workspaceId, c.campaignId, c.id),
      STORAGE_PATHS.export2k(c.workspaceId, c.campaignId, c.id),
      STORAGE_PATHS.cover(c.workspaceId, c.campaignId, c.id),
      STORAGE_PATHS.exportPack(c.workspaceId, c.campaignId, c.id),
      urlToStoragePath(c.videoUrl),
      urlToStoragePath(c.videoExportUrl),
      urlToStoragePath(c.coverUrl),
      c.renderCachePath
    );
    if (c.renderCacheFingerprint) {
      for (const profile of ["preview", "final", "2k"] as const) {
        storagePaths.push(
          STORAGE_PATHS.renderCache(
            c.workspaceId,
            c.campaignId,
            c.id,
            c.renderCacheFingerprint,
            profile
          )
        );
      }
    }
    storagePaths.push(
      ...(await listPrefix(`${c.workspaceId}/campaigns/${c.campaignId}/renders/${c.id}`))
    );
  }

  const tasks = await db.select().from(schema.tasks);
  for (const t of tasks) {
    for (const res of ["720p", "1080p", "2k"] as const) {
      storagePaths.push(STORAGE_PATHS.taskExportPack(t.workspaceId, t.campaignId, t.id, res));
    }
    storagePaths.push(
      ...(await listPrefix(`${t.workspaceId}/campaigns/${t.campaignId}/exports/task_${t.id}`))
    );
  }

  const removedFiles = await removePaths(storagePaths);
  console.log(`${dryRun ? "Would remove" : "Removed"} ${removedFiles} storage object(s)`);

  if (!dryRun) {
    for (const c of creatives) {
      await db
        .update(schema.creatives)
        .set({
          videoUrl: null,
          videoExportUrl: null,
          coverUrl: null,
          renderCachePath: null,
          renderCacheFingerprint: null,
          renderProgress: null,
          renderStatus: "none",
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, c.id));
    }
    console.log(`Cleared render fields on ${creatives.length} creative row(s)`);

    const tasksWithRender = await db.select().from(schema.tasks);
    let trimmed = 0;
    for (const t of tasksWithRender) {
      const progress = (t.stepProgress ?? {}) as Record<string, unknown>;
      if (!progress.ffmpeg_render) continue;
      const { ffmpeg_render: _removed, ...rest } = progress;
      await db
        .update(schema.tasks)
        .set({ stepProgress: rest })
        .where(eq(schema.tasks.id, t.id));
      trimmed++;
    }
    console.log(`Trimmed ffmpeg_render from ${trimmed} task(s)`);
  }

  const [afterSize] = await db.execute<{ creatives_size: string; tasks_size: string; with_video: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM creatives WHERE video_url IS NOT NULL OR video_export_url IS NOT NULL) AS with_video,
      pg_size_pretty(pg_total_relation_size('creatives')) AS creatives_size,
      pg_size_pretty(pg_total_relation_size('tasks')) AS tasks_size
  `);
  console.log("\nAfter:", afterSize);
  console.log("\nDone. Source uploads and marketing copy were kept.");
}

main()
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closeDb());
