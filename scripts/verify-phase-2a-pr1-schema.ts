import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";

async function main() {
  config({ path: resolve(process.cwd(), "apps/worker/.env") });
  config({ path: resolve(process.cwd(), "apps/web/.env.local") });
  config({ path: resolve(process.cwd(), ".env.local") });

  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL missing");

  const sql = postgres(url, { max: 1, prepare: false });
  const phase2a = [
    "ai_story_execution_plans",
    "ai_story_scene_executions",
    "ai_story_scene_instruction_snapshots",
    "ai_story_scene_intent_validation_results",
  ] as const;
  const legacy = ["ai_story_execution_jobs", "ai_story_execution_outputs"] as const;

  try {
    const present = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${[...phase2a, ...legacy]})
      ORDER BY tablename
    `;
    const indexes = await sql`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY(${[...phase2a]})
      ORDER BY tablename, indexname
    `;
    const constraints = await sql`
      SELECT table_name, constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = ANY(${[...phase2a]})
        AND constraint_type IN ('UNIQUE', 'PRIMARY KEY', 'FOREIGN KEY', 'CHECK')
      ORDER BY table_name, constraint_type, constraint_name
    `;
    const fks = await sql`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ANY(${[...phase2a]})
      ORDER BY tc.table_name, tc.constraint_name, kcu.column_name
    `;
    const fingerprintUnique = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ai_story_execution_plans'
        AND constraint_name = 'ai_story_execution_plans_fingerprint_unique'
    `;
    const storyVersionUnique = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ai_story_execution_plans'
        AND constraint_name = 'ai_story_execution_plans_story_version_unique'
    `;
    const legacyCols = await sql`
      SELECT table_name, count(*)::int AS column_count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(${[...legacy]})
      GROUP BY table_name
      ORDER BY table_name
    `;
    const intentCol = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_story_scene_executions'
        AND column_name = 'intent'
    `;

    console.log(
      JSON.stringify(
        {
          tables: present.map((r) => r.tablename),
          indexes: indexes.map((r) => `${r.tablename}.${r.indexname}`),
          constraints: constraints.map(
            (r) => `${r.table_name}.${r.constraint_name}:${r.constraint_type}`
          ),
          foreignKeys: fks.map(
            (r) =>
              `${r.table_name}.${r.column_name}->${r.foreign_table}.${r.foreign_column}`
          ),
          hasFingerprintUnique: fingerprintUnique.length === 1,
          hasRejectedStoryVersionUnique: storyVersionUnique.length === 1,
          legacyColumns: legacyCols,
          intentColumn: intentCol,
        },
        null,
        2
      )
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
