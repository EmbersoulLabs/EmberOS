-- EXEC-04: RLS for generated Scene review facts.
-- Authenticated clients: SELECT within workspace membership only.
-- Writes go through service-role / DB owner repository transactions.

ALTER TABLE ai_story_generated_scene_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_generated_scene_reviews_select
  ON ai_story_generated_scene_reviews;
DROP POLICY IF EXISTS ai_story_generated_scene_reviews_insert
  ON ai_story_generated_scene_reviews;
DROP POLICY IF EXISTS ai_story_generated_scene_reviews_update
  ON ai_story_generated_scene_reviews;
DROP POLICY IF EXISTS ai_story_generated_scene_reviews_delete
  ON ai_story_generated_scene_reviews;

CREATE POLICY ai_story_generated_scene_reviews_select
  ON ai_story_generated_scene_reviews
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));
