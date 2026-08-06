-- Sprint 3 Phase 2B PR 2B.3 remediation: canonical AI Story RLS.
-- Execution Plan remains the only Aggregate Root.
-- INSERT WITH CHECK uses fully-qualified outer-row columns to prevent
-- column-shadowing tautologies inside EXISTS subqueries.
-- Instruction Snapshots: relationship-scoped SELECT only — no authenticated INSERT/UPDATE/DELETE.
-- Service role / DB owner may bypass RLS (infrastructure, not authorization).
-- Canonical repositories still enforce ownership independently.
-- Complements repository validation. No Queue, Worker, Outbox, Provider, API, UI.

CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Instruction Snapshots (relationship-scoped SELECT, no client writes) ─────
ALTER TABLE ai_story_scene_instruction_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_instruction_snapshots_select ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_instruction_snapshots_insert ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_instruction_snapshots_update ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_instruction_snapshots_delete ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_instruction_snapshots_all ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_select ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_insert ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_update ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_delete ON ai_story_scene_instruction_snapshots;
DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_all ON ai_story_scene_instruction_snapshots;

-- SELECT only when an authorized Scene Execution references this content hash
-- through a valid Execution Plan ownership chain. Workspace membership alone
-- or knowing a content hash is not sufficient.
CREATE POLICY ai_story_instruction_snapshots_select ON ai_story_scene_instruction_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ai_story_scene_executions scene
      INNER JOIN ai_story_execution_plans plan
        ON plan.id = scene.execution_plan_id
      WHERE scene.instruction_hash = ai_story_scene_instruction_snapshots.content_hash
        AND scene.org_id = ai_story_scene_instruction_snapshots.org_id
        AND scene.workspace_id = ai_story_scene_instruction_snapshots.workspace_id
        AND plan.org_id = scene.org_id
        AND plan.workspace_id = scene.workspace_id
        AND plan.campaign_id = scene.campaign_id
        AND plan.story_id = scene.story_id
        AND plan.story_version_id = scene.story_version_id
        AND plan.animation_package_id = scene.animation_package_id
        AND scene.workspace_id IN (SELECT user_workspace_ids())
        AND scene.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = scene.workspace_id
        )
        AND EXISTS (
          SELECT 1 FROM campaigns campaign
          WHERE campaign.id = plan.campaign_id
            AND campaign.workspace_id = plan.workspace_id
            AND campaign.org_id = plan.org_id
        )
        AND EXISTS (
          SELECT 1 FROM ai_stories story
          WHERE story.id = plan.story_id
            AND story.campaign_id = plan.campaign_id
            AND story.workspace_id = plan.workspace_id
            AND story.org_id = plan.org_id
        )
        AND EXISTS (
          SELECT 1 FROM ai_story_versions version
          WHERE version.id = plan.story_version_id
            AND version.story_id = plan.story_id
        )
        AND EXISTS (
          SELECT 1 FROM ai_story_animation_packages package
          WHERE package.id = plan.animation_package_id
            AND package.story_id = plan.story_id
            AND package.story_version_id = plan.story_version_id
            AND package.campaign_id = plan.campaign_id
            AND package.workspace_id = plan.workspace_id
            AND package.org_id = plan.org_id
        )
    )
  );

-- No authenticated INSERT / UPDATE / DELETE policies for snapshots.
-- Canonical repositories persist snapshots via service role / DB owner (RLS bypass).

-- ── Execution Plans ──────────────────────────────────────────────────────────
ALTER TABLE ai_story_execution_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_execution_plans_select ON ai_story_execution_plans;
DROP POLICY IF EXISTS ai_story_execution_plans_insert ON ai_story_execution_plans;
DROP POLICY IF EXISTS ai_story_execution_plans_update ON ai_story_execution_plans;
DROP POLICY IF EXISTS ai_story_execution_plans_delete ON ai_story_execution_plans;
DROP POLICY IF EXISTS ai_story_execution_plans_all ON ai_story_execution_plans;

CREATE POLICY ai_story_execution_plans_select ON ai_story_execution_plans
  FOR SELECT
  USING (
    ai_story_execution_plans.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_execution_plans.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_execution_plans.workspace_id
    )
  );

