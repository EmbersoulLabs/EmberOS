-- Sprint 3 PR 3.7 Phase A: Final Story Result persistence (success-only).
-- Immutable projection subordinate to Execution Plan.
-- No Export / Publish / Video Studio tables.
-- Failures remain on upstream Scene / Assembly facts.

CREATE TABLE IF NOT EXISTS ai_story_final_story_results (
  final_story_result_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  assembly_definition_id UUID NOT NULL
    REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT,
  assembly_job_id UUID NOT NULL
    REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT,
  assembly_artifact_id UUID NOT NULL
    REFERENCES ai_story_assembly_artifacts(artifact_id) ON DELETE RESTRICT,
  assembly_job_identity TEXT NOT NULL,
  ordered_scene_result_ids JSONB NOT NULL,
  output_media_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  media_type TEXT NOT NULL,
  total_duration_ms INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  frame_rate DOUBLE PRECISION NOT NULL,
  assembly_runtime_contract_version TEXT NOT NULL,
  assembly_engine_version TEXT NOT NULL,
  normalization_policy_version TEXT NOT NULL,
  final_story_result_contract_version TEXT NOT NULL,
  assembly_engine_snapshot_hash TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL,
  projection_version TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  CONSTRAINT ai_story_final_story_results_job_unique UNIQUE (assembly_job_id),
  CONSTRAINT ai_story_final_story_results_artifact_unique UNIQUE (assembly_artifact_id),
  CONSTRAINT ai_story_final_story_results_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_final_story_results_job_identity_unique UNIQUE (assembly_job_identity)
);

CREATE INDEX IF NOT EXISTS ai_story_final_story_results_workspace_idx
  ON ai_story_final_story_results (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_final_story_results_plan_idx
  ON ai_story_final_story_results (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_final_story_results_content_hash_idx
  ON ai_story_final_story_results (content_hash);
