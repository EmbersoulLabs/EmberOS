-- Repair canonical Scene aggregate lifecycle transitions without redefining
-- lifecycle states as semantic Scene revisions.
CREATE OR REPLACE FUNCTION enforce_ai_story_canonical_scene_aggregate_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scene_id IS DISTINCT FROM OLD.scene_id
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.story_id IS DISTINCT FROM OLD.story_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Canonical Scene identity and ownership are immutable' USING ERRCODE='23514';
  END IF;

  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded canonical Scene cannot mutate' USING ERRCODE='23514';
  END IF;

  IF NEW.current_version = OLD.current_version
    AND NEW.current_scene_version_id = OLD.current_scene_version_id THEN
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
      OR (OLD.status = 'VALIDATED' AND NEW.status = 'APPROVED')
      OR (OLD.status = 'APPROVED' AND NEW.status = 'FROZEN')
    ) THEN
      RAISE EXCEPTION 'Invalid canonical Scene aggregate lifecycle transition' USING ERRCODE='23514';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RAISE EXCEPTION 'Canonical Scene lifecycle transition may change only status and updated_at' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_version = OLD.current_version + 1
    AND NEW.current_scene_version_id IS DISTINCT FROM OLD.current_scene_version_id THEN
    IF OLD.status <> 'FROZEN' OR NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Canonical Scene semantic revision requires FROZEN to DRAFT' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid canonical Scene aggregate version or pointer mutation' USING ERRCODE='23514';
END
$$;

DROP TRIGGER IF EXISTS ai_story_canonical_scene_aggregate_v1 ON ai_story_canonical_scenes;
DROP TRIGGER IF EXISTS ai_story_canonical_scene_aggregate_v2 ON ai_story_canonical_scenes;

CREATE TRIGGER ai_story_canonical_scene_aggregate_v2
BEFORE UPDATE ON ai_story_canonical_scenes
FOR EACH ROW
EXECUTE FUNCTION enforce_ai_story_canonical_scene_aggregate_v2();
