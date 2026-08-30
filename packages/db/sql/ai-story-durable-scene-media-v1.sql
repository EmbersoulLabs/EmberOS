-- Sprint 4 Phase A: Durable Scene Media Attestation (immutable).
-- Subordinate to Canonical Scene Result. No UPDATE/DELETE product paths.

CREATE TABLE IF NOT EXISTS ai_story_durable_scene_media_attestations (
  media_attestation_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  scene_result_id UUID NOT NULL REFERENCES ai_story_scene_results(scene_result_id) ON DELETE RESTRICT,
  source_media_reference JSONB NOT NULL,
  durable_object_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  media_type TEXT NOT NULL,
  ingest_contract_version TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_namespace_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  attestation JSONB NOT NULL,
  CONSTRAINT ai_story_durable_scene_media_scene_unique UNIQUE (scene_result_id),
  CONSTRAINT ai_story_durable_scene_media_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_durable_scene_media_object_unique UNIQUE (durable_object_reference)
);

CREATE INDEX IF NOT EXISTS ai_story_durable_scene_media_workspace_idx
  ON ai_story_durable_scene_media_attestations (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_durable_scene_media_plan_idx
  ON ai_story_durable_scene_media_attestations (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_durable_scene_media_hash_idx
  ON ai_story_durable_scene_media_attestations (content_hash);
