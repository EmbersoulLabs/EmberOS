-- Sprint 3 PR 3.7 Phase A — RLS for Final Story Result persistence.
-- Authenticated clients: SELECT within workspace membership only.
-- No authenticated INSERT / UPDATE / DELETE.
-- Service role / DB owner bypasses RLS for infrastructure writes.

ALTER TABLE ai_story_final_story_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_final_story_results_select ON ai_story_final_story_results;
DROP POLICY IF EXISTS ai_story_final_story_results_insert ON ai_story_final_story_results;
DROP POLICY IF EXISTS ai_story_final_story_results_update ON ai_story_final_story_results;
DROP POLICY IF EXISTS ai_story_final_story_results_delete ON ai_story_final_story_results;

CREATE POLICY ai_story_final_story_results_select ON ai_story_final_story_results
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));
