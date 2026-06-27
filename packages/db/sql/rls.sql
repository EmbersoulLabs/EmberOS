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
