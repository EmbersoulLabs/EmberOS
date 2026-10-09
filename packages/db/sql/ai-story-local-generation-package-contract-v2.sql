-- V1 local packages stay bound to provider scheduling authority.
-- V2 local packages use provider-neutral execution authority.
-- Existing rows are not updated. Only the closed contract_version check widens.
BEGIN;

DO $$
DECLARE
  old_name text;
  definition text;
  check_count bigint;
  unexpected bigint;
BEGIN
  IF to_regclass('public.ai_story_local_generation_packages') IS NULL THEN
    RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_TABLE_REQUIRED';
  END IF;

  SELECT count(*) INTO unexpected
  FROM ai_story_local_generation_packages
  WHERE contract_version IS DISTINCT FROM 'local-generation-package.v1';
  IF unexpected > 0 THEN
    RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_CONTRACT_VERSION_UNEXPECTED:%', unexpected;
  END IF;

  SELECT count(*) INTO check_count
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%contract_version%';
  IF check_count <> 1 THEN
    RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_CONTRACT_CHECK_COUNT:%', check_count;
  END IF;

  SELECT conname, pg_get_constraintdef(oid)
    INTO old_name, definition
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%contract_version%';

  IF definition ILIKE '%local-generation-package.v2%' THEN
    RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_CONTRACT_V2_ALREADY_APPLIED';
  END IF;
  IF definition NOT ILIKE '%local-generation-package.v1%' THEN
    RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_V1_CHECK_REQUIRED';
  END IF;

  EXECUTE format(
    'ALTER TABLE ai_story_local_generation_packages DROP CONSTRAINT %I',
    old_name
  );
END $$;

ALTER TABLE ai_story_local_generation_packages
  ADD CONSTRAINT ai_story_local_generation_package_contract_version_check
  CHECK (contract_version IN (
    'local-generation-package.v1',
    'local-generation-package.v2'
  ));

COMMIT;
