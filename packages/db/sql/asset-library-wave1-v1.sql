-- Wave 1: Workspace Asset Library + Asset Story. Additive and ID-preserving.
CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE assets ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS original_filename text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'campaign_upload';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS uploaded_by uuid;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE assets SET
  original_filename = COALESCE(original_filename, NULLIF(metadata->>'originalFilename', '')),
  display_name = COALESCE(
    display_name,
    NULLIF(metadata->>'originalFilename', ''),
    regexp_replace(storage_path, '^.*/', '')
  )
WHERE display_name IS NULL OR original_filename IS NULL;

ALTER TABLE assets ALTER COLUMN campaign_id DROP NOT NULL;
DO $$
DECLARE fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = current_schema() AND tc.table_name = 'assets'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'campaign_id'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN EXECUTE format('ALTER TABLE assets DROP CONSTRAINT %I', fk_name); END IF;
  ALTER TABLE assets ADD CONSTRAINT assets_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
END $$;

CREATE INDEX IF NOT EXISTS assets_workspace_idx ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS assets_workspace_deleted_idx ON assets(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS assets_workspace_content_hash_idx ON assets(workspace_id, content_hash);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_org_id_fkey') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_workspace_id_fkey') THEN
    ALTER TABLE assets ADD CONSTRAINT assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  cover_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT stories_status_check CHECK (status IN ('draft', 'ready', 'archived'))
);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS cover_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_org_id_fkey') THEN
    ALTER TABLE stories ADD CONSTRAINT stories_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_workspace_id_fkey') THEN
    ALTER TABLE stories ADD CONSTRAINT stories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS stories_workspace_idx ON stories(workspace_id);
CREATE INDEX IF NOT EXISTS stories_workspace_deleted_idx ON stories(workspace_id, deleted_at);

CREATE TABLE IF NOT EXISTS story_assets (
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(story_id, asset_id)
);
CREATE INDEX IF NOT EXISTS story_assets_story_idx ON story_assets(story_id, sort_order);
CREATE INDEX IF NOT EXISTS story_assets_asset_idx ON story_assets(asset_id);

CREATE TABLE IF NOT EXISTS campaign_asset_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, asset_id)
);
CREATE INDEX IF NOT EXISTS campaign_asset_refs_campaign_idx ON campaign_asset_refs(campaign_id, sort_order);

CREATE TABLE IF NOT EXISTS campaign_story_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, story_id)
);
CREATE INDEX IF NOT EXISTS campaign_story_refs_campaign_idx ON campaign_story_refs(campaign_id);

-- Historical rows retain their IDs and become Campaign references.
INSERT INTO campaign_asset_refs(campaign_id, asset_id, sort_order)
SELECT campaign_id, id, row_number() OVER (PARTITION BY campaign_id ORDER BY created_at, id) - 1
FROM assets WHERE campaign_id IS NOT NULL
ON CONFLICT(campaign_id, asset_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_asset_story_workspace_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE left_org uuid; left_workspace uuid; right_org uuid; right_workspace uuid;
BEGIN
  IF TG_TABLE_NAME = 'story_assets' THEN
    SELECT org_id, workspace_id INTO left_org, left_workspace FROM stories WHERE id = NEW.story_id;
    SELECT org_id, workspace_id INTO right_org, right_workspace FROM assets WHERE id = NEW.asset_id;
  ELSIF TG_TABLE_NAME = 'campaign_asset_refs' THEN
    SELECT org_id, workspace_id INTO left_org, left_workspace FROM campaigns WHERE id = NEW.campaign_id;
    SELECT org_id, workspace_id INTO right_org, right_workspace FROM assets WHERE id = NEW.asset_id;
  ELSE
    SELECT org_id, workspace_id INTO left_org, left_workspace FROM campaigns WHERE id = NEW.campaign_id;
    SELECT org_id, workspace_id INTO right_org, right_workspace FROM stories WHERE id = NEW.story_id;
  END IF;
  IF left_org IS NULL OR right_org IS NULL OR left_org <> right_org OR left_workspace <> right_workspace THEN
    RAISE EXCEPTION 'cross-tenant or cross-workspace Asset reference denied' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS story_assets_workspace_identity ON story_assets;
CREATE TRIGGER story_assets_workspace_identity BEFORE INSERT OR UPDATE ON story_assets
FOR EACH ROW EXECUTE FUNCTION enforce_asset_story_workspace_identity();
DROP TRIGGER IF EXISTS campaign_asset_refs_workspace_identity ON campaign_asset_refs;
CREATE TRIGGER campaign_asset_refs_workspace_identity BEFORE INSERT OR UPDATE ON campaign_asset_refs
FOR EACH ROW EXECUTE FUNCTION enforce_asset_story_workspace_identity();
DROP TRIGGER IF EXISTS campaign_story_refs_workspace_identity ON campaign_story_refs;
CREATE TRIGGER campaign_story_refs_workspace_identity BEFORE INSERT OR UPDATE ON campaign_story_refs
FOR EACH ROW EXECUTE FUNCTION enforce_asset_story_workspace_identity();

CREATE OR REPLACE FUNCTION enforce_story_cover_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.id = NEW.cover_asset_id
      AND a.org_id = NEW.org_id AND a.workspace_id = NEW.workspace_id AND a.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Asset Story cover is outside the authorized Workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stories_cover_identity ON stories;
CREATE TRIGGER stories_cover_identity BEFORE INSERT OR UPDATE ON stories
FOR EACH ROW EXECUTE FUNCTION enforce_story_cover_identity();

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_asset_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_story_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_all ON assets;
CREATE POLICY assets_all ON assets FOR ALL
  USING (workspace_id IN (SELECT user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT user_workspace_ids()));
DROP POLICY IF EXISTS stories_all ON stories;
CREATE POLICY stories_all ON stories FOR ALL
  USING (workspace_id IN (SELECT user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT user_workspace_ids()));
DROP POLICY IF EXISTS story_assets_all ON story_assets;
CREATE POLICY story_assets_all ON story_assets FOR ALL
  USING (story_id IN (SELECT id FROM stories WHERE workspace_id IN (SELECT user_workspace_ids())))
  WITH CHECK (story_id IN (SELECT id FROM stories WHERE workspace_id IN (SELECT user_workspace_ids())));
DROP POLICY IF EXISTS campaign_asset_refs_all ON campaign_asset_refs;
CREATE POLICY campaign_asset_refs_all ON campaign_asset_refs FOR ALL
  USING (campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())))
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())));
DROP POLICY IF EXISTS campaign_story_refs_all ON campaign_story_refs;
CREATE POLICY campaign_story_refs_all ON campaign_story_refs FOR ALL
  USING (campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())))
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())));
