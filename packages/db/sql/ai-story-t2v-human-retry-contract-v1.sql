BEGIN;

ALTER TABLE ai_story_scene_attempt_input_revisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_retry_revision_mode_v1;
ALTER TABLE ai_story_scene_attempt_input_revisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_attempt_input_re_provider_mode_requirement_check;
ALTER TABLE ai_story_scene_attempt_input_revisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_attempt_input_revisions_provider_mode_requirement_check;

ALTER TABLE ai_story_scene_attempt_input_revisions
  ALTER COLUMN product_asset_id DROP NOT NULL;
ALTER TABLE ai_story_scene_attempt_input_revisions
  ALTER COLUMN product_authority_hash DROP NOT NULL;
ALTER TABLE ai_story_scene_attempt_input_revisions
  ALTER COLUMN visual_authority_certification_hash DROP NOT NULL;

ALTER TABLE ai_story_scene_attempt_input_revisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_retry_revision_mode_v2;
ALTER TABLE ai_story_scene_attempt_input_revisions
  ADD CONSTRAINT ai_story_scene_retry_revision_mode_v2
    CHECK (provider_mode_requirement IN ('REFERENCE_FREE_T2V', 'FIRST_FRAME_I2V'));

ALTER TABLE ai_story_scene_attempt_input_revisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_retry_revision_authority_v2;
ALTER TABLE ai_story_scene_attempt_input_revisions
  ADD CONSTRAINT ai_story_scene_retry_revision_authority_v2
    CHECK (
      (
        provider_mode_requirement = 'REFERENCE_FREE_T2V'
        AND product_asset_id IS NULL
        AND product_authority_hash IS NULL
        AND visual_authority_certification_hash IS NULL
      ) OR (
        provider_mode_requirement = 'FIRST_FRAME_I2V'
        AND product_asset_id IS NOT NULL
        AND product_authority_hash IS NOT NULL
        AND visual_authority_certification_hash IS NOT NULL
      )
    );

COMMIT;
