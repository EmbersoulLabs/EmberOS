/**
 * Read-only Photo Scene V1 production schema preflight.
 * Does not apply SQL. Logs project identity, not credentials.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  PHOTO_SCENE_V1_TABLES,
  classifyPhotoSceneSchemaPreflight,
  parseSupabaseProjectRef,
  redactDatabaseTarget,
} from "../packages/shared/src/photo-scene-production-ops";

config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ status: "ENVIRONMENT_NOT_RUN", reason: "DATABASE_URL_missing" }));
    return;
  }

const REQUIRED_COLUMNS: Record<(typeof PHOTO_SCENE_V1_TABLES)[number], string[]> = {
  campaign_asset_refs: ["campaign_id", "asset_id", "sort_order"],
  photo_scene_generations: ["id", "org_id", "workspace_id", "campaign_id", "operation", "input_fingerprint"],
  photo_scene_official_scenes: ["id", "slug", "name", "category"],
  photo_scene_official_scene_versions: [
    "scene_id",
    "version",
    "status",
    "background_storage_identity",
    "background_content_hash",
  ],
  photo_scene_scene_selections: ["org_id", "workspace_id", "campaign_id", "frozen_selection"],
};

const REQUIRED_INDEXES: Record<string, string[]> = {
  campaign_asset_refs: ["campaign_asset_refs_campaign_idx"],
  photo_scene_generations: ["photo_scene_generations_inflight_fingerprint_idx"],
  photo_scene_official_scene_versions: ["photo_scene_official_scene_one_published_idx"],
};

const REQUIRED_POLICIES: Record<string, string[]> = {
  campaign_asset_refs: ["campaign_asset_refs_all"],
  photo_scene_generations: ["photo_scene_generations_all"],
  photo_scene_official_scenes: ["photo_scene_official_scenes_select"],
  photo_scene_official_scene_versions: ["photo_scene_official_scene_versions_select"],
  photo_scene_scene_selections: ["photo_scene_scene_selections_all"],
};

const sql = postgres(url, { max: 1, prepare: false });
try {
  const present: Record<string, boolean> = {};
  const compatible: Record<string, boolean> = {};
  for (const table of PHOTO_SCENE_V1_TABLES) {
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass(${"public." + table}) IS NOT NULL AS exists
    `;
    present[table] = exists;
    if (!exists) {
      compatible[table] = false;
      continue;
    }
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `;
    const columnSet = new Set(columns.map((row) => row.column_name));
    const columnsOk = REQUIRED_COLUMNS[table].every((column) => columnSet.has(column));
    const [{ rls }] = await sql<{ rls: boolean }[]>`
      SELECT relrowsecurity AS rls
      FROM pg_class
      WHERE relname = ${table} AND relnamespace = 'public'::regnamespace
    `;
    const indexNames = (REQUIRED_INDEXES[table] ?? []).length
      ? await sql<{ indexname: string }[]>`
          SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table}
        `
      : [];
    const indexSet = new Set(indexNames.map((row) => row.indexname));
    const indexesOk = (REQUIRED_INDEXES[table] ?? []).every((name) => indexSet.has(name));
    const policies = await sql<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}
    `;
    const policySet = new Set(policies.map((row) => row.policyname));
    const policiesOk = (REQUIRED_POLICIES[table] ?? []).every((name) => policySet.has(name));
    compatible[table] = Boolean(columnsOk && rls && indexesOk && policiesOk);
  }
  const result = classifyPhotoSceneSchemaPreflight({
    databaseRef: parseSupabaseProjectRef(url),
    present,
    compatible,
  });
  console.log(
    JSON.stringify({
      target: redactDatabaseTarget(url),
      mutated: false,
      ...result,
    })
  );
} finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
