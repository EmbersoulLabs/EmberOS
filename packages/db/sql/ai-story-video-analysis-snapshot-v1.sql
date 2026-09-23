-- Additive AI Story video analysis snapshots.
-- Does not alter existing asset rows.
-- Rollback: DROP TRIGGER, DROP FUNCTION, DROP TABLE ai_story_video_analysis_claims, DROP TABLE ai_story_video_analysis_snapshots.
-- Snapshots are immutable. Claims may move CLAIMED -> SUCCEEDED or FAILED.
-- A failed claim does not block a later claim. One active claim or succeeded snapshot exists per reuse key.

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_video_analysis_claims_active_uidx
  ON ai_story_video_analysis_claims (workspace_id, asset_id, asset_content_hash, analysis_version, extractor_version)
  WHERE status IN ('CLAIMED', 'SUCCEEDED');

CREATE OR REPLACE FUNCTION ai_story_video_analysis_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI_STORY_VIDEO_ANALYSIS_SNAPSHOT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS ai_story_video_analysis_snapshots_no_mutation ON ai_story_video_analysis_snapshots;
CREATE TRIGGER ai_story_video_analysis_snapshots_no_mutation
  BEFORE UPDATE OR DELETE ON ai_story_video_analysis_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION ai_story_video_analysis_snapshots_immutable();

ALTER TABLE ai_story_video_analysis_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_video_analysis_claims ENABLE ROW LEVEL SECURITY;

DO $video_analysis_rls$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL AND to_regprocedure('user_workspace_ids()') IS NULL THEN
    RETURN;
  END IF;

  IF to_regprocedure('user_workspace_ids()') IS NULL THEN
    EXECUTE $create_user_workspace_ids$
      CREATE FUNCTION user_workspace_ids()
      RETURNS SETOF uuid
      LANGUAGE sql
      SECURITY DEFINER
      STABLE
      AS $body$
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      $body$
    $create_user_workspace_ids$;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_select ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_insert ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_update ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_delete ON ai_story_video_analysis_snapshots';
  EXECUTE 'CREATE POLICY ai_story_video_analysis_snapshots_select ON ai_story_video_analysis_snapshots FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()))';

  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_select ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_insert ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_update ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_delete ON ai_story_video_analysis_claims';
  EXECUTE 'CREATE POLICY ai_story_video_analysis_claims_select ON ai_story_video_analysis_claims FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()))';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON ai_story_video_analysis_snapshots TO authenticated';
    EXECUTE 'GRANT SELECT ON ai_story_video_analysis_claims TO authenticated';
  END IF;
END
$video_analysis_rls$;
