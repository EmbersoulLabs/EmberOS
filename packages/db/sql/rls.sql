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
