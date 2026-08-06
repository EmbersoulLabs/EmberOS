-- Sprint 3 Phase 2A PR 1: additive AI Story Scene Execution persistence.
-- This migration creates immutable planning/QC storage only. It creates no
-- provider request, outbox, queue, worker, attempt, result, usage, or cost path.
-- Legacy ai_story_execution_jobs / ai_story_execution_outputs remain untouched.
--
-- Uniqueness is deterministic compilation identity (deterministic_fingerprint),
-- not Story Version alone. Multiple valid plans may exist for one Story Version
-- when Animation Package or compilation identity differs.

CREATE TABLE IF NOT EXISTS ai_story_scene_instruction_snapshots (
  content_hash TEXT PRIMARY KEY,
  snapshot_id UUID NOT NULL UNIQUE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  contract_version TEXT NOT NULL,
  instructions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_story_instruction_snapshots_id_idx
  ON ai_story_scene_instruction_snapshots (snapshot_id);
CREATE INDEX IF NOT EXISTS ai_story_instruction_snapshots_workspace_idx
  ON ai_story_scene_instruction_snapshots (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS ai_story_execution_plans (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status = 'PLANNED'),
  contract_version TEXT NOT NULL,
  compilation_hash TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  plan JSONB NOT NULL,
  compiled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_execution_plans_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_execution_plans_workspace_idx
  ON ai_story_execution_plans (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS ai_story_execution_plans_story_idx
  ON ai_story_execution_plans (story_id, created_at);
CREATE INDEX IF NOT EXISTS ai_story_execution_plans_story_version_idx
  ON ai_story_execution_plans (workspace_id, story_version_id, created_at);

-- Review fix: drop rejected Story-Version-only uniqueness if an earlier PR1 draft applied it.
ALTER TABLE ai_story_execution_plans
  DROP CONSTRAINT IF EXISTS ai_story_execution_plans_story_version_unique;

CREATE TABLE IF NOT EXISTS ai_story_scene_executions (
  id UUID PRIMARY KEY,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL,
  scene_order INTEGER NOT NULL CHECK (scene_order >= 0),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status = 'PLANNED'),
  idempotency_key TEXT NOT NULL UNIQUE,
  deterministic_fingerprint TEXT NOT NULL,
  compilation_hash TEXT NOT NULL,
  instruction_hash TEXT NOT NULL REFERENCES ai_story_scene_instruction_snapshots(content_hash) ON DELETE RESTRICT,
  intent JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_executions_plan_scene_unique UNIQUE (execution_plan_id, scene_id),
  CONSTRAINT ai_story_scene_executions_plan_order_unique UNIQUE (execution_plan_id, scene_order)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_executions_plan_idx
  ON ai_story_scene_executions (execution_plan_id, scene_order);

CREATE TABLE IF NOT EXISTS ai_story_scene_intent_validation_results (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  intent_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'warning')),
  result JSONB NOT NULL,
  validated_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_validation_result_unique UNIQUE (scene_execution_id, result_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_validation_scene_idx
  ON ai_story_scene_intent_validation_results (scene_execution_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_validation_plan_idx
  ON ai_story_scene_intent_validation_results (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_validation_workspace_idx
  ON ai_story_scene_intent_validation_results (workspace_id, accepted_at);
