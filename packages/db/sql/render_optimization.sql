-- Render optimization columns (run via pnpm db:marketing-os or Supabase SQL editor)
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_status text DEFAULT 'none';
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_progress jsonb;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_cache_path text;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_cache_fingerprint text;
