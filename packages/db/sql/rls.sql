-- RLS policies for multi-tenant isolation
-- Run after drizzle push in Supabase SQL editor

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY workspace_select ON workspaces
  FOR SELECT USING (id IN (SELECT user_workspace_ids()));

CREATE POLICY workspace_members_select ON workspace_members
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY campaigns_all ON campaigns
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY assets_all ON assets
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY tasks_all ON tasks
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY creatives_all ON creatives
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY reviews_all ON reviews
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── client_invites ──────────────────────────────────────────────────────────
-- Portal reads use service-role key (bypasses RLS). This policy protects
-- internal users: only workspace members can create / view / delete invites.
ALTER TABLE client_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_invites_all ON client_invites
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── publish_jobs ─────────────────────────────────────────────────────────────
ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY publish_jobs_all ON publish_jobs
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── agent_logs ───────────────────────────────────────────────────────────────
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_logs_all ON agent_logs
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── marketing_scores ─────────────────────────────────────────────────────────
ALTER TABLE marketing_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_scores_all ON marketing_scores
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── content_analytics ────────────────────────────────────────────────────────
ALTER TABLE content_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_analytics_all ON content_analytics
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── workspace_insights ───────────────────────────────────────────────────────
ALTER TABLE workspace_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_insights_all ON workspace_insights
  FOR ALL USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── business_profiles (SPEC-001 / CS-3) ─────────────────────────────────────
-- Tenant isolation via workspace membership + org_id must match workspace.org_id.
-- Soft-delete is UPDATE; covered by UPDATE policies.
-- Service role bypasses RLS (existing Supabase convention). No Super Admin bypass here.
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_profiles_all ON business_profiles;
DROP POLICY IF EXISTS business_profiles_select ON business_profiles;
DROP POLICY IF EXISTS business_profiles_insert ON business_profiles;
DROP POLICY IF EXISTS business_profiles_update ON business_profiles;
DROP POLICY IF EXISTS business_profiles_delete ON business_profiles;

CREATE POLICY business_profiles_select ON business_profiles
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));

CREATE POLICY business_profiles_insert ON business_profiles
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids())
    AND org_id = (SELECT org_id FROM workspaces WHERE id = workspace_id)
  );

CREATE POLICY business_profiles_update ON business_profiles
  FOR UPDATE
  USING (workspace_id IN (SELECT user_workspace_ids()))
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids())
    AND org_id = (SELECT org_id FROM workspaces WHERE id = workspace_id)
  );

CREATE POLICY business_profiles_delete ON business_profiles
  FOR DELETE
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── campaign_asset_refs (Photo Scene 10A) ───────────────────────────────────
ALTER TABLE campaign_asset_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_asset_refs_all ON campaign_asset_refs;
CREATE POLICY campaign_asset_refs_all ON campaign_asset_refs
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );

-- ── photo_scene_generations (Photo Scene 10B) ───────────────────────────────
ALTER TABLE photo_scene_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_scene_generations_all ON photo_scene_generations;
CREATE POLICY photo_scene_generations_all ON photo_scene_generations
  FOR ALL USING (
    workspace_id IN (SELECT user_workspace_ids())
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );

-- ── photo_scene official scenes (Photo Scene 10C) ───────────────────────────
-- Global catalog: authenticated read of published/retired versions. No tenant writes.
ALTER TABLE photo_scene_official_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_scene_official_scene_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_scene_scene_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_scene_official_scenes_select ON photo_scene_official_scenes;
CREATE POLICY photo_scene_official_scenes_select ON photo_scene_official_scenes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS photo_scene_official_scene_versions_select ON photo_scene_official_scene_versions;
CREATE POLICY photo_scene_official_scene_versions_select ON photo_scene_official_scene_versions
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND status IN ('published', 'retired')
  );

DROP POLICY IF EXISTS photo_scene_scene_selections_all ON photo_scene_scene_selections;
CREATE POLICY photo_scene_scene_selections_all ON photo_scene_scene_selections
  FOR ALL USING (
    workspace_id IN (SELECT user_workspace_ids())
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids())
    AND org_id = (SELECT org_id FROM workspaces WHERE id = workspace_id)
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );
