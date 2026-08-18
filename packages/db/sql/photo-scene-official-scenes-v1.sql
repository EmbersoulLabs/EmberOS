-- Photo Scene 10C — global official scene catalog + tenant scene selection.
-- Additive. Official scenes are NOT tenant-owned. No creative_assets / creative_studio_jobs.
-- No Video Studio task/creative changes. No production apply.

CREATE TABLE IF NOT EXISTS photo_scene_official_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_scene_official_scene_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES photo_scene_official_scenes(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  supported_presets text[] NOT NULL,
  background_storage_identity text NOT NULL,
  background_content_hash text NOT NULL,
  preview_storage_identity text NOT NULL,
  safe_area jsonb NOT NULL,
  product_anchor text NOT NULL,
  scale_min numeric NOT NULL,
  scale_max numeric NOT NULL,
  default_scale numeric NOT NULL,
  default_offset_x numeric NOT NULL DEFAULT 0,
  default_offset_y numeric NOT NULL DEFAULT 0,
  default_shadow_preset text NOT NULL DEFAULT 'soft',
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS photo_scene_official_scene_one_published_idx
  ON photo_scene_official_scene_versions (scene_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS photo_scene_official_scene_versions_status_idx
  ON photo_scene_official_scene_versions (status, scene_id);

CREATE TABLE IF NOT EXISTS photo_scene_scene_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  extracted_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  frozen_selection jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS photo_scene_scene_selections_campaign_idx
  ON photo_scene_scene_selections (campaign_id);

ALTER TABLE photo_scene_official_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_scene_official_scene_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_scene_scene_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_scene_official_scenes_select ON photo_scene_official_scenes;
CREATE POLICY photo_scene_official_scenes_select ON photo_scene_official_scenes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS photo_scene_official_scene_versions_select ON photo_scene_official_scene_versions;
CREATE POLICY photo_scene_official_scene_versions_select ON photo_scene_official_scene_versions
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND status IN ('published', 'retired')
  );

DROP POLICY IF EXISTS photo_scene_scene_selections_all ON photo_scene_scene_selections;
CREATE POLICY photo_scene_scene_selections_all ON photo_scene_scene_selections
  FOR ALL USING (
    workspace_id IN (SELECT user_workspace_ids())
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids())
    AND org_id = (SELECT org_id FROM workspaces WHERE id = workspace_id)
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );
