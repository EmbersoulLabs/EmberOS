-- AI Story Sprint 2 Planning Engine — Animation Package ready-for-execution boundary.
CREATE TABLE IF NOT EXISTS ai_story_creative_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_story_creative_contexts_story_idx
  ON ai_story_creative_contexts (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_creative_contexts_workspace_idx
  ON ai_story_creative_contexts (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_story_animation_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'generating',
  payload jsonb NOT NULL,
  consistency_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid
);

CREATE INDEX IF NOT EXISTS ai_story_animation_packages_story_idx
  ON ai_story_animation_packages (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_animation_packages_workspace_idx
  ON ai_story_animation_packages (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_animation_packages_status_idx
  ON ai_story_animation_packages (status);
CREATE INDEX IF NOT EXISTS ai_story_animation_packages_workspace_status_idx
  ON ai_story_animation_packages (workspace_id, status);
