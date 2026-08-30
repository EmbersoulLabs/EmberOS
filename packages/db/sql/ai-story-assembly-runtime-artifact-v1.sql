-- Sprint 3 PR 3.6 — immutable Assembly Runtime artifact metadata.
-- Stores references only (no binary). No Final Story Result.
-- Execution Plan remains the sole Aggregate Root.

CREATE TABLE IF NOT EXISTS ai_story_assembly_artifacts (
  artifact_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  assembly_job_id UUID NOT NULL
    REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT,
  execution_identity TEXT NOT NULL,
  artifact_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  media_type TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  frame_rate DOUBLE PRECISION NOT NULL,
  byte_size INTEGER NOT NULL,
  assembly_engine_version TEXT NOT NULL,
  normalization_policy_version TEXT NOT NULL,
  assembly_runtime_contract_version TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ai_story_assembly_artifacts_identity_unique UNIQUE (execution_identity),
  CONSTRAINT ai_story_assembly_artifacts_hash_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_assembly_artifacts_job_unique UNIQUE (assembly_job_id)
);

CREATE INDEX IF NOT EXISTS ai_story_assembly_artifacts_workspace_idx
  ON ai_story_assembly_artifacts (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_artifacts_plan_idx
  ON ai_story_assembly_artifacts (execution_plan_id, created_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_artifacts_content_hash_idx
  ON ai_story_assembly_artifacts (content_hash);
