-- Sprint 3 AI Story Execution Engine
CREATE TABLE IF NOT EXISTS ai_story_execution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  media_kind TEXT NOT NULL DEFAULT 'video',
  capability_id TEXT NOT NULL,
  target_output_count INTEGER NOT NULL DEFAULT 5,
  selected_output_count INTEGER,
  progress JSONB NOT NULL DEFAULT '{"phase":"queued","percent":0,"message":"","completedOutputs":0,"targetOutputs":5,"providerAttempts":0}'::jsonb,
  generate_review JSONB,
  prompt_package JSONB,
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

CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_story_idx
  ON ai_story_execution_jobs (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_workspace_idx
  ON ai_story_execution_jobs (workspace_id, status);
CREATE INDEX IF NOT EXISTS ai_story_execution_jobs_status_idx
  ON ai_story_execution_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_story_marketing_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE CASCADE,
  execution_job_id UUID NOT NULL REFERENCES ai_story_execution_jobs(id) ON DELETE CASCADE,
  creative_id UUID REFERENCES creatives(id) ON DELETE SET NULL,
  media_kind TEXT NOT NULL DEFAULT 'video',
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  output_index INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT,
  thumbnail_path TEXT,
  subtitle_path TEXT,
  caption TEXT NOT NULL DEFAULT '',
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_id TEXT,
  provider_execution_id TEXT,
  quality_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_job_id, output_index)
);

CREATE INDEX IF NOT EXISTS ai_story_marketing_outputs_job_idx
  ON ai_story_marketing_outputs (execution_job_id, output_index);
CREATE INDEX IF NOT EXISTS ai_story_marketing_outputs_workspace_idx
  ON ai_story_marketing_outputs (workspace_id, status);
