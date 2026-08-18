-- Sprint 3 AI Story Execution Engine (video only — corrects Flux/marketing_outputs mistake)
-- EXEC-02: DROP statements removed. Overlay migrations must remain additive and must not
-- destroy leftover production AI Story rows. Obsolete columns may remain unused.

CREATE TABLE IF NOT EXISTS ai_story_execution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  capability_id TEXT NOT NULL DEFAULT 'animation-video-generation',
  target_output_count INTEGER NOT NULL DEFAULT 5,
  selected_output_count INTEGER,
  progress JSONB NOT NULL DEFAULT '{"phase":"queued","percent":0,"message":"","completedOutputs":0,"targetOutputs":5,"providerAttempts":0}'::jsonb,
  generate_review JSONB,
  execution_manifest JSONB,
  provider_execution_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TIMESTAMPTZ,
  created_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_story_execution_jobs ADD COLUMN IF NOT EXISTS execution_manifest JSONB;
ALTER TABLE ai_story_execution_jobs ALTER COLUMN capability_id SET DEFAULT 'animation-video-generation';

CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_story_idx
  ON ai_story_execution_jobs (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_workspace_idx
  ON ai_story_execution_jobs (workspace_id, status);
CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_status_idx
  ON ai_story_execution_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_story_execution_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  execution_job_id UUID NOT NULL REFERENCES ai_story_execution_jobs(id) ON DELETE CASCADE,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE CASCADE,
  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  output_type TEXT NOT NULL DEFAULT 'animation_video',
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  output_index INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT,
  generated_video_asset_id UUID,
  referenced_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  execution_manifest JSONB,
  caption TEXT NOT NULL DEFAULT '',
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_id TEXT,
  provider_execution_id TEXT,
  quality_score NUMERIC,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_job_id, output_index)
);

CREATE INDEX IF NOT EXISTS ai_story_execution_outputs_job_idx
  ON ai_story_execution_outputs (execution_job_id, output_index);
CREATE INDEX IF NOT EXISTS ai_story_execution_outputs_workspace_idx
  ON ai_story_execution_outputs (workspace_id, status);
