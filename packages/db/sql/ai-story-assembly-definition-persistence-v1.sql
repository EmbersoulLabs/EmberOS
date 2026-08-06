-- Sprint 3 Phase 2B PR 2B.2: additive Story Assembly Definition persistence.
-- Execution Plan remains the only Aggregate Root. Assembly Definition is
-- subordinate immutable ordering for future execution. Not media assembly,
-- not Story Video. No Queue, Worker, Outbox, Provider, API, UI, or RLS.

CREATE TABLE IF NOT EXISTS ai_story_assembly_definitions (
  assembly_definition_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_count INTEGER NOT NULL CHECK (scene_count > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  definition JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_assembly_definition_plan_unique UNIQUE (execution_plan_id),
  CONSTRAINT ai_story_assembly_definition_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_assembly_definition_workspace_idx
  ON ai_story_assembly_definitions (workspace_id, accepted_at);

CREATE TABLE IF NOT EXISTS ai_story_assembly_scene_memberships (
  membership_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  assembly_definition_id UUID NOT NULL REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL,
  scene_order INTEGER NOT NULL CHECK (scene_order >= 0),
  contract_version TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  membership JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_assembly_membership_fingerprint_unique UNIQUE (deterministic_fingerprint),
  CONSTRAINT ai_story_assembly_membership_def_scene_unique UNIQUE (assembly_definition_id, scene_execution_id),
  CONSTRAINT ai_story_assembly_membership_def_order_unique UNIQUE (assembly_definition_id, scene_order)
);

CREATE INDEX IF NOT EXISTS ai_story_assembly_membership_plan_idx
  ON ai_story_assembly_scene_memberships (execution_plan_id, scene_order);
CREATE INDEX IF NOT EXISTS ai_story_assembly_membership_def_idx
  ON ai_story_assembly_scene_memberships (assembly_definition_id, scene_order);
CREATE INDEX IF NOT EXISTS ai_story_assembly_membership_workspace_idx
  ON ai_story_assembly_scene_memberships (workspace_id, accepted_at);
