-- Repeatable execution-mode widening for a future explicit LOCAL_GPU release.
-- Historical rows stay REMOTE_PROVIDER or MANUAL_LOCAL. No backfill.
-- Release-state, gate, and Manual Local shape constraints are left in place.
-- This file is not applied to Staging or Production by the Phase 1 change.
BEGIN;

DO $$
DECLARE
  definition text;
  unexpected bigint;
  modes text[];
BEGIN
  IF to_regclass('public.ai_story_scene_release_states') IS NULL THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_RELEASE_LEDGER_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_story_scene_release_states'
      AND column_name = 'execution_mode'
  ) THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_COLUMN_REQUIRED';
  END IF;

  SELECT count(*) INTO unexpected
  FROM ai_story_scene_release_states
  WHERE execution_mode IS NOT NULL
    AND execution_mode NOT IN ('REMOTE_PROVIDER', 'MANUAL_LOCAL', 'LOCAL_GPU');
  IF unexpected <> 0 THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_UNEXPECTED:%', unexpected;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_scene_release_states'::regclass
    AND conname = 'ai_story_scene_release_execution_mode_check';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_CHECK_REQUIRED';
  END IF;
  IF definition NOT ILIKE '%REMOTE_PROVIDER%'
    OR definition NOT ILIKE '%MANUAL_LOCAL%' THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_PREDECESSOR_CHECK_REQUIRED';
  END IF;

  SELECT coalesce(array_agg(extracted.token ORDER BY extracted.token), ARRAY[]::text[])
  INTO modes
  FROM (
    SELECT match[1] AS token
    FROM regexp_matches(definition, '''([A-Z0-9_]+)''', 'g') AS match
  ) AS extracted;

  IF modes = ARRAY['LOCAL_GPU', 'MANUAL_LOCAL', 'REMOTE_PROVIDER']::text[] THEN
    RETURN;
  END IF;

  IF modes <> ARRAY['MANUAL_LOCAL', 'REMOTE_PROVIDER']::text[] THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_PREDECESSOR_CHECK_REQUIRED';
  END IF;

  EXECUTE 'ALTER TABLE ai_story_scene_release_states DROP CONSTRAINT ai_story_scene_release_execution_mode_check';
  EXECUTE $constraint$
    ALTER TABLE ai_story_scene_release_states
      ADD CONSTRAINT ai_story_scene_release_execution_mode_check
      CHECK (execution_mode IN ('REMOTE_PROVIDER', 'MANUAL_LOCAL', 'LOCAL_GPU'))
  $constraint$;
END $$;

COMMIT;
