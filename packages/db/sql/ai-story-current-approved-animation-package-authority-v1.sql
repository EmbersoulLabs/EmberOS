-- Canonical approved Animation Package authority: zero or one approved package per Story Version.
-- This migration never selects, demotes, deletes, or rewrites historical packages.

BEGIN;

LOCK TABLE ai_story_animation_packages IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_story_animation_packages
    WHERE status = 'ready_for_execution'
    GROUP BY story_id, story_version_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Approved Animation Package authority is ambiguous for an existing Story Version'
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_animation_packages_one_ready_per_story_version_idx
  ON ai_story_animation_packages (story_id, story_version_id)
  WHERE status = 'ready_for_execution';

COMMIT;