CREATE POLICY ai_story_execution_plans_insert ON ai_story_execution_plans
  FOR INSERT
  WITH CHECK (
    ai_story_execution_plans.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_execution_plans.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_execution_plans.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_execution_plans.campaign_id
        AND campaign.workspace_id = ai_story_execution_plans.workspace_id
        AND campaign.org_id = ai_story_execution_plans.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_execution_plans.story_id
        AND story.campaign_id = ai_story_execution_plans.campaign_id
        AND story.workspace_id = ai_story_execution_plans.workspace_id
        AND story.org_id = ai_story_execution_plans.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_execution_plans.story_version_id
        AND version.story_id = ai_story_execution_plans.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_execution_plans.animation_package_id
        AND package.story_id = ai_story_execution_plans.story_id
        AND package.story_version_id = ai_story_execution_plans.story_version_id
        AND package.campaign_id = ai_story_execution_plans.campaign_id
        AND package.workspace_id = ai_story_execution_plans.workspace_id
        AND package.org_id = ai_story_execution_plans.org_id
    )
  );

-- ── Scene Executions ─────────────────────────────────────────────────────────
ALTER TABLE ai_story_scene_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_scene_executions_select ON ai_story_scene_executions;
DROP POLICY IF EXISTS ai_story_scene_executions_insert ON ai_story_scene_executions;
DROP POLICY IF EXISTS ai_story_scene_executions_update ON ai_story_scene_executions;
DROP POLICY IF EXISTS ai_story_scene_executions_delete ON ai_story_scene_executions;
DROP POLICY IF EXISTS ai_story_scene_executions_all ON ai_story_scene_executions;

CREATE POLICY ai_story_scene_executions_select ON ai_story_scene_executions
  FOR SELECT
  USING (
    ai_story_scene_executions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_executions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_executions.workspace_id
    )
  );

CREATE POLICY ai_story_scene_executions_insert ON ai_story_scene_executions
  FOR INSERT
  WITH CHECK (
    ai_story_scene_executions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_executions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_executions.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_scene_executions.execution_plan_id
        AND plan.org_id = ai_story_scene_executions.org_id
        AND plan.workspace_id = ai_story_scene_executions.workspace_id
        AND plan.campaign_id = ai_story_scene_executions.campaign_id
        AND plan.story_id = ai_story_scene_executions.story_id
        AND plan.story_version_id = ai_story_scene_executions.story_version_id
        AND plan.animation_package_id = ai_story_scene_executions.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_scene_executions.campaign_id
        AND campaign.workspace_id = ai_story_scene_executions.workspace_id
        AND campaign.org_id = ai_story_scene_executions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_scene_executions.story_id
        AND story.campaign_id = ai_story_scene_executions.campaign_id
        AND story.workspace_id = ai_story_scene_executions.workspace_id
        AND story.org_id = ai_story_scene_executions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_scene_executions.story_version_id
        AND version.story_id = ai_story_scene_executions.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_scene_executions.animation_package_id
        AND package.story_id = ai_story_scene_executions.story_id
        AND package.story_version_id = ai_story_scene_executions.story_version_id
        AND package.campaign_id = ai_story_scene_executions.campaign_id
        AND package.workspace_id = ai_story_scene_executions.workspace_id
        AND package.org_id = ai_story_scene_executions.org_id
    )
  );

-- ── Intent Validation Results ────────────────────────────────────────────────
ALTER TABLE ai_story_scene_intent_validation_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_scene_validation_select ON ai_story_scene_intent_validation_results;
DROP POLICY IF EXISTS ai_story_scene_validation_insert ON ai_story_scene_intent_validation_results;
DROP POLICY IF EXISTS ai_story_scene_validation_update ON ai_story_scene_intent_validation_results;
DROP POLICY IF EXISTS ai_story_scene_validation_delete ON ai_story_scene_intent_validation_results;
DROP POLICY IF EXISTS ai_story_scene_validation_all ON ai_story_scene_intent_validation_results;

CREATE POLICY ai_story_scene_validation_select ON ai_story_scene_intent_validation_results
  FOR SELECT
  USING (
    ai_story_scene_intent_validation_results.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_intent_validation_results.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_intent_validation_results.workspace_id
    )
  );

CREATE POLICY ai_story_scene_validation_insert ON ai_story_scene_intent_validation_results
  FOR INSERT
  WITH CHECK (
    ai_story_scene_intent_validation_results.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_intent_validation_results.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_intent_validation_results.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_scene_intent_validation_results.execution_plan_id
        AND plan.org_id = ai_story_scene_intent_validation_results.org_id
        AND plan.workspace_id = ai_story_scene_intent_validation_results.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_intent_validation_results.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_intent_validation_results.execution_plan_id
        AND scene.org_id = ai_story_scene_intent_validation_results.org_id
        AND scene.workspace_id = ai_story_scene_intent_validation_results.workspace_id
    )
  );

