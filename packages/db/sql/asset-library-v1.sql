-- PD-036 / PD-037 Asset Library V1
-- Workspace-owned assets + Stories + Campaign references

-- ── assets: workspace ownership columns ─────────────────────────────────────
ALTER TABLE assets ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS original_filename text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'campaign_upload';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS uploaded_by uuid;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Backfill display / original filename from metadata when present
UPDATE assets
SET
  original_filename = COALESCE(
    original_filename,
    NULLIF(metadata->>'originalFilename', '')
  ),
  display_name = COALESCE(
    display_name,
    NULLIF(metadata->>'originalFilename', ''),
    split_part(storage_path, '/', array_length(string_to_array(storage_path, '/'), 1))
  )
WHERE display_name IS NULL OR original_filename IS NULL;

-- Legacy compatibility only: make campaign_id nullable and stop cascading asset
-- deletion with campaigns. This column is scheduled for removal after backfill
-- and all consumers have migrated to campaign_asset_refs.
ALTER TABLE assets ALTER COLUMN campaign_id DROP NOT NULL;

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'assets'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'campaign_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assets DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE assets
  ADD CONSTRAINT assets_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS assets_workspace_idx ON assets (workspace_id);
CREATE INDEX IF NOT EXISTS assets_workspace_deleted_idx ON assets (workspace_id, deleted_at);

-- ── stories ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS stories_workspace_idx ON stories (workspace_id);
CREATE INDEX IF NOT EXISTS stories_workspace_deleted_idx ON stories (workspace_id, deleted_at);

-- ── story_assets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_assets (
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, asset_id)
);

CREATE INDEX IF NOT EXISTS story_assets_story_idx ON story_assets (story_id, sort_order);
CREATE INDEX IF NOT EXISTS story_assets_asset_idx ON story_assets (asset_id);

-- ── campaign_asset_refs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_asset_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, asset_id)
);

CREATE INDEX IF NOT EXISTS campaign_asset_refs_campaign_idx
  ON campaign_asset_refs (campaign_id, sort_order);

-- Backfill refs from legacy campaign-owned rows. New application code must not
-- write assets.campaign_id.
INSERT INTO campaign_asset_refs (campaign_id, asset_id, sort_order)
SELECT a.campaign_id, a.id, ROW_NUMBER() OVER (PARTITION BY a.campaign_id ORDER BY a.created_at) - 1
FROM assets a
WHERE a.campaign_id IS NOT NULL
ON CONFLICT (campaign_id, asset_id) DO NOTHING;

-- ── campaign_story_refs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_story_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, story_id)
);

CREATE INDEX IF NOT EXISTS campaign_story_refs_campaign_idx ON campaign_story_refs (campaign_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_asset_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_story_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stories_all ON stories;
CREATE POLICY stories_all ON stories
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS story_assets_all ON story_assets;
CREATE POLICY story_assets_all ON story_assets
  FOR ALL USING (
    story_id IN (SELECT id FROM stories WHERE workspace_id IN (SELECT user_workspace_ids()))
  );

DROP POLICY IF EXISTS campaign_asset_refs_all ON campaign_asset_refs;
CREATE POLICY campaign_asset_refs_all ON campaign_asset_refs
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );

DROP POLICY IF EXISTS campaign_story_refs_all ON campaign_story_refs;
CREATE POLICY campaign_story_refs_all ON campaign_story_refs
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );
