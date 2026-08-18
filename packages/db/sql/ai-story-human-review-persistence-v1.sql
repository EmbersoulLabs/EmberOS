-- Sprint 3 Phase 2B PR 2B.1: additive Human Review append-only facts.
-- Execution Plan remains the only Aggregate Root. Review is a logical aggregate
-- owned by the Execution Plan. No mutable review lifecycle rows. No Assembly,
-- Queue, Worker, Outbox, Provider, API, UI, or RLS in this migration.

CREATE TABLE IF NOT EXISTS ai_story_review_opened_facts (
  fact_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  fact JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_review_opened_plan_unique UNIQUE (execution_plan_id),
  CONSTRAINT ai_story_review_opened_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_review_opened_workspace_idx
  ON ai_story_review_opened_facts (workspace_id, accepted_at);

CREATE TABLE IF NOT EXISTS ai_story_scene_intent_review_facts (
  fact_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL,
  scene_order INTEGER NOT NULL CHECK (scene_order >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reviewed_by UUID NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  instruction_hash TEXT NOT NULL REFERENCES ai_story_scene_instruction_snapshots(content_hash) ON DELETE RESTRICT,
  qc_result_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  fact JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_intent_review_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_intent_review_plan_idx
  ON ai_story_scene_intent_review_facts (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_intent_review_scene_idx
  ON ai_story_scene_intent_review_facts (scene_execution_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_intent_review_workspace_idx
  ON ai_story_scene_intent_review_facts (workspace_id, accepted_at);

CREATE TABLE IF NOT EXISTS ai_story_story_review_facts (
  fact_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reviewed_by UUID NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  fact JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_story_review_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_story_review_plan_idx
  ON ai_story_story_review_facts (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_story_review_workspace_idx
  ON ai_story_story_review_facts (workspace_id, accepted_at);
