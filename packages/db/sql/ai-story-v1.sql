-- Campaign-owned AI Story (V1 vertical slice) — distinct from workspace `stories`.
CREATE TABLE IF NOT EXISTS ai_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title text NOT NULL,
  original_idea text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_stories_campaign_idx ON ai_stories (campaign_id);
CREATE INDEX IF NOT EXISTS ai_stories_workspace_idx ON ai_stories (workspace_id, status);

CREATE TABLE IF NOT EXISTS ai_story_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  structured_content jsonb NOT NULL,
  source_context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_edited boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  frozen_at timestamptz,
  frozen_by uuid,
  UNIQUE (story_id, version_number)
);

CREATE INDEX IF NOT EXISTS ai_story_versions_story_idx ON ai_story_versions (story_id, version_number DESC);

CREATE TABLE IF NOT EXISTS ai_story_asset_links (
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  usage_type text NOT NULL DEFAULT 'reference',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, asset_id)
);

CREATE INDEX IF NOT EXISTS ai_story_asset_links_asset_idx ON ai_story_asset_links (asset_id);

ALTER TABLE ai_stories
  ADD CONSTRAINT ai_stories_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES ai_story_versions(id) ON DELETE SET NULL;
