/**
 * Read-only storage preflight. Never prints object keys or signed URLs.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const file = process.env.AI_STORY_RAILWAY_VARS_FILE?.trim();
  if (!file) throw new Error("AI_STORY_RAILWAY_VARS_FILE is required");
  const vars = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const url = vars.NEXT_PUBLIC_SUPABASE_URL?.trim() || vars.SUPABASE_URL?.trim();
  const key = vars.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = vars.SUPABASE_STORAGE_BUCKET?.trim() || "campaign-assets";
  if (!url || !key) {
    console.log(
      JSON.stringify({
        status: "STORAGE_ENV_INCOMPLETE",
        hasUrl: Boolean(url),
        hasServiceRole: Boolean(key),
      })
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.log(JSON.stringify({ status: "LIST_BUCKETS_FAILED", message: error.message }));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      canonicalBucket: bucket,
      buckets: (data ?? []).map((row) => ({
        id: row.id,
        public: row.public,
        matchCanonical: row.id === bucket,
      })),
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
