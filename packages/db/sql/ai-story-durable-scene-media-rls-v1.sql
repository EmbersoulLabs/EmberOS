-- Sprint 4 Phase A — RLS for Durable Scene Media Attestations.
-- Authenticated: SELECT within workspace membership only.
-- No authenticated INSERT / UPDATE / DELETE.

ALTER TABLE ai_story_durable_scene_media_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_durable_scene_media_select ON ai_story_durable_scene_media_attestations;
DROP POLICY IF EXISTS ai_story_durable_scene_media_insert ON ai_story_durable_scene_media_attestations;
DROP POLICY IF EXISTS ai_story_durable_scene_media_update ON ai_story_durable_scene_media_attestations;
DROP POLICY IF EXISTS ai_story_durable_scene_media_delete ON ai_story_durable_scene_media_attestations;

CREATE POLICY ai_story_durable_scene_media_select ON ai_story_durable_scene_media_attestations
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));