-- ── Review Opened Facts ──────────────────────────────────────────────────────
ALTER TABLE ai_story_review_opened_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_review_opened_select ON ai_story_review_opened_facts;
DROP POLICY IF EXISTS ai_story_review_opened_insert ON ai_story_review_opened_facts;
DROP POLICY IF EXISTS ai_story_review_opened_update ON ai_story_review_opened_facts;
DROP POLICY IF EXISTS ai_story_review_opened_delete ON ai_story_review_opened_facts;
DROP POLICY IF EXISTS ai_story_review_opened_all ON ai_story_review_opened_facts;

CREATE POLICY ai_story_review_opened_select ON ai_story_review_opened_facts
  FOR SELECT
  USING (
    ai_story_review_opened_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_review_opened_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_review_opened_facts.workspace_id
    )
  );

CREATE POLICY ai_story_review_opened_insert ON ai_story_review_opened_facts
  FOR INSERT
  WITH CHECK (
    ai_story_review_opened_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_review_opened_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_review_opened_facts.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_review_opened_facts.execution_plan_id
        AND plan.org_id = ai_story_review_opened_facts.org_id
        AND plan.workspace_id = ai_story_review_opened_facts.workspace_id
        AND plan.campaign_id = ai_story_review_opened_facts.campaign_id
        AND plan.story_id = ai_story_review_opened_facts.story_id
        AND plan.story_version_id = ai_story_review_opened_facts.story_version_id
        AND plan.animation_package_id = ai_story_review_opened_facts.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_review_opened_facts.campaign_id
        AND campaign.workspace_id = ai_story_review_opened_facts.workspace_id
        AND campaign.org_id = ai_story_review_opened_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_review_opened_facts.story_id
        AND story.campaign_id = ai_story_review_opened_facts.campaign_id
        AND story.workspace_id = ai_story_review_opened_facts.workspace_id
        AND story.org_id = ai_story_review_opened_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_review_opened_facts.story_version_id
        AND version.story_id = ai_story_review_opened_facts.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_review_opened_facts.animation_package_id
        AND package.story_id = ai_story_review_opened_facts.story_id
        AND package.story_version_id = ai_story_review_opened_facts.story_version_id
        AND package.campaign_id = ai_story_review_opened_facts.campaign_id
        AND package.workspace_id = ai_story_review_opened_facts.workspace_id
        AND package.org_id = ai_story_review_opened_facts.org_id
    )
  );

-- ── Scene Intent Review Facts ────────────────────────────────────────────────
ALTER TABLE ai_story_scene_intent_review_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_scene_intent_review_select ON ai_story_scene_intent_review_facts;
DROP POLICY IF EXISTS ai_story_scene_intent_review_insert ON ai_story_scene_intent_review_facts;
DROP POLICY IF EXISTS ai_story_scene_intent_review_update ON ai_story_scene_intent_review_facts;
DROP POLICY IF EXISTS ai_story_scene_intent_review_delete ON ai_story_scene_intent_review_facts;
DROP POLICY IF EXISTS ai_story_scene_intent_review_all ON ai_story_scene_intent_review_facts;

CREATE POLICY ai_story_scene_intent_review_select ON ai_story_scene_intent_review_facts
  FOR SELECT
  USING (
    ai_story_scene_intent_review_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_intent_review_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_intent_review_facts.workspace_id
    )
  );

CREATE POLICY ai_story_scene_intent_review_insert ON ai_story_scene_intent_review_facts
  FOR INSERT
  WITH CHECK (
    ai_story_scene_intent_review_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_intent_review_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_intent_review_facts.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_scene_intent_review_facts.execution_plan_id
        AND plan.org_id = ai_story_scene_intent_review_facts.org_id
        AND plan.workspace_id = ai_story_scene_intent_review_facts.workspace_id
        AND plan.campaign_id = ai_story_scene_intent_review_facts.campaign_id
        AND plan.story_id = ai_story_scene_intent_review_facts.story_id
        AND plan.story_version_id = ai_story_scene_intent_review_facts.story_version_id
        AND plan.animation_package_id = ai_story_scene_intent_review_facts.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_intent_review_facts.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_intent_review_facts.execution_plan_id
        AND scene.org_id = ai_story_scene_intent_review_facts.org_id
        AND scene.workspace_id = ai_story_scene_intent_review_facts.workspace_id
        AND scene.campaign_id = ai_story_scene_intent_review_facts.campaign_id
        AND scene.story_id = ai_story_scene_intent_review_facts.story_id
        AND scene.story_version_id = ai_story_scene_intent_review_facts.story_version_id
        AND scene.animation_package_id = ai_story_scene_intent_review_facts.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_scene_intent_review_facts.campaign_id
        AND campaign.workspace_id = ai_story_scene_intent_review_facts.workspace_id
        AND campaign.org_id = ai_story_scene_intent_review_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_scene_intent_review_facts.story_id
        AND story.campaign_id = ai_story_scene_intent_review_facts.campaign_id
        AND story.workspace_id = ai_story_scene_intent_review_facts.workspace_id
        AND story.org_id = ai_story_scene_intent_review_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_scene_intent_review_facts.story_version_id
        AND version.story_id = ai_story_scene_intent_review_facts.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_scene_intent_review_facts.animation_package_id
        AND package.story_id = ai_story_scene_intent_review_facts.story_id
        AND package.story_version_id = ai_story_scene_intent_review_facts.story_version_id
        AND package.campaign_id = ai_story_scene_intent_review_facts.campaign_id
        AND package.workspace_id = ai_story_scene_intent_review_facts.workspace_id
        AND package.org_id = ai_story_scene_intent_review_facts.org_id
    )
  );

