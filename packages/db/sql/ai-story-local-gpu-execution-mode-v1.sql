-- Forward-only execution mode for explicit LOCAL_GPU.
-- Historical rows stay REMOTE_PROVIDER or MANUAL_LOCAL. No backfill.
BEGIN;

DO $$
DECLARE
  definition text;
  unexpected bigint;
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
  IF definition ILIKE '%LOCAL_GPU%' THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_ALREADY_APPLIED';
  END IF;
  IF definition NOT ILIKE '%REMOTE_PROVIDER%'
    OR definition NOT ILIKE '%MANUAL_LOCAL%' THEN
    RAISE EXCEPTION 'LOCAL_GPU_EXECUTION_MODE_PREDECESSOR_CHECK_REQUIRED';
  END IF;
END $$;

ALTER TABLE ai_story_scene_release_states
  DROP CONSTRAINT IF EXISTS ai_story_scene_release_execution_mode_check;

ALTER TABLE ai_story_scene_release_states
  ADD CONSTRAINT ai_story_scene_release_execution_mode_check
  CHECK (
    execution_mode IN (
      'REMOTE_PROVIDER',
      'MANUAL_LOCAL',
      'LOCAL_GPU'
    )
  );

COMMIT;
