-- EXEC-04: generated Scene media review + retry uniqueness.
-- Additive table. Constraint changes allow historical attempts without rewriting rows.
-- Does not apply to production from this ticket.

ALTER TABLE ai_story_scene_results
  DROP CONSTRAINT IF EXISTS ai_story_scene_results_scene_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_scene_results_scene_attempt_unique
  ON ai_story_scene_results (scene_execution_id, provider_attempt_id);

ALTER TABLE ai_story_scene_projection_correlations
  DROP CONSTRAINT IF EXISTS ai_story_scene_projection_scene_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_scene_projection_scene_attempt_unique
  ON ai_story_scene_projection_correlations (scene_execution_id, provider_attempt_id);

ALTER TABLE ai_story_scene_scheduling_correlations
  DROP CONSTRAINT IF EXISTS ai_story_scene_scheduling_scene_unique;

CREATE INDEX IF NOT EXISTS ai_story_scene_scheduling_scene_idx
  ON ai_story_scene_scheduling_correlations (scene_execution_id, accepted_at);

CREATE TABLE IF NOT EXISTS ai_story_generated_scene_reviews (
  generated_scene_review_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL
    REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL
    REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL,
  provider_attempt_id TEXT NOT NULL,
  scene_result_id UUID REFERENCES ai_story_scene_results(scene_result_id) ON DELETE RESTRICT,
  decision TEXT NOT NULL,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  rationale TEXT,
  contract_version TEXT NOT NULL,
  fact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_generated_scene_reviews_decision_check
    CHECK (decision IN ('PENDING_REVIEW', 'APPROVED', 'RETRY_REQUESTED', 'REJECTED_TERMINAL')),
  CONSTRAINT ai_story_generated_scene_reviews_scene_attempt_unique
    UNIQUE (scene_execution_id, provider_attempt_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_generated_scene_reviews_approved_scene_unique
  ON ai_story_generated_scene_reviews (scene_execution_id)
  WHERE decision = 'APPROVED';

CREATE INDEX IF NOT EXISTS ai_story_generated_scene_reviews_plan_idx
  ON ai_story_generated_scene_reviews (execution_plan_id, created_at);

CREATE INDEX IF NOT EXISTS ai_story_generated_scene_reviews_workspace_idx
  ON ai_story_generated_scene_reviews (workspace_id, created_at);