-- ── Story Review Facts ───────────────────────────────────────────────────────
ALTER TABLE ai_story_story_review_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_story_review_select ON ai_story_story_review_facts;
DROP POLICY IF EXISTS ai_story_story_review_insert ON ai_story_story_review_facts;
DROP POLICY IF EXISTS ai_story_story_review_update ON ai_story_story_review_facts;
DROP POLICY IF EXISTS ai_story_story_review_delete ON ai_story_story_review_facts;
DROP POLICY IF EXISTS ai_story_story_review_all ON ai_story_story_review_facts;

CREATE POLICY ai_story_story_review_select ON ai_story_story_review_facts
  FOR SELECT
  USING (
    ai_story_story_review_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_story_review_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_story_review_facts.workspace_id
    )
  );

CREATE POLICY ai_story_story_review_insert ON ai_story_story_review_facts
  FOR INSERT
  WITH CHECK (
    ai_story_story_review_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_story_review_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_story_review_facts.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_story_review_facts.execution_plan_id
        AND plan.org_id = ai_story_story_review_facts.org_id
        AND plan.workspace_id = ai_story_story_review_facts.workspace_id
        AND plan.campaign_id = ai_story_story_review_facts.campaign_id
        AND plan.story_id = ai_story_story_review_facts.story_id
        AND plan.story_version_id = ai_story_story_review_facts.story_version_id
        AND plan.animation_package_id = ai_story_story_review_facts.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_story_review_facts.campaign_id
        AND campaign.workspace_id = ai_story_story_review_facts.workspace_id
        AND campaign.org_id = ai_story_story_review_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_story_review_facts.story_id
        AND story.campaign_id = ai_story_story_review_facts.campaign_id
        AND story.workspace_id = ai_story_story_review_facts.workspace_id
        AND story.org_id = ai_story_story_review_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_story_review_facts.story_version_id
        AND version.story_id = ai_story_story_review_facts.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_story_review_facts.animation_package_id
        AND package.story_id = ai_story_story_review_facts.story_id
        AND package.story_version_id = ai_story_story_review_facts.story_version_id
        AND package.campaign_id = ai_story_story_review_facts.campaign_id
        AND package.workspace_id = ai_story_story_review_facts.workspace_id
        AND package.org_id = ai_story_story_review_facts.org_id
    )
  );

-- ── Assembly Definitions ─────────────────────────────────────────────────────
ALTER TABLE ai_story_assembly_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_assembly_definitions_select ON ai_story_assembly_definitions;
DROP POLICY IF EXISTS ai_story_assembly_definitions_insert ON ai_story_assembly_definitions;
DROP POLICY IF EXISTS ai_story_assembly_definitions_update ON ai_story_assembly_definitions;
DROP POLICY IF EXISTS ai_story_assembly_definitions_delete ON ai_story_assembly_definitions;
DROP POLICY IF EXISTS ai_story_assembly_definitions_all ON ai_story_assembly_definitions;

CREATE POLICY ai_story_assembly_definitions_select ON ai_story_assembly_definitions
  FOR SELECT
  USING (
    ai_story_assembly_definitions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_assembly_definitions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_assembly_definitions.workspace_id
    )
  );

