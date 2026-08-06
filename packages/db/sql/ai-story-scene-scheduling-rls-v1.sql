-- Sprint 3 Phase 3 PR 3.2: additive RLS for Scene Scheduling tables.
-- SELECT + INSERT only. No authenticated UPDATE/DELETE.
-- Complements repository ownership validation.

CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Runtime Authorized Facts ─────────────────────────────────────────────────
ALTER TABLE ai_story_runtime_authorized_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_runtime_auth_select ON ai_story_runtime_authorized_facts;
DROP POLICY IF EXISTS ai_story_runtime_auth_insert ON ai_story_runtime_authorized_facts;
DROP POLICY IF EXISTS ai_story_runtime_auth_update ON ai_story_runtime_authorized_facts;
DROP POLICY IF EXISTS ai_story_runtime_auth_delete ON ai_story_runtime_authorized_facts;

CREATE POLICY ai_story_runtime_auth_select ON ai_story_runtime_authorized_facts
  FOR SELECT
  USING (
    ai_story_runtime_authorized_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_runtime_authorized_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_runtime_authorized_facts.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_runtime_authorized_facts.execution_plan_id
        AND plan.org_id = ai_story_runtime_authorized_facts.org_id
        AND plan.workspace_id = ai_story_runtime_authorized_facts.workspace_id
        AND plan.campaign_id = ai_story_runtime_authorized_facts.campaign_id
        AND plan.story_id = ai_story_runtime_authorized_facts.story_id
        AND plan.story_version_id = ai_story_runtime_authorized_facts.story_version_id
        AND plan.animation_package_id = ai_story_runtime_authorized_facts.animation_package_id
    )
  );

CREATE POLICY ai_story_runtime_auth_insert ON ai_story_runtime_authorized_facts
  FOR INSERT
  WITH CHECK (
    ai_story_runtime_authorized_facts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_runtime_authorized_facts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_runtime_authorized_facts.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_execution_plans plan
      WHERE plan.id = ai_story_runtime_authorized_facts.execution_plan_id
        AND plan.org_id = ai_story_runtime_authorized_facts.org_id
        AND plan.workspace_id = ai_story_runtime_authorized_facts.workspace_id
        AND plan.campaign_id = ai_story_runtime_authorized_facts.campaign_id
        AND plan.story_id = ai_story_runtime_authorized_facts.story_id
        AND plan.story_version_id = ai_story_runtime_authorized_facts.story_version_id
        AND plan.animation_package_id = ai_story_runtime_authorized_facts.animation_package_id
    )
  );

-- ── Scene Routing Decisions ──────────────────────────────────────────────────
ALTER TABLE ai_story_scene_routing_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_scene_routing_select ON ai_story_scene_routing_decisions;
DROP POLICY IF EXISTS ai_story_scene_routing_insert ON ai_story_scene_routing_decisions;
DROP POLICY IF EXISTS ai_story_scene_routing_update ON ai_story_scene_routing_decisions;
DROP POLICY IF EXISTS ai_story_scene_routing_delete ON ai_story_scene_routing_decisions;

CREATE POLICY ai_story_scene_routing_select ON ai_story_scene_routing_decisions
  FOR SELECT
  USING (
    ai_story_scene_routing_decisions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_routing_decisions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_routing_decisions.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_runtime_authorized_facts auth
      WHERE auth.runtime_authorization_id = ai_story_scene_routing_decisions.runtime_authorization_id
        AND auth.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id
        AND auth.org_id = ai_story_scene_routing_decisions.org_id
        AND auth.workspace_id = ai_story_scene_routing_decisions.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_routing_decisions.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id
        AND scene.org_id = ai_story_scene_routing_decisions.org_id
        AND scene.workspace_id = ai_story_scene_routing_decisions.workspace_id
    )
  );

CREATE POLICY ai_story_scene_routing_insert ON ai_story_scene_routing_decisions
  FOR INSERT
  WITH CHECK (
    ai_story_scene_routing_decisions.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_routing_decisions.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_routing_decisions.workspace_id
    )
    AND ai_story_scene_routing_decisions.automatic_fallback_enabled = FALSE
    AND EXISTS (
      SELECT 1 FROM ai_story_runtime_authorized_facts auth
      WHERE auth.runtime_authorization_id = ai_story_scene_routing_decisions.runtime_authorization_id
        AND auth.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id
        AND auth.org_id = ai_story_scene_routing_decisions.org_id
        AND auth.workspace_id = ai_story_scene_routing_decisions.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_routing_decisions.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id
        AND scene.org_id = ai_story_scene_routing_decisions.org_id
        AND scene.workspace_id = ai_story_scene_routing_decisions.workspace_id
    )
  );

-- ── Scene Scheduling Correlations ────────────────────────────────────────────
ALTER TABLE ai_story_scene_scheduling_correlations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_scene_scheduling_select ON ai_story_scene_scheduling_correlations;
DROP POLICY IF EXISTS ai_story_scene_scheduling_insert ON ai_story_scene_scheduling_correlations;
DROP POLICY IF EXISTS ai_story_scene_scheduling_update ON ai_story_scene_scheduling_correlations;
DROP POLICY IF EXISTS ai_story_scene_scheduling_delete ON ai_story_scene_scheduling_correlations;

CREATE POLICY ai_story_scene_scheduling_select ON ai_story_scene_scheduling_correlations
  FOR SELECT
  USING (
    ai_story_scene_scheduling_correlations.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_scheduling_correlations.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_scheduling_correlations.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_routing_decisions decision
      WHERE decision.routing_decision_id = ai_story_scene_scheduling_correlations.routing_decision_id
        AND decision.scene_execution_id = ai_story_scene_scheduling_correlations.scene_execution_id
        AND decision.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id
        AND decision.runtime_authorization_id = ai_story_scene_scheduling_correlations.runtime_authorization_id
        AND decision.org_id = ai_story_scene_scheduling_correlations.org_id
        AND decision.workspace_id = ai_story_scene_scheduling_correlations.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_scheduling_correlations.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id
        AND scene.org_id = ai_story_scene_scheduling_correlations.org_id
        AND scene.workspace_id = ai_story_scene_scheduling_correlations.workspace_id
    )
  );

CREATE POLICY ai_story_scene_scheduling_insert ON ai_story_scene_scheduling_correlations
  FOR INSERT
  WITH CHECK (
    ai_story_scene_scheduling_correlations.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_scene_scheduling_correlations.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_scene_scheduling_correlations.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_routing_decisions decision
      WHERE decision.routing_decision_id = ai_story_scene_scheduling_correlations.routing_decision_id
        AND decision.scene_execution_id = ai_story_scene_scheduling_correlations.scene_execution_id
        AND decision.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id
        AND decision.runtime_authorization_id = ai_story_scene_scheduling_correlations.runtime_authorization_id
        AND decision.org_id = ai_story_scene_scheduling_correlations.org_id
        AND decision.workspace_id = ai_story_scene_scheduling_correlations.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM ai_story_scene_executions scene
      WHERE scene.id = ai_story_scene_scheduling_correlations.scene_execution_id
        AND scene.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id
        AND scene.org_id = ai_story_scene_scheduling_correlations.org_id
        AND scene.workspace_id = ai_story_scene_scheduling_correlations.workspace_id
    )
  );
