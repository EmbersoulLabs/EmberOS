/**
 * Guarded Preview-only migration runner.
 * Aborts unless DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL resolve to the
 * expected Preview Supabase project. Never prints connection secrets.
 *
 * Usage (Preview build only):
 *   EXPECTED_SUPABASE_REF=voofxbuzpocyjzoxrpfi node packages/db/scripts/apply-preview-migrations.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPECTED = process.env.EXPECTED_SUPABASE_REF || "voofxbuzpocyjzoxrpfi";
const FORBIDDEN = "egkgybrjmzukzmkcrpag";

function refFromDatabaseUrl(url) {
  return (
    url.match(/postgres\.([a-z0-9]+)/i)?.[1] ||
    url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1] ||
    null
  );
}

function refFromPublicUrl(url) {
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
}

function parseStatements(sql) {
  const statements = [];
  let buffer = "";
  let inDoBlock = false;

  for (const rawLine of sql.split("\n")) {
    const line = rawLine;
    const trimmed = line.trim();
    if (!inDoBlock && trimmed.startsWith("--")) continue;

    buffer += `${line}\n`;

    if (/^\s*DO\s+\$\$/i.test(trimmed)) inDoBlock = true;
    if (inDoBlock && /\$\$\s*;\s*$/.test(trimmed)) {
      inDoBlock = false;
      statements.push(buffer.trim());
      buffer = "";
      continue;
    }

    if (!inDoBlock && trimmed.endsWith(";")) {
      statements.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements.filter((s) => s.length > 0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ABORT: DATABASE_URL is not set");
  process.exit(1);
}

const dbRef = refFromDatabaseUrl(databaseUrl);
const pubRef = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? refFromPublicUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : null;

console.log(
  JSON.stringify({
    phase: "guard",
    expectedRef: EXPECTED,
    supabaseRefFromDatabaseUrl: dbRef,
    supabaseRefFromPublicUrl: pubRef,
  }),
);

if (!dbRef) {
  console.error("ABORT: could not parse Supabase project ref from DATABASE_URL");
  process.exit(1);
}
if (dbRef === FORBIDDEN) {
  console.error(`ABORT: refusing to migrate Production project ${FORBIDDEN}`);
  process.exit(1);
}
if (dbRef !== EXPECTED) {
  console.error(
    `ABORT: DATABASE_URL ref ${dbRef} does not match expected Preview ref ${EXPECTED}`,
  );
  process.exit(1);
}
if (pubRef && pubRef !== EXPECTED) {
  console.error(
    `ABORT: NEXT_PUBLIC_SUPABASE_URL ref ${pubRef} does not match expected Preview ref ${EXPECTED}`,
  );
  process.exit(1);
}

const files = [
  resolve(__dirname, "../sql/asset-library-v1.sql"),
  resolve(__dirname, "../sql/campaign-workspace-v1.sql"),
];

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });

async function inspect(label) {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'assets', 'stories', 'story_assets',
        'campaign_asset_refs', 'campaign_story_refs', 'campaigns'
      )
    order by table_name
  `;

  const assetCols = await sql`
    select column_name, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assets'
      and column_name in (
        'workspace_id','org_id','campaign_id','display_name','deleted_at',
        'status','source','uploaded_by','updated_at','original_filename'
      )
    order by column_name
  `;

  const campaignCols = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'campaigns'
      and column_name in (
        'objective','objective_custom','description','target_audience_override',
        'output_language','subtitle_language','cta_language','hashtag_language',
        'generate_status','generate_summary'
      )
    order by column_name
  `;

  const campaignIdNullable = assetCols.find((c) => c.column_name === "campaign_id")?.is_nullable;

  const authCount = await sql`
    select count(*)::int as n
    from campaigns
    where coalesce((metadata->>'mediaReferencesAuthoritative')::boolean, false) = true
  `;

  async function countAssets() {
    try {
      return (await sql`select count(*)::int as n from assets`)[0]?.n ?? null;
    } catch {
      return null;
    }
  }
  async function countCampaigns() {
    try {
      return (await sql`select count(*)::int as n from campaigns`)[0]?.n ?? null;
    } catch {
      return null;
    }
  }
  async function countStories() {
    try {
      return (await sql`select count(*)::int as n from stories`)[0]?.n ?? null;
    } catch {
      return null;
    }
  }
  const rowCounts = [
    {
      assets: await countAssets(),
      campaigns: await countCampaigns(),
      stories: await countStories(),
    },
  ];

  console.log(
    JSON.stringify({
      phase: label,
      tables: tables.map((t) => t.table_name),
      assetColumns: assetCols.map((c) => c.column_name),
      assetsCampaignIdNullable: campaignIdNullable ?? null,
      campaignColumns: campaignCols.map((c) => c.column_name),
      campaignsWithMediaAuthority: authCount[0]?.n ?? 0,
      rowCounts: rowCounts[0] ?? null,
    }),
  );
}

try {
  await inspect("pre-migration");

  // Asset Library RLS policies depend on this helper. Preview was missing it.
  await sql.unsafe(`
CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
`);
  console.log(
    JSON.stringify({
      phase: "bootstrap",
      ensured: "user_workspace_ids()",
    }),
  );

  for (const file of files) {
    const statements = parseStatements(readFileSync(file, "utf8"));
    console.log(
      JSON.stringify({
        phase: "apply",
        file: file.split(/[/\\]/).slice(-1)[0],
        statementCount: statements.length,
      }),
    );
    for (const statement of statements) {
      try {
        await sql.unsafe(statement);
        console.log(
          "OK:",
          statement.slice(0, 72).replace(/\s+/g, " ") + "...",
        );
      } catch (error) {
        // Idempotent recreate of FK may fail if already present with same definition
        const msg = String(error?.message || error);
        if (
          /assets_campaign_id_fkey/.test(msg) &&
          /already exists/i.test(msg)
        ) {
          console.log("SKIP (exists): assets_campaign_id_fkey");
          continue;
        }
        console.error("FAIL:", statement.slice(0, 120).replace(/\s+/g, " "));
        throw error;
      }
    }
  }

  await inspect("post-migration");
  console.log(
    JSON.stringify({
      phase: "done",
      supabaseRef: dbRef,
      productionUntouched: true,
    }),
  );
} finally {
  await sql.end({ timeout: 1 });
}