CREATE POLICY ai_story_assembly_definitions_insert ON ai_story_assembly_definitions
  FOR INSERT
  WITH CHECK (
    ai_story_assembly_definitions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_assembly_definitions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_assembly_definitions.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_assembly_definitions.execution_plan_id
        AND plan.org_id = ai_story_assembly_definitions.org_id
        AND plan.workspace_id = ai_story_assembly_definitions.workspace_id
        AND plan.campaign_id = ai_story_assembly_definitions.campaign_id
        AND plan.story_id = ai_story_assembly_definitions.story_id
        AND plan.story_version_id = ai_story_assembly_definitions.story_version_id
        AND plan.animation_package_id = ai_story_assembly_definitions.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM campaigns campaign
      WHERE campaign.id = ai_story_assembly_definitions.campaign_id
        AND campaign.workspace_id = ai_story_assembly_definitions.workspace_id
        AND campaign.org_id = ai_story_assembly_definitions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_assembly_definitions.story_id
        AND story.campaign_id = ai_story_assembly_definitions.campaign_id
        AND story.workspace_id = ai_story_assembly_definitions.workspace_id
        AND story.org_id = ai_story_assembly_definitions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_versions version
      WHERE version.id = ai_story_assembly_definitions.story_version_id
        AND version.story_id = ai_story_assembly_definitions.story_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_animation_packages package
      WHERE package.id = ai_story_assembly_definitions.animation_package_id
        AND package.story_id = ai_story_assembly_definitions.story_id
        AND package.story_version_id = ai_story_assembly_definitions.story_version_id
        AND package.campaign_id = ai_story_assembly_definitions.campaign_id
        AND package.workspace_id = ai_story_assembly_definitions.workspace_id
        AND package.org_id = ai_story_assembly_definitions.org_id
    )
  );

-- ── Assembly Scene Memberships ───────────────────────────────────────────────
ALTER TABLE ai_story_assembly_scene_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_assembly_memberships_select ON ai_story_assembly_scene_memberships;
DROP POLICY IF EXISTS ai_story_assembly_memberships_insert ON ai_story_assembly_scene_memberships;
DROP POLICY IF EXISTS ai_story_assembly_memberships_update ON ai_story_assembly_scene_memberships;
DROP POLICY IF EXISTS ai_story_assembly_memberships_delete ON ai_story_assembly_scene_memberships;
DROP POLICY IF EXISTS ai_story_assembly_memberships_all ON ai_story_assembly_scene_memberships;

CREATE POLICY ai_story_assembly_memberships_select ON ai_story_assembly_scene_memberships
  FOR SELECT
  USING (
    ai_story_assembly_scene_memberships.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_assembly_scene_memberships.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_assembly_scene_memberships.workspace_id
    )
  );

CREATE POLICY ai_story_assembly_memberships_insert ON ai_story_assembly_scene_memberships
  FOR INSERT
  WITH CHECK (
    ai_story_assembly_scene_memberships.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_assembly_scene_memberships.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_assembly_scene_memberships.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_assembly_definitions definition
      WHERE definition.assembly_definition_id = ai_story_assembly_scene_memberships.assembly_definition_id
        AND definition.org_id = ai_story_assembly_scene_memberships.org_id
        AND definition.workspace_id = ai_story_assembly_scene_memberships.workspace_id
        AND definition.campaign_id = ai_story_assembly_scene_memberships.campaign_id
        AND definition.story_id = ai_story_assembly_scene_memberships.story_id
        AND definition.story_version_id = ai_story_assembly_scene_memberships.story_version_id
        AND definition.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id
        AND definition.execution_plan_id = ai_story_assembly_scene_memberships.execution_plan_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_assembly_scene_memberships.scene_execution_id
        AND scene.execution_plan_id = ai_story_assembly_scene_memberships.execution_plan_id
        AND scene.org_id = ai_story_assembly_scene_memberships.org_id
        AND scene.workspace_id = ai_story_assembly_scene_memberships.workspace_id
        AND scene.campaign_id = ai_story_assembly_scene_memberships.campaign_id
        AND scene.story_id = ai_story_assembly_scene_memberships.story_id
        AND scene.story_version_id = ai_story_assembly_scene_memberships.story_version_id
        AND scene.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_assembly_scene_memberships.execution_plan_id
        AND plan.org_id = ai_story_assembly_scene_memberships.org_id
        AND plan.workspace_id = ai_story_assembly_scene_memberships.workspace_id
        AND plan.campaign_id = ai_story_assembly_scene_memberships.campaign_id
        AND plan.story_id = ai_story_assembly_scene_memberships.story_id
        AND plan.story_version_id = ai_story_assembly_scene_memberships.story_version_id
        AND plan.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id
    )
  );
