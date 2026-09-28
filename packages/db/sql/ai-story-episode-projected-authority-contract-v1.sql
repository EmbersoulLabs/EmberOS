-- Forward-only contract whitelist for Director and Motion authority.
-- Historical rows stay untouched. contract_version remains a closed set.
DO $$
DECLARE
  unexpected integer;
BEGIN
  IF to_regclass('public.ai_story_director_plan_versions') IS NULL
     OR to_regclass('public.ai_story_motion_plan_versions') IS NULL THEN
    RAISE EXCEPTION 'EPISODE_PROJECTED_AUTHORITY_TABLES_REQUIRED';
  END IF;

  SELECT count(*) INTO unexpected
  FROM ai_story_director_plan_versions
  WHERE contract_version NOT IN (
    'ai-story-director-plan.v1',
    'ai-story-director-plan.episode-projected.v1'
  );
  IF unexpected > 0 THEN
    RAISE EXCEPTION 'DIRECTOR_CONTRACT_VERSION_UNEXPECTED:%', unexpected;
  END IF;

  SELECT count(*) INTO unexpected
  FROM ai_story_motion_plan_versions
  WHERE contract_version NOT IN (
    'ai-story-motion-plan.v1',
    'ai-story-motion-plan.episode-projected.v1'
  );
  IF unexpected > 0 THEN
    RAISE EXCEPTION 'MOTION_CONTRACT_VERSION_UNEXPECTED:%', unexpected;
  END IF;
END $$;

ALTER TABLE ai_story_director_plan_versions DROP CONSTRAINT IF EXISTS ai_story_director_plan_contract_check;
ALTER TABLE ai_story_director_plan_versions DROP CONSTRAINT IF EXISTS ai_story_director_plan_versions_contract_version_check;
ALTER TABLE ai_story_director_plan_versions DROP CONSTRAINT IF EXISTS ai_story_director_plan_contract_version_check;
ALTER TABLE ai_story_director_plan_versions
  ADD CONSTRAINT ai_story_director_plan_contract_version_check
  CHECK (contract_version IN (
    'ai-story-director-plan.v1',
    'ai-story-director-plan.episode-projected.v1'
  ));

ALTER TABLE ai_story_motion_plan_versions DROP CONSTRAINT IF EXISTS ai_story_motion_plan_contract_check;
ALTER TABLE ai_story_motion_plan_versions DROP CONSTRAINT IF EXISTS ai_story_motion_plan_versions_contract_version_check;
ALTER TABLE ai_story_motion_plan_versions DROP CONSTRAINT IF EXISTS ai_story_motion_plan_contract_version_check;
ALTER TABLE ai_story_motion_plan_versions
  ADD CONSTRAINT ai_story_motion_plan_contract_version_check
  CHECK (contract_version IN (
    'ai-story-motion-plan.v1',
    'ai-story-motion-plan.episode-projected.v1'
  ));
